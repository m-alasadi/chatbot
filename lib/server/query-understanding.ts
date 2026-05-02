import { normalizeQueryForTrace } from "./observability/chat-trace"
import type { PersonRelationSlot } from "../ai/paraphrase-intent"

export type QueryContentIntent =
  | "news"
  | "video"
  | "biography"
  | "history"
  | "sermon"
  | "wahy"
  | "generic"

export type QueryOperationIntent =
  | "fact_question"
  | "list_items"
  | "latest"
  | "count"
  | "summarize"
  | "explain"
  | "classify"
  | "direct_answer"
  | "browse"

export type QueryClarity = "clear" | "underspecified"

export interface QueryExtractedEntities {
  person: string[]
  topic: string[]
  place: string[]
  source_specific: string[]
}

export interface QueryUnderstandingResult {
  raw_query: string
  normalized_query: string
  content_intent: QueryContentIntent
  operation_intent: QueryOperationIntent
  clarity: QueryClarity
  extracted_entities: QueryExtractedEntities
  hinted_sources: string[]
  route_confidence: number
  person_relation_slot?: PersonRelationSlot | null

  clean_search_query?: string
  main_topic?: string
  keywords?: string[]
  allowed_sources?: string[]
  forbidden_sources?: string[]
  needs_clarification?: boolean
  clarification_question?: string
  ai_confidence?: number
  ai_reason?: string
  understanding_source?: "ai" | "regex" | "ai+regex"
}

