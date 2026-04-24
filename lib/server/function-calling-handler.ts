/**
 * Function Calling Handler
 *
 * Manages the OpenAI Function Calling flow:
 * 1. Receives function calls from OpenAI
 * 2. Validates against the tool whitelist
 * 3. Executes via the Service Layer
 * 4. Returns results to OpenAI
 */

import OpenAI from "openai"
import { ChatCompletionMessageParam } from "openai/resources/chat/completions"
import { isAllowedTool, type AllowedToolName } from "./site-tools-definitions"
import { executeToolByName, type APICallResult } from "./site-api-service"
import { getFallbackResponse } from "./system-prompts"
import {
  isEmptyAPIResponse,
  generateNoResultsSuggestions,
  generateAPIErrorSuggestions,
  formatSuggestionsForResponse,
} from "./smart-suggestions"
import { logChatTrace, normalizeQueryForTrace } from "./observability/chat-trace"
import { orchestrateRetrieval } from "./retrieval-orchestrator"
import { deriveRetrievalCapabilitySignals, understandQuery, type QueryUnderstandingResult } from "./query-understanding"
import { getLastUserMessage, getResolvedUserQuery } from "./runtime/dialog-context-policy"
import { isOutOfScopeQuery, isSmallTalkQuery } from "./runtime/query-scope-policy"
import { buildAnswerShapeInstruction } from "./runtime/answer-shape-policy"
import { detectForcedUtilityIntent } from "./runtime/forced-utility-routing-policy"
import { getPrimaryRetrievalToolForQuery } from "./runtime/retrieval-bootstrap-policy"
import {
  isAbbasBiographyQuery,
  isOfficeHolderQuery,
  isCompoundFactQuery,
  buildCompoundCoverageInstruction,
} from "../ai/intent-detector"
import {
  injectKnowledgeAndGuard,
  tryGenerateDirectAnswer,
  buildGroundedEvidenceFallback,
} from "./knowledge/knowledge-injection"

// ── Data cleaning helpers ───────────────────────────────────────────

function truncate(text: string, max: number): string {
  if (!text || text.length <= max) return text
  return text.substring(0, max) + "…"
}

function cleanProject(project: any, detailed: boolean = false): any {
  if (!project || typeof project !== "object") return project

  const siteDomain = (process.env.SITE_DOMAIN || "https://alkafeel.net").replace(/\/+$/, "")
  const articleUrlTemplate = process.env.SITE_ARTICLE_URL_TEMPLATE || "/news/index?id={id}"
  const sourceType = project?.source_type
  const isVideoSource = ["videos_latest", "videos_by_category", "friday_sermons", "wahy_friday"].includes(sourceType)
  const isHistorySource = ["shrine_history_by_section", "shrine_history_sections"].includes(sourceType)
  const isAbbasSource = sourceType === "abbas_history_by_id"
  const mediaSlug = project?.source_raw?.request || project?.source_raw?.news_id || project?.source_raw?.article_id

  if (isHistorySource || isAbbasSource) {
    const url = isAbbasSource ? `${siteDomain}/abbas?lang=ar` : `${siteDomain}/history?lang=ar`
    return {
      id: project.id,
      name: project.name,
      description: truncate(project.description || "", detailed ? 500 : 150),
      sections: Array.isArray(project.sections) ? project.sections.map((s: any) => s.name).filter(Boolean) : [],
      url,
    }
  }

  if (isVideoSource) {
    const url = mediaSlug
      ? `${siteDomain}/media/${encodeURIComponent(String(mediaSlug))}?lang=ar`
      : (project.url || siteDomain)
    return buildProjectShape(project, url, detailed)
  }

  const derivedUrl =
    project?.source_raw?.url ||
    project?.source_raw?.link ||
    project?.source_raw?.permalink ||
    project?.source_raw?.news_url ||
    project?.source_raw?.article_url

  const fallbackUrl = (() => {
    if (!project.id) return siteDomain
    const path = articleUrlTemplate.replace("{id}", encodeURIComponent(String(project.id)))
    if (path.startsWith("http://") || path.startsWith("https://")) return path
    return `${siteDomain}${path.startsWith("/") ? path : `/${path}`}`
  })()

  return buildProjectShape(project, project.url || project.article_url || derivedUrl || fallbackUrl, detailed)
}

function buildProjectShape(project: any, url: string, detailed: boolean): any {
  const maxPropLen = detailed ? 2000 : 300
  const properties: Record<string, string> = {}
  if (Array.isArray(project.properties)) {
    for (const prop of project.properties) {
      const val = prop.pivot?.value || prop.value
      if (prop.name && val && typeof val === "string") {
        properties[prop.name] = truncate(val, maxPropLen)
      }
    }
  }
  return {
    id: project.id,
    name: project.name,
    description: truncate(project.description || "", detailed ? 500 : 150),
    sections: Array.isArray(project.sections) ? project.sections.map((s: any) => s.name).filter(Boolean) : [],
    properties: Object.keys(properties).length > 0 ? properties : undefined,
    url,
  }
}

