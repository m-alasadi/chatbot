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
  /**
   * Set by LLMIntentResolver when the regex layer confidence is low.
   * Downstream consumers (answer-shape-policy, paraphrase-intent) should
   * prefer this over re-running detectAbbasRelationSlot when present.
   */
  person_relation_slot?: PersonRelationSlot | null
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

  // Remove common Arabic question scaffolding while preserving content-bearing tokens.
  const scaffoldStripped = norm
    .replace(/\b(?:ما|ماذا|من|هو|هي|هل|هناك|هنالك|عن|في|على|الى|إلى|او|أو|ثم|هذا|هذه|ذلك|تلك|مع|اذا|إذا|لكن|ولاكن|لي|لك|باسم|اسم|بعنوان)\b/gu, " ")
    .replace(/\b(?:اعطني|اعرض|ابحث|اشرح|حدثني|اخبرني|عرفني|كيف|كم|عدد)\b/gu, " ")
    .replace(/\s+/g, " ")
    .trim()

  return scaffoldStripped
    .split(/\s+/)
    .filter(token => token.length >= 2)
}

function isInstitutionalRelationQuery(norm: string): boolean {
  if (!norm) return false

  const hasRelationCue = /(?:تابع|يتبع|تتبع|ينتمي|تنتمي|ضمن|من\s+مؤسسات|تابعه\s+ل|تابع\s+ل|يتبع\s+ل)/u.test(norm)
  const hasInstitutionCue = /(?:العتب[هة]|العباسي[هة]|مؤسس[هة]|جامع[هة]|جامعه|جامعة|مؤسسة|مركز|كلية|كليه)/u.test(norm)
  const hasExistentialCue = /(?:^|\s)(?:هل|يوجد|هناك|هنالك)(?:\s|$)/u.test(norm)
  const hasInstitutionOwnerCue = /(?:العتب[هة](?:\s+العباسي[هة])?|العباسي[هة])/u.test(norm)
  const hasOwnershipExistentialCue = /(?:^|\s)هل\s+(?:لدى|لل|توجد\s+ل|يوجد\s+ل)/u.test(norm)
  const hasOrgObjectCue = /(?:جامع[هة]|جامعة|جامعه|كلية|كليه|مؤسسة|مركز|معهد|مدرسة|مشروع|مشاريع|برامج|نشاطات|خدمات)/u.test(norm)

  return (
    (hasRelationCue && hasInstitutionCue) ||
    (hasExistentialCue && hasInstitutionCue && hasOrgObjectCue) ||
    (hasOwnershipExistentialCue && hasInstitutionOwnerCue && hasOrgObjectCue)
  )
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

function hasExplicitQuestionCue(norm: string): boolean {
  return /(?:^|\s)(?:ما|ماذا|من|هل|كم|كيف|متى|أين|لماذا|اشر?ح|عرفني|حدثني|اعطني|اعرض|اخبرني)(?:\s|$)/u.test(norm)
}

function detectQueryClarity(
  raw: string,
  norm: string,
  contentIntent: QueryContentIntent,
  operationIntent: QueryOperationIntent
): QueryClarity {
  const rawTokens = raw.split(/\s+/).filter(Boolean)
  const contentTokens = getGenericContentTokens(raw)
  const isBareEntityQuery =
    operationIntent === "fact_question" &&
    contentIntent === "generic" &&
    !hasExplicitQuestionCue(norm) &&
    rawTokens.length <= 4

  if (contentTokens.length === 0) return "underspecified"
  if (rawTokens.length <= 2 && contentTokens.length <= 2) return "underspecified"
  if (contentTokens.length <= 1 && operationIntent === "fact_question") return "underspecified"
  if (isBareEntityQuery) return "underspecified"

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

function isHistoricalShrineLifecycleQuery(norm: string): boolean {
  const hasShrineContext = /(?:العتب[هة]|الحرم|المرقد|الضريح|الصحن)/u.test(norm)
  const hasHistoricalFrame = /(?:تاريخ|تاري?خ|مراحل|قرن|حقبه|حقبة|قديم)/u.test(norm)
  const hasStructuralSignal = /(?:بناء|هدم|اعمار|إعمار|ترميم|تشييد|عدوان|اعتداء)/u.test(norm)
  const explicitProjectLookup = /(?:^|\s)(?:مشروع|مشاريع)(?:\s|$)/u.test(norm)

  return hasShrineContext && (hasHistoricalFrame || hasStructuralSignal) && hasStructuralSignal && !explicitProjectLookup
}

function detectContentIntent(norm: string): QueryContentIntent {
  if (/(?:وحي)/u.test(norm)) return "wahy"
  if (/(?:فيديو|فديو|محاضر|مرئي|مقطع|يوتيوب)/u.test(norm)) return "video"
  if (/(?:خطب|خطب[هة]?|جمع[هة]|خطيب|منبر)/u.test(norm)) return "sermon"
  if (/(?:من هو|من هي|سير[هة]|مولد|استشهاد|وفاة|وفاه|لقب|القاب|كنية|كنيه|زوج|ابناء|أبناء|اولاد)/u.test(norm)) return "biography"
  if (/(?:تاريخ|تاري?خ|مراحل|قرن|حقبه|حقبة|مرقد|ضريح|صحن|رواق|هدم|اعمار|إعمار|ترميم|تشييد|بناء)/u.test(norm)) return "history"
  if (/(?:خبر|اخبار|مقال|بيان|اعلان|أعلن|نشر|المتولي|الامين العام|أمين عام|مهرجان|فعالي[هة]|برنامج|مبادرة|حملة)/u.test(norm)) return "news"

  return "generic"
}

function detectOperationIntent(norm: string): QueryOperationIntent {
  const hasCount = /(?:^|\s)(?:كم|عدد|اجمالي|إجمالي|مجموع|احصاء|إحصاء)(?:\s|$)/u.test(norm)
  const hasLatest = /(?:احدث|أحدث|اخر|آخر|الجديد)/u.test(norm)
  const hasList = /(?:اعرض|عرض|هات|قائمة|لائحه|لائحة|list)/u.test(norm)
  const hasSummarize = /(?:لخص|تلخيص|خلاصه|خلاصة|ملخص|اختصر)/u.test(norm)
  const hasExplain = /(?:اشرح|شرح|فسر|تفسير|وضح|توضيح|كيف|صف|وصف|تكلم|حدثني|عرفني)/u.test(norm)
  const hasClassify = /(?:فعاليه\s+ام|فعالية\s+ام|برنامج\s+ام|خبر\s+ام|صنف|تصنيف)/u.test(norm)
  const hasDirect = /(?:الجواب\s+المباشر|جواب\s+مباشر|في\s+سطرين|دون\s+عناوين|دون\s+روابط)/u.test(norm)
  const hasBrowse = /(?:تصفح|صفح[هة]|الصفح[هة]|اقدم|اول|oldest|first)/u.test(norm)
  const hasFollowUpSummary = /(?:اول\s+نتيجة|أول\s+نتيجة|النتيجة\s+التي\s+ذكرتها|الخبر\s+الذي\s+ذكرته|التي\s+ذكرتها|الذي\s+ذكرته)/u.test(norm)

  if (hasCount) return "count"
  if (hasFollowUpSummary && hasSummarize) return "summarize"
  if (hasLatest) {
    if (hasList) return "latest"
    return "list_items"
  }
  if (hasList) return "list_items"
  if (hasSummarize) return "summarize"
  if (hasExplain) return "explain"
  if (hasClassify) return "classify"
  if (hasDirect) return "direct_answer"
  if (hasBrowse) return "browse"

  return "fact_question"
}

function extractEntities(rawQuery: string, norm: string): QueryExtractedEntities {
  const person: string[] = []
  const topic: string[] = []
  const place: string[] = []
  const sourceSpecific: string[] = []

  const institutionalAbbasContext = /(?:العتبة\s+العباسية|العتبه\s+العباسيه|العباسية|العباسيه)/u.test(norm)
  if (/(?:ابي|أبي|ابو|أبو)\s+الفضل/u.test(norm)) person.push("أبي الفضل")
  if (/(?:^|\s)العباس(?:\s|$)/u.test(norm) && !institutionalAbbasContext) person.push("العباس")

  const sheikhNameMatch = rawQuery.match(/(?:^|\s)الشيخ\s+([\u0621-\u064A]{2,}(?:\s+[\u0621-\u064A]{2,}){1,2})/u)
  if (sheikhNameMatch?.[1]) {
    person.push(`الشيخ ${sheikhNameMatch[1].trim()}`)
  }

  const contentTokens = getGenericContentTokens(rawQuery)
  if (contentTokens.length >= 2) topic.push(contentTokens.slice(0, 3).join(" "))
  if (contentTokens.length >= 3) topic.push(contentTokens.slice(0, 2).join(" "))

  const placeMatches = norm.match(/(?:العتب[هة]|كربلاء|المرقد|الحرم|الصحن|الضريح)/gu) || []
  place.push(...placeMatches)

  const asksBiographyAttribute = /(?:زوج|زوجات|ابناء|أبناء|اولاد|القاب|كنية|كنيه|عمر)/u.test(norm)
  if (person.length > 0 && asksBiographyAttribute) {
    sourceSpecific.push("abbas_history_by_id")
    sourceSpecific.push("shrine_history_sections")
  }

  const asksHistoricalContext = /(?:تاريخ|تاري?خ|مراحل|قرن|حقبه|حقبة|هدم|بناء|ترميم|اعمار|إعمار|تشييد)/u.test(norm)
  if (asksHistoricalContext && place.length > 0) {
    sourceSpecific.push("shrine_history_timeline")
    sourceSpecific.push("shrine_history_sections")
  }

  const asksFridaySermon = /(?:خطب[هة]?\s+الجمع[هة]|خطب[هة]\s+جمع[هة]|من\s+وحي\s+الجمع[هة]|خطب\s+جمع[هة])/u.test(norm)
  if (asksFridaySermon) {
    sourceSpecific.push("friday_sermons")
  }
  const asksWahyFriday = /(?:من\s+وحي\s+الجمع[هة]|وحي\s+الجمع[هة])/u.test(norm)
  if (asksWahyFriday) {
    sourceSpecific.push("wahy_friday")
  }

  const existentialLookup = /(?:^|\s)(?:هل|يوجد|هناك|هنالك)(?:\s|$)/u.test(norm)
  const isCountQuestion = /(?:^|\s)(?:كم|عدد|اجمالي|إجمالي|مجموع)(?:\s|$)/u.test(norm)
  const institutionalRelation = isInstitutionalRelationQuery(norm)
  if (
    existentialLookup &&
    !isCountQuestion &&
    contentTokens.length > 0 &&
    !isHistoricalShrineLifecycleQuery(norm) &&
    !institutionalRelation
  ) {
    sourceSpecific.push("projects_query")
  }

  return {
    person: uniq(person),
    topic: uniq(topic),
    place: uniq(place),
    source_specific: uniq(sourceSpecific)
  }
}

function deriveHintedSources(contentIntent: QueryContentIntent, entities: QueryExtractedEntities): string[] {
  const sources: string[] = []

  switch (contentIntent) {
    case "video":
      sources.push("videos_latest")
      break
    case "news":
      sources.push("articles_latest")
      break
    case "biography":
      sources.push("abbas_history_by_id", "shrine_history_sections")
      break
    case "history":
      sources.push("shrine_history_timeline", "shrine_history_sections")
      break
    case "sermon":
      sources.push("friday_sermons")
      break
    case "wahy":
      sources.push("wahy_friday")
      break
    default:
      break
  }

  for (const entitySource of entities.source_specific) {
    if (entitySource !== "projects_query") {
      sources.push(entitySource)
    }
  }

  sources.push("auto")
  return uniq(sources)
}

function computeConfidence(
  contentIntent: QueryContentIntent,
  operationIntent: QueryOperationIntent,
  entities: QueryExtractedEntities
): number {
  let score = 0.45

  if (contentIntent !== "generic") score += 0.2
  if (operationIntent !== "fact_question") score += 0.15
  if (entities.person.length > 0) score += 0.08
  if (entities.topic.length > 0) score += 0.06
  if (entities.place.length > 0) score += 0.04
  if (entities.source_specific.length > 0) score += 0.07

  return Math.max(0.1, Math.min(0.99, Number(score.toFixed(2))))
}

export function understandQuery(query: string): QueryUnderstandingResult {
  const raw = String(query || "").trim()
  const norm = normalizeQueryForTrace(raw)

  const contentIntent = detectContentIntent(norm)
  const operationIntent = detectOperationIntent(norm)
  const clarity = detectQueryClarity(raw, norm, contentIntent, operationIntent)
  const entities = extractEntities(raw, norm)
  const hintedSources = deriveHintedSources(contentIntent, entities)
  const baseConfidence = computeConfidence(contentIntent, operationIntent, entities)
  const routeConfidence = clarity === "underspecified"
    ? Math.max(0.1, Number((baseConfidence - 0.12).toFixed(2)))
    : baseConfidence

  return {
    raw_query: raw,
    normalized_query: norm,
    content_intent: contentIntent,
    operation_intent: operationIntent,
    clarity,
    extracted_entities: entities,
    hinted_sources: hintedSources,
    route_confidence: routeConfidence
  }
}

export function deriveRetrievalCapabilitySignals(
  understanding: QueryUnderstandingResult,
  rawQuery?: string
): RetrievalCapabilitySignals {
  const norm = rawQuery
    ? normalizeQueryForTrace(rawQuery)
    : understanding.normalized_query

  const officeHolderFact = /(?:المتولي|الامين\s+العام|أمين\s+عام|مسؤول|رئيس\s+القسم)/u.test(norm)
  const namedEventOrProgram = /(?:مهرجان|فعالي[هة]|برنامج|مبادرة|حملة|اسبوع|أسبوع)/u.test(norm)
  const personAttributeFact =
    understanding.extracted_entities.person.length > 0 &&
    /(?:زوج|زوجات|ابناء|أبناء|اولاد|أولاد|القاب|كنية|كنيه|عمر|تاريخ)/u.test(norm)
  const historicalShrineLifecycleQuery = isHistoricalShrineLifecycleQuery(norm)
  const institutionalRelation = isInstitutionalRelationQuery(norm)
  const titleOrPhraseLookup = isTitleOrPhraseLookup(understanding.raw_query, norm, understanding.operation_intent)
  const underspecifiedQuery = understanding.clarity === "underspecified"
  const keywordDrivenSingularProjectLookup =
    /(?:^|\s)(?:مشروع|انتاج|إنتاج|زراعي|تعليمي|ترميم|صيانة|تشييد|بناء)(?:\s|$)/u.test(norm) &&
    !/(?:^|\s)مشاريع(?:\s|$)/u.test(norm)
  const structuralSingularLookup = isStructuralSingularLookup(understanding, norm)
  const singularProjectLookup =
    (keywordDrivenSingularProjectLookup || structuralSingularLookup) &&
    !historicalShrineLifecycleQuery
  const broadCapabilityOverview =
    understanding.operation_intent === "explain" ||
    /(?:كيف|خطوة|صف|وصف|الخدمات|للزائر|الزيارة\s+بالنيابة|الزيارات\s+المليونية)/u.test(norm)

  let entityFirstReason = "general"
  if (broadCapabilityOverview) entityFirstReason = "general"
  else if (officeHolderFact) entityFirstReason = "office_holder_fact"
  else if (namedEventOrProgram) entityFirstReason = "named_event_or_program"
  else if (personAttributeFact) entityFirstReason = "person_attribute_fact"
  else if (!institutionalRelation && (singularProjectLookup || understanding.extracted_entities.source_specific.includes("projects_query"))) {
    entityFirstReason = "singular_project_lookup"
  } else if (
    (understanding.operation_intent === "fact_question" || understanding.operation_intent === "direct_answer") &&
    understanding.extracted_entities.topic.length > 0
  ) {
    entityFirstReason = "entity_fact_query"
  }

  const entityFirstMode = entityFirstReason !== "general" && !institutionalRelation && !underspecifiedQuery

  return {
    office_holder_fact: officeHolderFact,
    named_event_or_program: namedEventOrProgram,
    person_attribute_fact: personAttributeFact,
    singular_project_lookup: singularProjectLookup,
    institutional_relation: institutionalRelation,
    title_or_phrase_lookup: titleOrPhraseLookup,
    underspecified_query: underspecifiedQuery,
    entity_first_mode: entityFirstMode,
    entity_first_reason: entityFirstReason
  }
}

export function getQueryClassKey(understanding: QueryUnderstandingResult): string {
  return `${understanding.operation_intent}:${understanding.content_intent}`
}

/**
 * Async version of understandQuery that automatically calls the LLM fallback
 * when the regex pass returns low confidence (route_confidence < 0.55 or
 * generic intent on a multi-token query).
 *
 * Falls back silently to the regex result if:
 *  - ENABLE_LLM_INTENT_FALLBACK env is not "true"
 *  - LLM call fails for any reason
 *  - openaiApiKey is not provided
 *
 * @param query       Raw user query string
 * @param openaiApiKey  OpenAI API key (pass process.env.OPENAI_API_KEY)
 * @param model         OpenAI model name (defaults to gpt-4o-mini)
 */
export async function understandQueryWithFallback(
  query: string,
  openaiApiKey?: string,
  model?: string,
): Promise<QueryUnderstandingResult> {
  const regexResult = understandQuery(query)

  // Dynamic import keeps this file synchronous when LLM is disabled
  const { shouldUseLLMFallback, resolveIntentWithLLM, mergeWithLLMPatch } =
    await import("../ai/llm-intent-resolver")

  if (!shouldUseLLMFallback(regexResult) || !openaiApiKey) {
    return regexResult
  }

  try {
    const patch = await resolveIntentWithLLM(
      query,
      openaiApiKey,
      model ?? (process.env.OPENAI_MODEL || "gpt-4o-mini"),
    )
    if (!patch) return regexResult
    return mergeWithLLMPatch(regexResult, patch)
  } catch {
    // Degrade gracefully — never block the main pipeline
    return regexResult
  }
}
