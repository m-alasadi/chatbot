import { type AllowedToolName } from "./site-tools-definitions"
import { executeToolByName, type APICallResult } from "./site-api-service"
import { isEmptyAPIResponse } from "./smart-suggestions"
import { logChatTrace, normalizeQueryForTrace } from "./observability/chat-trace"
import { understandQuery, type QueryUnderstandingResult } from "./query-understanding"

export type ContentIntentConstraint =
  | "video"
  | "news"
  | "biography"
  | "history"
  | "sermon"
  | "wahy"
  | "language"
  | "generic"

export interface SourceConstraint {
  intent: ContentIntentConstraint
  hardConstraint: boolean
  preferredSources: string[]
  allowedSources?: string[]
}

export interface RetrievalAttempt {
  index: number
  source: string
  reason: string
  startedAt: number
  finishedAt?: number
  success: boolean
  empty: boolean
  rejectedLowConfidence: boolean
  rejectionReason?: string
  resultCount: number
  topScore: number | null
}

export interface RetrievalPlan {
  query: string
  toolName: AllowedToolName
  sourceConstraint: SourceConstraint
  attempts: Array<{
    source: string
    reason: string
  }>
  maxAttempts: number
  broadenAfterAttempt: number
  minResultCount: number
  minTopScore: number
}

export interface OrchestratorResult {
  plan: RetrievalPlan
  attempts: RetrievalAttempt[]
  finalResult: APICallResult
  exhausted: boolean
  fallbackApplied: boolean
  lowConfidenceRejected: boolean
  unavailableReason?: string
  routedSource?: string
  resultCount: number
  topScore: number | null
}

interface OrchestratorOptions {
  traceId?: string
  maxAttempts?: number
  execute?: (toolName: AllowedToolName, args: Record<string, any>) => Promise<APICallResult>
  queryUnderstanding?: QueryUnderstandingResult
}

function getResultCount(data: any): number {
  if (!data) return 0
  if (typeof data.total === "number") return data.total
  if (Array.isArray(data.results)) return data.results.length
  if (Array.isArray(data.projects)) return data.projects.length
  if (Array.isArray(data.items)) return data.items.length
  return 0
}

function getTopScore(data: any): number | null {
  if (!data) return null
  if (typeof data.top_score === "number") return data.top_score
  if (Array.isArray(data.results) && data.results.length > 0) {
    const first = data.results[0]
    const score = first?._score || first?.score
    if (typeof score === "number") return score
  }
  return null
}

function mapUnderstandingIntent(
  understanding: QueryUnderstandingResult
): ContentIntentConstraint {
  switch (understanding.content_intent) {
    case "video":
      return "video"
    case "news":
      return "news"
    case "biography":
      return "biography"
    case "history":
      return "history"
    case "sermon":
      return "sermon"
    case "wahy":
      return "wahy"
    default:
      return "generic"
  }
}

function buildSourceConstraint(
  query: string,
  args: Record<string, any>,
  understanding: QueryUnderstandingResult
): SourceConstraint {
  const explicitSource = typeof args.source === "string" ? args.source : "auto"
  const intent = mapUnderstandingIntent(understanding)

  if (explicitSource !== "auto") {
    return {
      intent,
      hardConstraint: false,
      preferredSources: [explicitSource, "auto"],
      allowedSources: [explicitSource, "auto"]
    }
  }

  switch (intent) {
    case "video":
      return {
        intent,
        hardConstraint: true,
        preferredSources: ["videos_latest", "auto"],
        allowedSources: ["videos_latest", "videos_by_category", "auto"]
      }
    case "news":
      return {
        intent,
        hardConstraint: true,
        preferredSources: ["articles_latest", "auto"],
        allowedSources: ["articles_latest", "auto"]
      }
    case "biography":
      return {
        intent,
        hardConstraint: true,
        preferredSources: ["shrine_history_sections", "auto"],
        allowedSources: ["shrine_history_sections", "shrine_history_by_section", "abbas_history_by_id", "auto"]
      }
    case "wahy":
      return {
        intent,
        hardConstraint: true,
        preferredSources: ["wahy_friday", "auto"],
        allowedSources: ["wahy_friday", "auto"]
      }
    case "sermon":
      return {
        intent,
        hardConstraint: true,
        preferredSources: ["friday_sermons", "wahy_friday", "auto"],
        allowedSources: ["friday_sermons", "wahy_friday", "auto"]
      }
    case "history":
      return {
        intent,
        hardConstraint: true,
        preferredSources: ["shrine_history_sections", "auto"],
        allowedSources: ["shrine_history_sections", "shrine_history_by_section", "abbas_history_by_id", "auto"]
      }
    case "language":
      return {
        intent,
        hardConstraint: true,
        preferredSources: ["lang_words_ar", "auto"],
        allowedSources: ["lang_words_ar", "auto"]
      }
    default:
      if (understanding.hinted_sources.length > 0) {
        const hintedWithoutAuto = understanding.hinted_sources.filter(s => s !== "auto")
        const preferredBase = [...new Set(hintedWithoutAuto)].slice(0, 3)
        const preferred = [...preferredBase, "auto"]
        return {
          intent,
          hardConstraint: false,
          preferredSources: preferred,
          allowedSources: preferred
        }
      }
      return {
        intent,
        hardConstraint: false,
        preferredSources: ["auto"],
        allowedSources: ["auto"]
      }
  }
}