export interface RetrievalCapabilitySignals {
  office_holder_fact: boolean
  named_event_or_program: boolean
  person_attribute_fact: boolean
  singular_project_lookup: boolean
  institutional_relation: boolean
  title_or_phrase_lookup: boolean
  underspecified_query: boolean
  entity_first_mode: boolean
  entity_first_reason: string
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function getGenericContentTokens(text: string): string[] {
  const norm = normalizeQueryForTrace(text)
  if (!norm) return []

  const stripped = norm
    .replace(/\b(?:ما|ماذا|من|هو|هي|هل|هناك|هنالك|عن|في|على|الى|إلى|او|أو|ثم|هذا|هذه|ذلك|تلك|مع|اذا|إذا|لكن|ولاكن|لي|لك|باسم|اسم|بعنوان)\b/gu, " ")
    .replace(/\b(?:اعطني|اعرض|ابحث|اشرح|حدثني|اخبرني|عرفني|كيف|كم|عدد)\b/gu, " ")
    .replace(/\s+/g, " ")
    .trim()

  return stripped.split(/\s+/).filter(t => t.length >= 2)
}

function hasExplicitQuestionCue(norm: string): boolean {
  return /(?:^|\s)(?:ما|ماذا|من|هل|كم|كيف|متى|أين|لماذا|اشرح|عرفني|حدثني|اعطني|اعرض|اخبرني)(?:\s|$)/u.test(norm)
}



function isTitleOrPhraseLookup(raw: string, norm: string, operationIntent: QueryOperationIntent): boolean {
  if (!raw || !norm) return false
  if (operationIntent !== "fact_question") return false
  if (hasExplicitQuestionCue(norm)) return false

  const rawTokens = raw.split(/\s+/).filter(Boolean)
  if (rawTokens.length < 2 || rawTokens.length > 9) return false

  const hasArabicWords = /[\u0621-\u064A]{2,}/u.test(raw)
  const looksCommand = /(?:^|\s)(?:اعرض|اعطني|ابحث|اشرح|حدثني|اخبرني|عرفني)(?:\s|$)/u.test(norm)

  return hasArabicWords && !looksCommand
}

function detectQueryClarity(raw: string, norm: string, operationIntent: QueryOperationIntent): QueryClarity {
  const rawTokens = raw.split(/\s+/).filter(Boolean)
  const contentTokens = getGenericContentTokens(raw)

  if (contentTokens.length === 0) return "underspecified"
  if (rawTokens.length <= 2 && contentTokens.length <= 2) return "underspecified"
  if (contentTokens.length <= 1 && operationIntent === "fact_question") return "underspecified"

  return "clear"
}

function isStructuralSingularLookup(understanding: QueryUnderstandingResult, norm: string): boolean {
  const asksCount =
    understanding.operation_intent === "count" ||
    norm.includes(normalizeQueryForTrace("كم")) ||
    norm.includes(normalizeQueryForTrace("عدد")) ||
    norm.includes(normalizeQueryForTrace("اجمالي")) ||
    norm.includes(normalizeQueryForTrace("إجمالي")) ||
    norm.includes(normalizeQueryForTrace("مجموع"))

  const isLookupShape =
    understanding.operation_intent === "fact_question" ||
    understanding.operation_intent === "direct_answer"

  const contentTokens = getGenericContentTokens(norm)
  const hasEntitySignal =
    understanding.extracted_entities.person.length > 0 ||
    understanding.extracted_entities.topic.length > 0 ||
    understanding.extracted_entities.place.length > 0 ||
    contentTokens.length > 0

  const looksPluralAggregate = /(?:^|\s)(?:مشاريع|المشاريع|برامج|فعاليات)(?:\s|$)/u.test(norm)
  const hasExistentialCue =
    norm.includes(normalizeQueryForTrace("هل")) ||
    norm.includes(normalizeQueryForTrace("هل يوجد")) ||
    norm.includes(normalizeQueryForTrace("هل هناك")) ||
    norm.includes(normalizeQueryForTrace("هل هنالك"))

  return isLookupShape && hasEntitySignal && hasExistentialCue && !asksCount && !looksPluralAggregate
}



function detectOperationIntent(norm: string): QueryOperationIntent {
  // مساعد: يبني regex يطابق كلمة كاملة فقط (بحدود مسافة/بداية/نهاية/علامة ترقيم).
  // هذا ضروري لأن JS regex \b لا يعمل مع الحروف العربية، فبدونه تُفعَّل
  // كلمات غير مقصودة (مثل "صفوان" تطابق "صف" → explain خاطئ).
  const W_START = "(?:^|[\\s،.!؟?,])"
  const W_END = "(?:$|[\\s،.!؟?,])"
  const wholeWord = (alts: string) => new RegExp(`${W_START}(?:${alts})${W_END}`, "u")

  const hasCount = wholeWord("كم|عدد|اجمالي|إجمالي|مجموع|احصاء|إحصاء").test(norm)
  const hasLatest = wholeWord("احدث|أحدث|اخر|آخر|الجديد").test(norm)
  const hasList = wholeWord("اعرض|عرض|هات|قائمة|لائحه|لائحة|list").test(norm)
  const hasSummarize = wholeWord("لخص|تلخيص|خلاصه|خلاصة|ملخص|اختصر").test(norm)
  const hasExplain = wholeWord("اشرح|شرح|فسر|تفسير|وضح|توضيح|كيف|صف|وصف|تكلم|حدثني|عرفني").test(norm)
  const hasClassify = /(?:فعاليه\s+ام|فعالية\s+ام|برنامج\s+ام|خبر\s+ام|صنف|تصنيف)/u.test(norm)
  const hasDirect = /(?:الجواب\s+المباشر|جواب\s+مباشر|في\s+سطرين|دون\s+عناوين|دون\s+روابط)/u.test(norm)
  const hasBrowse = wholeWord("تصفح|صفحه|صفحة|الصفحه|الصفحة|اقدم|اول|oldest|first").test(norm)
  const hasFollowUpSummary = /(?:اول\s+نتيجة|أول\s+نتيجة|النتيجة\s+التي\s+ذكرتها|الخبر\s+الذي\s+ذكرته|التي\s+ذكرتها|الذي\s+ذكرته)/u.test(norm)

  if (hasCount) return "count"
  if (hasFollowUpSummary && hasSummarize) return "summarize"
  if (hasLatest) return hasList ? "latest" : "list_items"
  if (hasList) return "list_items"
  if (hasSummarize) return "summarize"
  if (hasExplain) return "explain"
  if (hasClassify) return "classify"
  if (hasDirect) return "direct_answer"
  if (hasBrowse) return "browse"
  return "fact_question"
}

function extractEntities(rawQuery: string): QueryExtractedEntities {
  const contentTokens = getGenericContentTokens(rawQuery)
  const topic: string[] = []
  if (contentTokens.length >= 2) topic.push(contentTokens.slice(0, 3).join(" "))
  if (contentTokens.length >= 3) topic.push(contentTokens.slice(0, 2).join(" "))

  return {
    person: [],
    topic: uniq(topic),
    place: [],
    source_specific: [],
  }
}

function deriveHintedSources(): string[] {
  return ["auto"]
}

function computeConfidence(operationIntent: QueryOperationIntent, entities: QueryExtractedEntities): number {
  let score = 0.45
  if (operationIntent !== "fact_question") score += 0.15
  if (entities.topic.length > 0) score += 0.06
  return Math.max(0.1, Math.min(0.99, Number(score.toFixed(2))))
}

const _understandCache = new Map<string, QueryUnderstandingResult>()
const _UNDERSTAND_CACHE_MAX = 200

export function understandQuery(query: string): QueryUnderstandingResult {
  const raw = String(query || "").trim()
  const norm = normalizeQueryForTrace(raw)

  const cacheKey = norm
  const cached = _understandCache.get(cacheKey)
  if (cached) return cached

  const operationIntent = detectOperationIntent(norm)
  const clarity = detectQueryClarity(raw, norm, operationIntent)
  const entities = extractEntities(raw)
  const hintedSources = deriveHintedSources()
  const baseConfidence = computeConfidence(operationIntent, entities)
  const routeConfidence = clarity === "underspecified" ? Math.max(0.1, Number((baseConfidence - 0.12).toFixed(2))) : baseConfidence

  const result: QueryUnderstandingResult = {
    raw_query: raw,
    normalized_query: norm,
    content_intent: "generic", // enriched by LLM in understandQueryWithFallback
    operation_intent: operationIntent,
    clarity,
    extracted_entities: entities,
    hinted_sources: hintedSources,
    route_confidence: routeConfidence,
  }

  if (_understandCache.size >= _UNDERSTAND_CACHE_MAX) {
    const firstKey = _understandCache.keys().next().value
    if (firstKey !== undefined) _understandCache.delete(firstKey)
  }
  _understandCache.set(cacheKey, result)
  return result
}

export function deriveRetrievalCapabilitySignals(
  understanding: QueryUnderstandingResult,
  rawQuery?: string,
): RetrievalCapabilitySignals {
  const norm = rawQuery ? normalizeQueryForTrace(rawQuery) : understanding.normalized_query

  const titleOrPhraseLookup = isTitleOrPhraseLookup(understanding.raw_query, norm, understanding.operation_intent)
  const underspecifiedQuery = understanding.clarity === "underspecified"
  const singularProjectLookup = isStructuralSingularLookup(understanding, norm)

  const entityFirstReason =
    !underspecifiedQuery && understanding.extracted_entities.topic.length > 0
      ? "entity_fact_query"
      : "general"
  const entityFirstMode = entityFirstReason !== "general" && !underspecifiedQuery

  return {
    office_holder_fact: false,
    named_event_or_program: false,
    person_attribute_fact: false,
    singular_project_lookup: singularProjectLookup,
    institutional_relation: false,
    title_or_phrase_lookup: titleOrPhraseLookup,
    underspecified_query: underspecifiedQuery,
    entity_first_mode: entityFirstMode,
    entity_first_reason: entityFirstReason,
  }
}

export function getQueryClassKey(understanding: QueryUnderstandingResult): string {
  return `${understanding.operation_intent}:${understanding.content_intent}`
}

export async function understandQueryWithFallback(
  query: string,
  openaiApiKey?: string,
  model?: string,
): Promise<QueryUnderstandingResult> {
  const regexResult = understandQuery(query)
  regexResult.understanding_source = "regex"

  if (process.env.ENABLE_AI_QUERY_UNDERSTANDING === "false") return regexResult
  if (!openaiApiKey) return regexResult

  const trimmed = query.trim()
  if (trimmed.length < 3) return regexResult

  try {
    const { resolveQueryUnderstandingWithAI, mapAIResultToUnderstanding } =
      await import("../ai/llm-intent-resolver")

    const ai = await resolveQueryUnderstandingWithAI(
      query,
      openaiApiKey,
      model ?? (process.env.OPENAI_MODEL || "gpt-4o-mini"),
    )
    if (!ai) return regexResult

    return mapAIResultToUnderstanding(query, ai, regexResult)
  } catch {
    return regexResult
  }
}