const SOURCE_LABELS: Record<string, string> = {
  shrine_history_sections: "تاريخ العتبة",
  shrine_history_by_section: "تاريخ العتبة",
  abbas_history_by_id: "تاريخ العباس",
  articles_latest: "الأخبار",
  videos_latest: "الفيديوهات",
  videos_by_category: "الفيديوهات",
  videos_categories: "أقسام الفيديو",
  lang_words_ar: "القاموس اللغوي",
  friday_sermons: "خطب الجمعة",
  wahy_friday: "من وحي الجمعة",
}

function friendlySourceName(source: string): string {
  return SOURCE_LABELS[source] || source
}

function extractListingItems(result: APICallResult): any[] {
  const data = result?.data
  if (Array.isArray(data?.projects)) return data.projects
  if (Array.isArray(data?.items)) return data.items
  if (Array.isArray(data?.results)) return data.results
  return []
}

export function buildDeterministicLatestListAnswer(
  result: APICallResult,
  fallbackSource?: string
): string | null {
  if (!result?.success) return null

  const items = extractListingItems(result)
  if (items.length === 0) return null

  const sourceKey =
    String(result.data?.source_used || result.data?.source || fallbackSource || "").trim()
  const sourceLabel = sourceKey ? friendlySourceName(sourceKey) : "المصدر المطلوب"

  const lines: string[] = [
    `**أحدث النتائج من ${sourceLabel}**`
  ]

  for (let i = 0; i < Math.min(items.length, 5); i++) {
    const item = items[i]
    const title =
      String(item?.name || item?.title || "نتيجة بدون عنوان")
        .replace(/\s+/g, " ")
        .trim()
    const url = String(item?.url || "").trim()
    const snippet = String(item?._snippet || item?.description || "")
      .replace(/\s+/g, " ")
      .trim()

    lines.push(`${i + 1}. ${title}`)
    if (snippet) lines.push(`   ${snippet}`)
    if (url) lines.push(`   [المصدر](${url})`)
  }

  return lines.join("\n")
}

/**
 * تنظيف نتائج الـ API قبل إرسالها لـ GPT
 */
function cleanResultForGPT(result: APICallResult): any {
  if (!result.success) return result

  const data = result.data
  
  // إذا كانت نتائج بحث (results array) — مختصرة
  if (data?.results && Array.isArray(data.results)) {
    return {
      success: true,
      data: {
        results: data.results.map((p: any) => {
          const cleaned = cleanProject(p, false)
          // Preserve evidence snippet from search scoring
          if (p._snippet) cleaned._snippet = p._snippet
          return cleaned
        }),
        total: data.total,
        result_count: data.result_count,
        top_score: data.top_score,
        query: data.query,
        source_used: data.source_used ? friendlySourceName(data.source_used) : undefined,
        candidate_sources: data.candidate_sources,
        source_attempts: data.source_attempts,
      }
    }
  }

  // إذا كانت نتائج أحدث محتوى (projects array)
  if (data?.projects && Array.isArray(data.projects)) {
    return {
      success: true,
      data: {
        projects: data.projects.map((p: any) => cleanProject(p, false)),
        total: data.total,
        limit: data.limit,
        source_used: friendlySourceName(data.source_used),
      }
    }
  }

  // نتائج تصفح صفحة (browse_source_page)
  if (data?.items && Array.isArray(data.items) && data?.source) {
    return {
      success: true,
      data: {
        items: data.items.map((p: any) => cleanProject(p, false)),
        total_in_page: data.total_in_page,
        total_all: data.total_all,
        page: data.page,
        order: data.order,
        source: friendlySourceName(data.source),
        has_more: data.has_more
      }
    }
  }

  // بيانات وصفية عن مصدر واحد (get_source_metadata)
  if (data?.source && data?.friendly_name && typeof data?.total === "number") {
    return {
      success: true,
      data: {
        source: friendlySourceName(data.source),
        friendly_name: data.friendly_name,
        total: data.total,
        current_page: data.current_page,
        last_page: data.last_page,
        per_page: data.per_page,
        has_pagination: data.has_pagination,
      }
    }
  }

  // بيانات وصفية لعدة مصادر (auto)
  if (data?.sources && Array.isArray(data.sources)) {
    return {
      success: true,
      data: {
        sources: data.sources.map((s: any) => ({
          source: friendlySourceName(s.source),
          friendly_name: s.friendly_name,
          total: s.total,
          per_page: s.per_page,
          last_page: s.last_page,
          has_pagination: s.has_pagination,
        }))
      }
    }
  }

  // قوائم التصنيفات
  if (data?.categories && Array.isArray(data.categories)) {
    return {
      success: true,
      data: {
        categories: data.categories.slice(0, 50),
        total_categories: data.total_categories,
        source_used: friendlySourceName(data.source_used)
      }
    }
  }

  // إذا كان مشروع واحد — تفاصيل كاملة
  if (data?.id && data?.name) {
    return {
      success: true,
      data: cleanProject(data, true)
    }
  }

  // فئات أو إحصائيات — إرجاع كما هي
  return result
}