function buildPlan(
  toolName: AllowedToolName,
  query: string,
  args: Record<string, any>,
  understanding: QueryUnderstandingResult,
  maxAttempts: number
): RetrievalPlan {
  const sourceConstraint = buildSourceConstraint(query, args, understanding)
  const uniqueSources = [...new Set(sourceConstraint.preferredSources)].slice(0, maxAttempts)
  const attempts = uniqueSources.map((source, idx) => ({
    source,
    reason: idx === 0
      ? "first_pass"
      : source === "auto"
        ? "broaden_search"
        : "retry_constrained_source"
  }))

  return {
    query,
    toolName,
    sourceConstraint,
    attempts,
    maxAttempts,
    broadenAfterAttempt: 1,
    minResultCount: 1,
    minTopScore: 1
  }
}

function sourceTypeMatchesIntent(sourceType: string, intent: ContentIntentConstraint): boolean {
  const value = String(sourceType || "")
  if (!value) return true

  switch (intent) {
    case "video":
      return value.includes("videos") || value.includes("friday_sermons") || value.includes("wahy_friday")
    case "news":
      return value.includes("articles")
    case "biography":
      return value.includes("abbas") || value.includes("history")
    case "wahy":
      return value.includes("wahy_friday")
    case "sermon":
      return value.includes("friday_sermons") || value.includes("wahy_friday")
    case "history":
      return value.includes("history") || value.includes("abbas")
    case "language":
      return value.includes("lang")
    default:
      return true
  }
}

function shouldRejectLowConfidence(
  data: any,
  sourceConstraint: SourceConstraint,
  attemptSource: string,
  minTopScore: number
): { reject: boolean; reason?: string } {
  if (!sourceConstraint.hardConstraint) return { reject: false }
  if (attemptSource === "auto") return { reject: false }

  const count = getResultCount(data)
  const topScore = getTopScore(data)
  if (count <= 0) return { reject: false }
  if (topScore != null && topScore < minTopScore) {
    return { reject: true, reason: "top_score_below_threshold" }
  }

  const results = Array.isArray(data?.results) ? data.results : []
  if (results.length === 0) return { reject: false }

  const allMismatch = results.every((item: any) => {
    const type = item?.source_type || item?.source || ""
    return !sourceTypeMatchesIntent(type, sourceConstraint.intent)
  })

  if (allMismatch) {
    return { reject: true, reason: "source_type_mismatch" }
  }

  return { reject: false }
}