// ── Types ───────────────────────────────────────────────────────────

export interface FunctionCallResult {
  shouldContinue: boolean
  messages: ChatCompletionMessageParam[]
  finalResponse?: string
  error?: string
}

interface ResolveTraceSummary {
  routed_source?: string
  retry_attempts: number
  result_counts?: number
  top_score?: number | null
  unavailable_reason?: string
}

interface ToolCallContext {
  traceId?: string
  retryCounter?: { count: number }
  traceSummary?: ResolveTraceSummary
  userQuery?: string
  queryUnderstanding?: QueryUnderstandingResult
}

function getResultCountFromData(data: any): number {
  if (!data) return 0
  if (typeof data.total === "number") return data.total
  if (Array.isArray(data.results)) return data.results.length
  if (Array.isArray(data.projects)) return data.projects.length
  if (Array.isArray(data.items)) return data.items.length
  return 0
}

function getTopScoreFromData(data: any): number | null {
  if (!data) return null
  if (typeof data.top_score === "number") return data.top_score
  if (Array.isArray(data.results) && data.results.length > 0) {
    const score = data.results[0]?._score || data.results[0]?.score
    if (typeof score === "number") return score
  }
  return null
}

type ToolFailureKind = "timeout" | "rate_limit" | "upstream_unavailable" | "network" | "empty_results" | "unknown"

function classifyToolFailure(result: APICallResult, emptyResults: boolean): ToolFailureKind {
  if (emptyResults) return "empty_results"
  const text = String(result?.error || "").toLowerCase()
  if (!text) return "unknown"
  if (text.includes("request_budget_exhausted") || text.includes("timeout") || text.includes("timed out")) return "timeout"
  if (text.includes("rate limit") || text.includes("too many requests") || text.includes("429")) return "rate_limit"
  if (text.includes("503") || text.includes("502") || text.includes("504") || text.includes("service unavailable") || text.includes("gateway")) return "upstream_unavailable"
  if (text.includes("fetch") || text.includes("network") || text.includes("econn") || text.includes("enotfound") || text.includes("socket")) return "network"
  return "unknown"
}

function buildToolFailureMessage(kind: ToolFailureKind, traceId?: string): string {
  const suffix = traceId ? `\n\nرقم التتبع: ${traceId}` : ""
  switch (kind) {
    case "timeout":              return `تعذر إكمال الاستعلام في الوقت المتاح. يمكنك إعادة المحاولة أو تضييق السؤال قليلًا.${suffix}`
    case "rate_limit":           return `الخدمة تتلقى عددًا كبيرًا من الطلبات الآن. حاول بعد قليل.${suffix}`
    case "upstream_unavailable": return `مصدر الإجابة غير متاح مؤقتًا الآن. حاول بعد قليل.${suffix}`
    case "network":              return `حدثت مشكلة اتصال أثناء جلب البيانات من المصدر.${suffix}`
    case "empty_results":        return `لم أجد نتائج مؤكدة في المصادر المتاحة لهذا السؤال.${suffix}`
    default:                     return `تعذر إكمال الإجابة بسبب خلل مؤقت في مسار الاسترجاع.${suffix}`
  }
}

const ALLOWED_UTILITY_TOOLS = new Set([
  "get_source_metadata",
  "browse_source_page",
  "get_latest_by_source",
  "list_source_categories",
  "get_statistics",
])

function getPostBootstrapUtilityTools(
  tools: OpenAI.Chat.Completions.ChatCompletionTool[]
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.filter(t => t.type !== "function" || ALLOWED_UTILITY_TOOLS.has(t.function?.name))
}

// ── Tool execution ──────────────────────────────────────────────────

async function processToolCall(
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  context: ToolCallContext = {}
): Promise<{ tool_call_id: string; role: "tool"; content: string }> {
  const toolName = toolCall.function.name
  const toolCallId = toolCall.id
  console.log(`[Function Call] Tool: ${toolName}, ID: ${toolCallId}`)

  if (!isAllowedTool(toolName)) {
    console.error(`[Function Call] Rejected: ${toolName} not in whitelist`)
    return {
      tool_call_id: toolCallId,
      role: "tool",
      content: JSON.stringify({ success: false, error: `الأداة "${toolName}" غير مسموحة`, message: "هذه الأداة غير متاحة حالياً في النظام." }),
    }
  }

  let args: Record<string, any>
  try {
    args = JSON.parse(toolCall.function.arguments || "{}")
  } catch {
    return {
      tool_call_id: toolCallId,
      role: "tool",
      content: JSON.stringify({ success: false, error: "معاملات غير صالحة", message: "حدث خطأ في تحليل المعاملات." }),
    }
  }

  let result: APICallResult
  const isRetrievalTool = toolName === "search_content" || toolName === "search_projects"

  if (isRetrievalTool) {
    const retrievalUnderstanding = context.queryUnderstanding || understandQuery(String(args.query || context.userQuery || ""))
    const orchestrated = await orchestrateRetrieval(toolName as AllowedToolName, args, {
      traceId: context.traceId,
      requestBudgetMs: Number(process.env.RETRIEVAL_REQUEST_BUDGET_MS || 18000),
      queryUnderstanding: retrievalUnderstanding,
    })
    if (orchestrated) {
      result = orchestrated.finalResult
      if (context.retryCounter) context.retryCounter.count += Math.max(0, orchestrated.attempts.length - 1)
      if (context.traceSummary) {
        context.traceSummary.routed_source = orchestrated.routedSource || context.traceSummary.routed_source
        context.traceSummary.result_counts = orchestrated.resultCount
        context.traceSummary.top_score = orchestrated.topScore
        if (orchestrated.exhausted) context.traceSummary.unavailable_reason = orchestrated.unavailableReason
      }
    } else {
      result = await executeToolByName(toolName as AllowedToolName, args)
    }

    // Relaxed retry for "نداء العقيدة" named-event queries
    if (result.success && isEmptyAPIResponse(result.data) && typeof args.query === "string") {
      const relaxedQuery = args.query.replace(/نداء\s+العقيدة/g, "العقيدة")
      if (relaxedQuery !== args.query) {
        const relaxed = await executeToolByName(toolName as AllowedToolName, { ...args, query: relaxedQuery, source: args.source || "auto" })
        if (relaxed.success && !isEmptyAPIResponse(relaxed.data)) result = relaxed
      }
    }

    // Cross-tool fallback: search_projects با zero results → retry via search_content
    // هذا يضمن الوصول للمقالات والأقسام عندما لا يوجد مشروع بالاسم الحرفي
    if (toolName === "search_projects" && result.success && isEmptyAPIResponse(result.data) && typeof args.query === "string") {
      const contentFallback = await executeToolByName("search_content", { query: args.query, source: "auto", limit: args.limit })
      if (contentFallback.success && !isEmptyAPIResponse(contentFallback.data)) {
        result = contentFallback
      }
    }
  } else {
    result = await executeToolByName(toolName as AllowedToolName, args)
  }

  const traceQuery = args.query || context.userQuery || ""

  if (context.traceId) {
    const resultCount = getResultCountFromData(result.data)
    const topScore = getTopScoreFromData(result.data)
    const routedSource = result.data?.source_used || result.data?.source || result.data?.routed_source || args.source
    logChatTrace({
      trace_id: context.traceId,
      stage: "tool_result",
      normalized_query: normalizeQueryForTrace(traceQuery),
      routed_source: routedSource,
      result_counts: resultCount,
      top_score: topScore,
      details: { tool_name: toolName, success: result.success },
    })
    if (context.traceSummary) {
      if (typeof routedSource === "string" && routedSource.trim()) context.traceSummary.routed_source = routedSource
      context.traceSummary.result_counts = resultCount
      context.traceSummary.top_score = topScore
    }
  }

  if (result.success && isEmptyAPIResponse(result.data)) {
    console.log(`[Function Call] Empty results — generating suggestions`)
    if (context.traceId) {
      logChatTrace({
        trace_id: context.traceId,
        stage: "empty_results_fallback",
        normalized_query: normalizeQueryForTrace(String(args.query || context.userQuery || "")),
        routed_source: args.source,
        retry_attempts: context.retryCounter?.count || 0,
        unavailable_reason: "empty_results_after_retries",
        details: { tool_name: toolName },
      })
    }
    const query = args.query || args.searchTerm || args.keyword || ""
    const suggestionsResponse = generateNoResultsSuggestions(query, { searchedCategory: args.category, attemptedAction: toolName })
    const failureKind = classifyToolFailure(result, true)
    return {
      tool_call_id: toolCallId,
      role: "tool",
      content: JSON.stringify({
        success: false,
        empty_results: true,
        failure_kind: failureKind,
        retry_attempts: context.retryCounter?.count || 0,
        message: `${buildToolFailureMessage(failureKind, context.traceId)}\n\n${formatSuggestionsForResponse(suggestionsResponse)}`,
        suggestions: suggestionsResponse.suggestions,
        context: suggestionsResponse.context,
        original_query: query,
      }),
    }
  }

  if (!result.success) {
    console.error(`[Function Call] API Error:`, result.error)
    if (context.traceId) {
      logChatTrace({
        trace_id: context.traceId,
        stage: "tool_error_fallback",
        normalized_query: normalizeQueryForTrace(String(args.query || context.userQuery || "")),
        routed_source: args.source,
        retry_attempts: context.retryCounter?.count || 0,
        unavailable_reason: String(result.error || "tool_execution_failed"),
        details: { tool_name: toolName },
      })
    }
    const errorSuggestions = generateAPIErrorSuggestions()
    const failureKind = classifyToolFailure(result, false)
    return {
      tool_call_id: toolCallId,
      role: "tool",
      content: JSON.stringify({
        success: false,
        failure_kind: failureKind,
        error: result.error,
        message: `${buildToolFailureMessage(failureKind, context.traceId)}\n\n${formatSuggestionsForResponse(errorSuggestions)}`,
        suggestions: errorSuggestions.suggestions,
        context: errorSuggestions.context,
      }),
    }
  }

  console.log(`[Function Call] Result: ${result.success ? "Success" : "Failed"}`)
  return { tool_call_id: toolCallId, role: "tool" as const, content: JSON.stringify(cleanResultForGPT(result)) }
}