export async function orchestrateRetrieval(
  toolName: AllowedToolName,
  args: Record<string, any>,
  options: OrchestratorOptions = {}
): Promise<OrchestratorResult | null> {
  if (toolName !== "search_content" && toolName !== "search_projects") {
    return null
  }

  const query = String(args.query || args.searchTerm || args.keyword || "").trim()
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts || 3, 3))
  const understanding = options.queryUnderstanding || understandQuery(query)
  const plan = buildPlan(toolName, query, args, understanding, maxAttempts)

  if (options.traceId) {
    logChatTrace({
      trace_id: options.traceId,
      stage: "orchestrator_plan_created",
      normalized_query: normalizeQueryForTrace(query),
      routed_source: plan.attempts[0]?.source,
      details: {
        tool_name: toolName,
        max_attempts: plan.maxAttempts,
        intent: plan.sourceConstraint.intent,
        operation_intent: understanding.operation_intent,
        route_confidence: understanding.route_confidence,
        hard_constraint: plan.sourceConstraint.hardConstraint,
        attempt_sources: plan.attempts.map(a => a.source)
      }
    })
  }

  const attempts: RetrievalAttempt[] = []
  let lastResult: APICallResult = {
    success: false,
    error: "no_attempt_executed"
  }
  let fallbackApplied = false
  let lowConfidenceRejected = false

  const executeFn = options.execute || executeToolByName

  for (let i = 0; i < plan.attempts.length; i++) {
    const attemptPlan = plan.attempts[i]
    const startedAt = Date.now()

    if (options.traceId) {
      logChatTrace({
        trace_id: options.traceId,
        stage: "orchestrator_attempt_started",
        normalized_query: normalizeQueryForTrace(query),
        routed_source: attemptPlan.source,
        retry_attempts: i,
        details: {
          tool_name: toolName,
          reason: attemptPlan.reason,
          attempt_index: i + 1
        }
      })
    }

    const attemptArgs = {
      ...args,
      source: attemptPlan.source
    }
    const result = await executeFn(toolName, attemptArgs)
    lastResult = result

    const resultCount = getResultCount(result.data)
    const topScore = getTopScore(result.data)
    const empty = result.success && isEmptyAPIResponse(result.data)
    const rejection = shouldRejectLowConfidence(result.data, plan.sourceConstraint, attemptPlan.source, plan.minTopScore)

    const attempt: RetrievalAttempt = {
      index: i + 1,
      source: attemptPlan.source,
      reason: attemptPlan.reason,
      startedAt,
      finishedAt: Date.now(),
      success: result.success,
      empty,
      rejectedLowConfidence: rejection.reject,
      rejectionReason: rejection.reason,
      resultCount,
      topScore
    }
    attempts.push(attempt)

    if (options.traceId) {
      logChatTrace({
        trace_id: options.traceId,
        stage: "orchestrator_attempt_finished",
        normalized_query: normalizeQueryForTrace(query),
        routed_source: attemptPlan.source,
        retry_attempts: i,
        result_counts: resultCount,
        top_score: topScore,
        details: {
          tool_name: toolName,
          success: result.success,
          empty,
          rejected_low_confidence: rejection.reject,
          rejection_reason: rejection.reason
        }
      })
    }

    if (rejection.reject) {
      lowConfidenceRejected = true
      if (options.traceId) {
        logChatTrace({
          trace_id: options.traceId,
          stage: "orchestrator_low_confidence_rejected",
          normalized_query: normalizeQueryForTrace(query),
          routed_source: attemptPlan.source,
          retry_attempts: i,
          result_counts: resultCount,
          top_score: topScore,
          unavailable_reason: rejection.reason
        })
      }
    }

    if (result.success && !empty && !rejection.reject) {
      return {
        plan,
        attempts,
        finalResult: result,
        exhausted: false,
        fallbackApplied,
        lowConfidenceRejected,
        routedSource: attemptPlan.source,
        resultCount,
        topScore
      }
    }

    if (i < plan.attempts.length - 1) {
      fallbackApplied = true
      if (options.traceId) {
        logChatTrace({
          trace_id: options.traceId,
          stage: "orchestrator_fallback_applied",
          normalized_query: normalizeQueryForTrace(query),
          routed_source: plan.attempts[i + 1].source,
          retry_attempts: i + 1,
          details: {
            from_source: attemptPlan.source,
            to_source: plan.attempts[i + 1].source
          }
        })
      }
    }
  }

  return {
    plan,
    attempts,
    finalResult: lastResult,
    exhausted: true,
    fallbackApplied,
    lowConfidenceRejected,
    unavailableReason: "attempts_exhausted",
    routedSource: attempts[attempts.length - 1]?.source,
    resultCount: getResultCount(lastResult.data),
    topScore: getTopScore(lastResult.data)
  }
}