/**
 * معالجة مجموعة tool calls من OpenAI
 * 
 * @param toolCalls - قائمة الأدوات المطلوب استدعاءها
 */
export async function handleToolCalls(
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
  context: ToolCallContext = {}
): Promise<ChatCompletionMessageParam[]> {
  const toolResponses: ChatCompletionMessageParam[] = []

  // معالجة كل أداة
  for (const toolCall of toolCalls) {
    const response = await processToolCall(toolCall, context)
    toolResponses.push(response)
  }

  return toolResponses
}

// ── Main resolution loop ────────────────────────────────────────────

export async function resolveToolCalls(
  openai: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  maxIterations: number = 3,
  options: { traceId?: string; queryUnderstanding?: QueryUnderstandingResult } = {}
): Promise<{
  resolvedMessages: ChatCompletionMessageParam[]
  needsFinalCall: boolean
  iterations: number
  directAnswer?: string
  fallbackAnswer?: string
  trace?: ResolveTraceSummary
}> {
  let currentMessages = [...messages]
  let iterations = 0
  let toolsWereCalled = false
  let orchestratorBootstrapped = false
  let groundedFallbackAnswer: string | undefined
  const retryCounter = { count: 0 }
  const traceSummary: ResolveTraceSummary = { retry_attempts: 0 }

  const rawUserQuery = getLastUserMessage(messages)
  const rawUnderstanding = options.queryUnderstanding || understandQuery(rawUserQuery)
  const userQuery = getResolvedUserQuery(messages, rawUnderstanding)
  const queryUnderstanding = options.queryUnderstanding || understandQuery(userQuery)
  const capability = deriveRetrievalCapabilitySignals(queryUnderstanding, userQuery)

  // Inject answer-shape and compound-coverage instructions
  const shapeHint = buildAnswerShapeInstruction(userQuery)
  if (shapeHint) currentMessages.push({ role: "system", content: shapeHint })
  const coverageHint = buildCompoundCoverageInstruction(userQuery)
  if (coverageHint) currentMessages.push({ role: "system", content: coverageHint })

  if (options.traceId) {
    logChatTrace({
      trace_id: options.traceId,
      stage: "query_understanding",
      normalized_query: queryUnderstanding.normalized_query,
      routed_source: queryUnderstanding.hinted_sources[0],
      details: {
        content_intent: queryUnderstanding.content_intent,
        operation_intent: queryUnderstanding.operation_intent,
        route_confidence: queryUnderstanding.route_confidence,
        extracted_entities: queryUnderstanding.extracted_entities,
      },
    })
  }

  // ── Forced utility intent ───────────────────────────────────────────
  const forcedIntent = detectForcedUtilityIntent(userQuery, queryUnderstanding, isAbbasBiographyQuery)
  if (forcedIntent) {
    if (options.traceId) logChatTrace({ trace_id: options.traceId, stage: "forced_intent_utility", normalized_query: normalizeQueryForTrace(userQuery), routed_source: forcedIntent.args?.source, details: { forced_tool: forcedIntent.tool } })
    const forcedResult = await executeToolByName(forcedIntent.tool, forcedIntent.args)
    const synthId = `forced_${forcedIntent.tool}_${Date.now()}`
    currentMessages.push({ role: "assistant", content: null, tool_calls: [{ id: synthId, type: "function", function: { name: forcedIntent.tool, arguments: JSON.stringify(forcedIntent.args) } }] })
    const isEmpty = forcedResult.success && isEmptyAPIResponse(forcedResult.data)
    currentMessages.push({ role: "tool", tool_call_id: synthId, content: isEmpty ? JSON.stringify({ success: false, empty_results: true, message: "لا توجد نتائج من هذا المصدر حالياً" }) : JSON.stringify(cleanResultForGPT(forcedResult)) })

    if (forcedIntent.tool === "get_latest_by_source" || forcedIntent.tool === "browse_source_page") {
      const det = buildDeterministicLatestListAnswer(forcedResult, String(forcedIntent.args?.source || ""))
      if (det) return { resolvedMessages: currentMessages, needsFinalCall: false, iterations: 0, directAnswer: det, trace: { ...traceSummary, retry_attempts: retryCounter.count, routed_source: forcedIntent.args?.source, result_counts: getResultCountFromData(forcedResult.data), top_score: getTopScoreFromData(forcedResult.data) } }
    }

    const forcedEvidence = await injectKnowledgeAndGuard(currentMessages, userQuery, queryUnderstanding)
    const forcedDirect = tryGenerateDirectAnswer(userQuery, forcedEvidence)
    if (forcedDirect) return { resolvedMessages: currentMessages, needsFinalCall: false, iterations: 0, directAnswer: forcedDirect, trace: { ...traceSummary, retry_attempts: retryCounter.count, routed_source: forcedIntent.args?.source } }

    return { resolvedMessages: currentMessages, needsFinalCall: true, iterations: 0, fallbackAnswer: buildGroundedEvidenceFallback(userQuery, forcedEvidence) || groundedFallbackAnswer, trace: { ...traceSummary, retry_attempts: retryCounter.count } }
  }

  // ── Orchestrator bootstrap — runs for every real query (not small-talk) ───
  if (!isSmallTalkQuery(userQuery)) {
    const primaryTool = getPrimaryRetrievalToolForQuery(userQuery, queryUnderstanding)
    const orchestrated = await orchestrateRetrieval(primaryTool, { query: userQuery, source: "auto" }, { traceId: options.traceId, queryUnderstanding })

    if (orchestrated) {
      if (options.traceId) logChatTrace({ trace_id: options.traceId, stage: "orchestrator_runtime_takeover", normalized_query: normalizeQueryForTrace(userQuery), routed_source: orchestrated.routedSource, retry_attempts: Math.max(0, orchestrated.attempts.length - 1), result_counts: orchestrated.resultCount, top_score: orchestrated.topScore, unavailable_reason: orchestrated.exhausted ? orchestrated.unavailableReason : undefined })
      retryCounter.count += Math.max(0, orchestrated.attempts.length - 1)
      traceSummary.routed_source = orchestrated.routedSource || traceSummary.routed_source
      traceSummary.result_counts = orchestrated.resultCount
      traceSummary.top_score = orchestrated.topScore
      if (orchestrated.exhausted) traceSummary.unavailable_reason = orchestrated.unavailableReason

      // Search exhausted all sources with no results → refuse the query,
      // BUT for knowledge-layer-eligible queries (e.g. Abbas biography), still
      // push the empty result and let knowledge injection attempt to resolve the gap.
      const allowBroadRecallFallback =
        queryUnderstanding.clarity === "underspecified" ||
        capability.institutional_relation ||
        capability.title_or_phrase_lookup

      // When the orchestrator exhausts every retrieval source we used to
      // immediately return FALLBACK_NO_RESULTS for "narrow" queries (anything
      // that wasn't biography / institutional / underspecified). That short-
      // circuit prevented the knowledge layer from rescuing answers that were
      // present in the indexed full-text but missed by the keyword-driven
      // retrieval. We now always give the knowledge layer + grounded fallback
      // a chance before declaring "no results"; the apology is only used as a
      // last resort when knowledge also returns nothing.
      if (
        orchestrated.exhausted &&
        orchestrated.unavailableReason === "attempts_exhausted" &&
        !isAbbasBiographyQuery(userQuery) &&
        !allowBroadRecallFallback
      ) {
        if (options.traceId) {
          logChatTrace({
            trace_id: options.traceId,
            stage: "exhausted_pre_knowledge_rescue",
            normalized_query: normalizeQueryForTrace(userQuery),
            details: { reason: "attempting_knowledge_layer_before_fallback" },
          })
        }

        const exhaustSynthId = `bootstrap_${primaryTool}_exhausted_${Date.now()}`
        currentMessages.push({
          role: "assistant",
          content: null,
          tool_calls: [{
            id: exhaustSynthId,
            type: "function",
            function: { name: primaryTool, arguments: JSON.stringify({ query: userQuery, source: orchestrated.routedSource || "auto" }) }
          }]
        })
        currentMessages.push({
          role: "tool",
          tool_call_id: exhaustSynthId,
          content: JSON.stringify({ success: false, empty_results: true, message: "لم تُرجع المصادر المُجدولة نتائج كافية." })
        })

        const rescueEvidence = await injectKnowledgeAndGuard(currentMessages, userQuery, queryUnderstanding)
        const rescueDirect = tryGenerateDirectAnswer(userQuery, rescueEvidence)
        if (rescueDirect) {
          return {
            resolvedMessages: currentMessages,
            needsFinalCall: false,
            iterations: 0,
            directAnswer: rescueDirect,
            trace: { ...traceSummary, retry_attempts: retryCounter.count }
          }
        }

        const rescueFallback = buildGroundedEvidenceFallback(userQuery, rescueEvidence)
        if (rescueFallback) {
          return {
            resolvedMessages: currentMessages,
            needsFinalCall: false,
            iterations: 0,
            directAnswer: rescueFallback,
            trace: { ...traceSummary, retry_attempts: retryCounter.count }
          }
        }

        // Knowledge had nothing either — let the LLM try one final pass with
        // the full message history (which now includes the knowledge context
        // injected by injectKnowledgeAndGuard, if any). This keeps the model
        // from being silenced when retrieval found weak signal that it might
        // still be able to surface coherently.
        toolsWereCalled = true
        orchestratorBootstrapped = true
        groundedFallbackAnswer = buildGroundedEvidenceFallback(userQuery, rescueEvidence) || groundedFallbackAnswer

        if (options.traceId) {
          logChatTrace({
            trace_id: options.traceId,
            stage: "out_of_scope_rejected",
            normalized_query: normalizeQueryForTrace(userQuery),
            details: { reason: "no_results_after_knowledge_rescue" },
          })
        }
      }

      if (
        orchestrated.exhausted &&
        orchestrated.unavailableReason === "attempts_exhausted" &&
        primaryTool === "search_content" &&
        (capability.institutional_relation || capability.singular_project_lookup)
      ) {
        const secondaryOrchestrated = await orchestrateRetrieval(
          "search_projects",
          { query: userQuery, source: "auto" },
          { traceId: options.traceId, queryUnderstanding }
        )

        if (secondaryOrchestrated) {
          retryCounter.count += Math.max(0, secondaryOrchestrated.attempts.length - 1)
          traceSummary.routed_source = secondaryOrchestrated.routedSource || traceSummary.routed_source
          traceSummary.result_counts = secondaryOrchestrated.resultCount
          traceSummary.top_score = secondaryOrchestrated.topScore
          if (secondaryOrchestrated.exhausted) {
            traceSummary.unavailable_reason = secondaryOrchestrated.unavailableReason
          }

          const secondarySynthId = `bootstrap_search_projects_${Date.now()}`
          currentMessages.push({
            role: "assistant",
            content: null,
            tool_calls: [{
              id: secondarySynthId,
              type: "function",
              function: { name: "search_projects", arguments: JSON.stringify({ query: userQuery, source: secondaryOrchestrated.routedSource || "auto" }) }
            }]
          })
          currentMessages.push({
            role: "tool",
            tool_call_id: secondarySynthId,
            content: JSON.stringify(cleanResultForGPT(secondaryOrchestrated.finalResult))
          })

          const secondaryEvidence = await injectKnowledgeAndGuard(currentMessages, userQuery, queryUnderstanding)
          const secondaryDirect = tryGenerateDirectAnswer(userQuery, secondaryEvidence)
          if (secondaryDirect) {
            return {
              resolvedMessages: currentMessages,
              needsFinalCall: false,
              iterations,
              directAnswer: secondaryDirect,
              trace: { ...traceSummary, retry_attempts: retryCounter.count }
            }
          }

          groundedFallbackAnswer = buildGroundedEvidenceFallback(userQuery, secondaryEvidence) || groundedFallbackAnswer
          toolsWereCalled = true
        }
      }

      const synthId = `bootstrap_${primaryTool}_${Date.now()}`
      currentMessages.push({ role: "assistant", content: null, tool_calls: [{ id: synthId, type: "function", function: { name: primaryTool, arguments: JSON.stringify({ query: userQuery, source: orchestrated.routedSource || "auto" }) } }] })
      currentMessages.push({ role: "tool", tool_call_id: synthId, content: JSON.stringify(cleanResultForGPT(orchestrated.finalResult)) })

      const bootEvidence = await injectKnowledgeAndGuard(currentMessages, userQuery, queryUnderstanding)
      const bootDirect = tryGenerateDirectAnswer(userQuery, bootEvidence)
      if (bootDirect) return { resolvedMessages: currentMessages, needsFinalCall: false, iterations, directAnswer: bootDirect, trace: { ...traceSummary, retry_attempts: retryCounter.count } }
      groundedFallbackAnswer = buildGroundedEvidenceFallback(userQuery, bootEvidence) || groundedFallbackAnswer
      toolsWereCalled = true
      orchestratorBootstrapped = true
    }
  }

  // ── LLM tool-call loop ──────────────────────────────────────────────
  while (iterations < maxIterations) {
    iterations++
    const loopTools = orchestratorBootstrapped ? getPostBootstrapUtilityTools(tools) : tools
    const response = await openai.chat.completions.create({ model, messages: currentMessages, ...(loopTools.length > 0 ? { tools: loopTools, tool_choice: "auto" } : {}), temperature: 0.2, max_tokens: 1200 })
    const assistantMsg = response.choices[0].message
    currentMessages.push(assistantMsg)

    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      if (toolsWereCalled) {
        currentMessages.pop()
        const loopEvidence = await injectKnowledgeAndGuard(currentMessages, userQuery, queryUnderstanding)
        const loopDirect = tryGenerateDirectAnswer(userQuery, loopEvidence)
        if (loopDirect) return { resolvedMessages: currentMessages, needsFinalCall: false, iterations, directAnswer: loopDirect, trace: { ...traceSummary, retry_attempts: retryCounter.count } }
        return { resolvedMessages: currentMessages, needsFinalCall: true, iterations, fallbackAnswer: buildGroundedEvidenceFallback(userQuery, loopEvidence) || groundedFallbackAnswer, trace: { ...traceSummary, retry_attempts: retryCounter.count } }
      }
      // LLM answered without calling any search tool → block if query is out of scope
      if (isOutOfScopeQuery(userQuery, queryUnderstanding)) {
        return { resolvedMessages: currentMessages, needsFinalCall: false, iterations, directAnswer: getFallbackResponse("out_of_scope"), trace: { ...traceSummary, retry_attempts: retryCounter.count, unavailable_reason: "out_of_scope" } }
      }
      return { resolvedMessages: currentMessages, needsFinalCall: false, iterations, directAnswer: assistantMsg.content || "", trace: { ...traceSummary, retry_attempts: retryCounter.count } }
    }

    toolsWereCalled = true
    const toolResponses = await handleToolCalls(assistantMsg.tool_calls, { traceId: options.traceId, retryCounter, traceSummary, userQuery, queryUnderstanding })
    currentMessages.push(...toolResponses)
  }

  // Max iterations reached
  const finalEvidence = await injectKnowledgeAndGuard(currentMessages, userQuery, queryUnderstanding)
  const finalDirect = tryGenerateDirectAnswer(userQuery, finalEvidence)
  if (finalDirect) return { resolvedMessages: currentMessages, needsFinalCall: false, iterations, directAnswer: finalDirect, trace: { ...traceSummary, retry_attempts: retryCounter.count } }
  return { resolvedMessages: currentMessages, needsFinalCall: true, iterations, fallbackAnswer: buildGroundedEvidenceFallback(userQuery, finalEvidence) || groundedFallbackAnswer, trace: { ...traceSummary, retry_attempts: retryCounter.count } }
}

export async function executeFunctionCallingFlow(
  openai: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  maxIterations: number = 3
): Promise<{ finalMessage: string; allMessages: ChatCompletionMessageParam[]; iterations: number }> {
  const rawUserQuery = getLastUserMessage(messages)
  const userQuery = getResolvedUserQuery(messages, understandQuery(rawUserQuery))
  const queryUnderstanding = understandQuery(userQuery)

  let currentMessages = [...messages]
  let iterations = 0
  let finalResponse = ""
  let toolsWereCalled = false

  while (iterations < maxIterations) {
    iterations++
    const response = await openai.chat.completions.create({ model, messages: currentMessages, tools, tool_choice: "auto", temperature: 0.5, max_tokens: 1200 })
    const assistantMsg = response.choices[0].message
    currentMessages.push(assistantMsg)
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      if (!toolsWereCalled && isOutOfScopeQuery(userQuery, queryUnderstanding)) {
        return { finalMessage: getFallbackResponse("out_of_scope"), allMessages: currentMessages, iterations }
      }
      finalResponse = assistantMsg.content || ""
      break
    }
    toolsWereCalled = true
    currentMessages.push(...await handleToolCalls(assistantMsg.tool_calls))
  }

  return { finalMessage: finalResponse || getFallbackResponse("api_error"), allMessages: currentMessages, iterations }
}

export async function executeSimpleFunctionCall(
  openai: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[]
): Promise<string> {
  try {
    const rawUserQuery = getLastUserMessage(messages)
    const userQuery = getResolvedUserQuery(messages, understandQuery(rawUserQuery))
    const queryUnderstanding = understandQuery(userQuery)

    const first = await openai.chat.completions.create({ model, messages, tools, tool_choice: "auto", temperature: 0.7 })
    const firstMsg = first.choices[0].message
    if (!firstMsg.tool_calls || firstMsg.tool_calls.length === 0) {
      if (isOutOfScopeQuery(userQuery, queryUnderstanding)) return getFallbackResponse("out_of_scope")
      return firstMsg.content || ""
    }
    const toolResponses = await handleToolCalls(firstMsg.tool_calls)
    const second = await openai.chat.completions.create({ model, messages: [...messages, firstMsg, ...toolResponses], temperature: 0.7 })
    return second.choices[0].message.content || ""
  } catch (error: any) {
    console.error("[Simple Function Call] Error:", error)
    return getFallbackResponse("api_error")
  }
}
