import { normalizeQueryForTrace } from "./observability/chat-trace"

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
  extracted_entities: QueryExtractedEntities
  hinted_sources: string[]
  route_confidence: number
}

export interface RetrievalCapabilitySignals {
  office_holder_fact: boolean
  named_event_or_program: boolean
  person_attribute_fact: boolean
  singular_project_lookup: boolean
  entity_first_mode: boolean
  entity_first_reason: string
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function containsNormalizedPhrase(norm: string, phrase: string): boolean {
  return norm.includes(normalizeQueryForTrace(phrase))
}

function containsStandaloneNormalizedToken(norm: string, token: string): boolean {
  const normalizedToken = normalizeQueryForTrace(token)
  return norm.split(/\s+/).includes(normalizedToken)
}

function isHistoricalShrineLifecycleQuery(norm: string): boolean {
  const shrineSignals = [
    "العتبه", "العتبة", "العباسيه", "العباسية", "الحرم", "المرقد", "الضريح",
    "قبر العباس", "ابي الفضل", "أبي الفضل", "ابو الفضل", "أبو الفضل"
  ]
  const historicalFrameSignals = ["مراحل", "تاريخ", "تأريخ", "هدم", "عدوان", "اعتداء", "بناء"]
  const structuralSignals = ["بناء", "هدم", "اعمار", "إعمار", "ترميم", "تشييد", "عدوان", "اعتداء"]
  const explicitProjectSignals = ["مشاريع", "مشروع", "توسعه", "توسعة"]

  const hasShrineContext = shrineSignals.some(signal => norm.includes(normalizeQueryForTrace(signal)))
  const hasHistoricalFrame = historicalFrameSignals.some(signal => norm.includes(normalizeQueryForTrace(signal)))
  const hasStructuralSignal = structuralSignals.some(signal => norm.includes(normalizeQueryForTrace(signal)))
  const explicitProjectLookup = explicitProjectSignals.some(signal => norm.includes(normalizeQueryForTrace(signal)))

  return hasShrineContext && hasHistoricalFrame && hasStructuralSignal && !explicitProjectLookup
}

function detectContentIntent(norm: string): QueryContentIntent {
  const videoHints = ["فيديو", "فديو", "محاضره", "محاضرات", "مرئي", "مقطع", "يوتيوب"]
  const newsHints = ["خبر", "اخبار", "مقال", "مقالات", "بيان"]
  const biographyHints = [
    "من هو", "من هي", "سيره", "سيرة", "لقب", "القاب", "كنيه", "كنية", "استشهاد", "مولد", "ابو الفضل", "العباس بن علي",
    "زوج", "زوجة", "زوجات", "ابناء", "اولاد", "عمر", "تاريخ وفاه", "تاريخ وفاة", "تاريخ استشهاد", "متي استشهد"
  ]
  const officeHolderHints = ["المتولي", "المتولي الشرعي", "الامين العام", "أمين عام", "رئيس القسم", "مسؤول"]
  const namedProgramHints = ["نداء العقيدة", "أسبوع الإمامة", "اسبوع الامامة", "مبادرة", "برنامج", "حملة", "مهرجان", "ملتقى"]
  const historyHints = ["تاريخ", "العتبه", "العتبة", "مرقد", "ضريح", "صحن", "رواق"]
  const wahyHints = ["وحي الجمعه", "وحي الجمعة", "من وحي"]
  const sermonHints = ["خطبه", "خطبة", "خطب", "جمعه", "جمعة", "خطيب", "منبر"]

  if (wahyHints.some(h => norm.includes(normalizeQueryForTrace(h)))) return "wahy"
  if (videoHints.some(h => norm.includes(normalizeQueryForTrace(h)))) return "video"
  if (sermonHints.some(h => norm.includes(normalizeQueryForTrace(h)))) return "sermon"
  // Office-holder facts are usually published as news/media updates, not shrine-history pages.
  if (officeHolderHints.some(h => norm.includes(normalizeQueryForTrace(h)))) return "news"
  if (namedProgramHints.some(h => norm.includes(normalizeQueryForTrace(h)))) return "news"
  if (newsHints.some(h => norm.includes(normalizeQueryForTrace(h)))) return "news"
  if (biographyHints.some(h => norm.includes(normalizeQueryForTrace(h)))) return "biography"
  if (historyHints.some(h => norm.includes(normalizeQueryForTrace(h)))) return "history"

  return "generic"
}

function detectOperationIntent(norm: string): QueryOperationIntent {
  const countHints = ["كم", "عدد", "اجمالي", "إجمالي", "مجموع", "احصاء", "إحصاء"]
  const latestHints = ["احدث", "أحدث", "اخر", "آخر", "الجديد"]
  const listHints = ["اعرض", "عرض", "هات", "قائمة", "لائحة", "list"]
  const summarizeHints = ["لخص", "تلخيص", "خلاصه", "خلاصة", "ملخص", "اختصر"]
  const explainHints = ["اشرح", "شرح", "فسر", "تفسير", "وضح", "توضيح", "كيف", "صف", "وصف", "تكلم", "حدثني", "عرفني"]
  const classifyHints = ["فعاليه ام", "فعالية ام", "برنامج ام", "خبر ام", "صنف", "تصنيف", "هل هو"]
  const directShapeHints = ["الجواب المباشر", "جواب مباشر", "فقط", "في سطرين", "ما اسمه", "اين يقع", "دون عناوين", "دون روابط"]
  const browseHints = ["تصفح", "صفحه", "صفحة", "الصفحه", "الصفحة", "اقدم", "اول", "oldest", "first"]
  const followUpSummaryHints = ["اول نتيجة", "أول نتيجة", "النتيجة التي ذكرتها", "الخبر الذي ذكرته", "التي ذكرتها", "الذي ذكرته"]

  if (countHints.some(h => norm.includes(normalizeQueryForTrace(h)))) return "count"
  if (followUpSummaryHints.some(h => norm.includes(normalizeQueryForTrace(h))) &&
      summarizeHints.some(h => norm.includes(normalizeQueryForTrace(h)))) return "summarize"
  if (latestHints.some(h => norm.includes(normalizeQueryForTrace(h)))) {
    if (listHints.some(h => norm.includes(normalizeQueryForTrace(h)))) return "latest"
    return "list_items"
  }
  if (listHints.some(h => norm.includes(normalizeQueryForTrace(h)))) return "list_items"
  if (summarizeHints.some(h => norm.includes(normalizeQueryForTrace(h)))) return "summarize"
  if (explainHints.some(h => norm.includes(normalizeQueryForTrace(h)))) return "explain"
  if (classifyHints.some(h => norm.includes(normalizeQueryForTrace(h)))) return "classify"
  if (directShapeHints.some(h => norm.includes(normalizeQueryForTrace(h)))) return "direct_answer"
  if (browseHints.some(h => norm.includes(normalizeQueryForTrace(h)))) return "browse"

  return "fact_question"
}

function extractEntities(rawQuery: string, norm: string): QueryExtractedEntities {
  const person: string[] = []
  const topic: string[] = []
  const place: string[] = []
  const sourceSpecific: string[] = []

  const institutionalAbbasContext =
    containsNormalizedPhrase(norm, "العتبة العباسية") ||
    containsNormalizedPhrase(norm, "العتبه العباسيه") ||
    containsStandaloneNormalizedToken(norm, "العباسية") ||
    containsStandaloneNormalizedToken(norm, "العباسيه")

  const personPatterns = [
    { value: "الشيخ زمان الحسناوي", standalone: false },
    { value: "زمان الحسناوي", standalone: false },
    { value: "ابي الفضل", standalone: false },
    { value: "أبي الفضل", standalone: false },
    { value: "ابو الفضل", standalone: false },
    { value: "أبو الفضل", standalone: false },
    { value: "العباس", standalone: true },
  ]

  for (const pattern of personPatterns) {
    const matched = pattern.standalone
      ? containsStandaloneNormalizedToken(norm, pattern.value)
      : containsNormalizedPhrase(norm, pattern.value)
    if (!matched) continue
    if (pattern.value === "العباس" && institutionalAbbasContext) continue
    person.push(pattern.value)
  }

  const topicPatterns = [
    "توسعه", "توسعة", "إعمار", "اعمار", "ترميم", "صيانة", "تشييد", "بناء",
    "مشاريع", "المشاريع", "مشروع", "محاضرات", "فيديوهات", "اخبار", "خطب", "وحي الجمعة",
    "نداء العقيدة", "أسبوع الإمامة", "اسبوع الامامة", "المتولي الشرعي", "سدنة الحرم", "سدنة", "السدانة",
    "زوجات", "ابناء", "القاب", "اخوات", "تعليمي", "زراعي", "انتاجي", "مساعدات",
    "الزيارة بالنيابة", "خدمة الزيارة بالنيابة", "الخدمات الإلكترونية", "الخدمات الالكترونية", "الزيارات المليونية"
  ]
  for (const t of topicPatterns) {
    const nt = normalizeQueryForTrace(t)
    if (norm.includes(nt)) topic.push(t)
  }

  const placePatterns = ["العتبه", "العتبة", "كربلاء", "المرقد", "الحرم", "الصحن"]
  for (const p of placePatterns) {
    const np = normalizeQueryForTrace(p)
    if (norm.includes(np)) place.push(p)
  }

  if (norm.includes(normalizeQueryForTrace("وحي"))) sourceSpecific.push("wahy_friday")
  if (norm.includes(normalizeQueryForTrace("خطب")) || norm.includes(normalizeQueryForTrace("جمعه"))) sourceSpecific.push("friday_sermons")
  if (norm.includes(normalizeQueryForTrace("فيديو")) || norm.includes(normalizeQueryForTrace("محاضرات"))) sourceSpecific.push("videos_latest")
  if (norm.includes(normalizeQueryForTrace("اخبار")) || norm.includes(normalizeQueryForTrace("خبر"))) sourceSpecific.push("articles_latest")
  if (
    norm.includes(normalizeQueryForTrace("أسبوع الإمامة")) ||
    norm.includes(normalizeQueryForTrace("اسبوع الامامة"))
  ) {
    sourceSpecific.push("articles_latest")
    sourceSpecific.push("videos_latest")
  }
  if (
    norm.includes(normalizeQueryForTrace("تاريخ")) ||
    norm.includes(normalizeQueryForTrace("العتبة")) ||
    norm.includes(normalizeQueryForTrace("سدنة")) ||
    norm.includes(normalizeQueryForTrace("كلدار")) ||
    norm.includes(normalizeQueryForTrace("الحرم"))
  ) {
    sourceSpecific.push("shrine_history_timeline")
    sourceSpecific.push("shrine_history_sections")
  }
  if (norm.includes(normalizeQueryForTrace("المتولي")) || norm.includes(normalizeQueryForTrace("الشرعي"))) {
    sourceSpecific.push("articles_latest")
    sourceSpecific.push("friday_sermons")
    sourceSpecific.push("wahy_friday")
  }
  if (norm.includes(normalizeQueryForTrace("نداء العقيدة")) || norm.includes(normalizeQueryForTrace("مهرجان")) || norm.includes(normalizeQueryForTrace("فعالية")) || norm.includes(normalizeQueryForTrace("برنامج"))) {
    sourceSpecific.push("articles_latest")
    sourceSpecific.push("videos_latest")
    sourceSpecific.push("wahy_friday")
    sourceSpecific.push("friday_sermons")
  }
  if (norm.includes(normalizeQueryForTrace("زوج")) || norm.includes(normalizeQueryForTrace("زوجات")) || norm.includes(normalizeQueryForTrace("ابناء")) || norm.includes(normalizeQueryForTrace("القاب"))) {
    sourceSpecific.push("shrine_history_sections")
    sourceSpecific.push("abbas_history_by_id")
  }

  if (
    (
      norm.includes(normalizeQueryForTrace("مشاريع")) ||
      norm.includes(normalizeQueryForTrace("مشروع")) ||
      norm.includes(normalizeQueryForTrace("توسعة")) ||
      norm.includes(normalizeQueryForTrace("اعمار")) ||
      norm.includes(normalizeQueryForTrace("إعمار")) ||
      norm.includes(normalizeQueryForTrace("ترميم")) ||
      norm.includes(normalizeQueryForTrace("صيانة")) ||
      norm.includes(normalizeQueryForTrace("تعليمي")) ||
      norm.includes(normalizeQueryForTrace("زراعي")) ||
      norm.includes(normalizeQueryForTrace("انتاج")) ||
      norm.includes(normalizeQueryForTrace("دجاج"))
    ) &&
    !isHistoricalShrineLifecycleQuery(norm)
  ) {
    sourceSpecific.push("projects_query")
    sourceSpecific.push("articles_latest")
    sourceSpecific.push("videos_latest")
  }

  if (
    norm.includes(normalizeQueryForTrace("الزيارة بالنيابة")) ||
    norm.includes(normalizeQueryForTrace("خدمة الزيارة بالنيابة")) ||
    norm.includes(normalizeQueryForTrace("الخدمات الإلكترونية")) ||
    norm.includes(normalizeQueryForTrace("الخدمات الالكترونية")) ||
    norm.includes(normalizeQueryForTrace("الزيارات المليونية"))
  ) {
    sourceSpecific.push("articles_latest")
    sourceSpecific.push("videos_latest")
  }

  if (rawQuery.match(/[\u0621-\u064A]{3,}\s+[\u0621-\u064A]{3,}/)) {
    const genericTopicTokens = new Set([
      "تكلم", "اشرح", "حدثني", "اخبرني", "عرفني", "ابحث", "اعطني", "اعرض", "كيف", "صف", "وصف",
      "لي", "عن", "حول", "باختصار", "خبر", "قديم", "يتحدث", "ما", "من", "هل"
    ].map(token => normalizeQueryForTrace(token)))
    const candidateTopicTokens = rawQuery
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .filter(token => !genericTopicTokens.has(normalizeQueryForTrace(token)))

    if (candidateTopicTokens.length >= 2) {
      // Heuristic for Arabic named entities / multi-word phrases after stripping prompt fillers.
      topic.push(candidateTopicTokens.slice(0, 3).join(" "))
    }
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
  const entities = extractEntities(raw, norm)
  const hintedSources = deriveHintedSources(contentIntent, entities)
  const routeConfidence = computeConfidence(contentIntent, operationIntent, entities)

  return {
    raw_query: raw,
    normalized_query: norm,
    content_intent: contentIntent,
    operation_intent: operationIntent,
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

  const officeHolderSignals = ["المتولي", "الشرعي", "الامين العام", "أمين عام"]
  const namedEventSignals = ["نداء العقيدة", "أسبوع الإمامة", "اسبوع الامامة", "مهرجان", "فعالية", "فعاليات", "برنامج", "مبادرة", "حملة"]
  const personAttributeSignals = ["زوج", "زوجات", "ابناء", "أبناء", "اولاد", "أولاد", "القاب", "كنيه", "كنية", "عمر", "تاريخ"]
  const singularProjectSignals = [
    "مشروع", "دجاج", "انتاج", "إنتاج", "زراعي", "تعليمي", "تربوي",
    "اعمار", "إعمار", "ترميم", "صيانة", "تشييد", "بناء"
  ]

  const officeHolderFact = officeHolderSignals.some(s => norm.includes(normalizeQueryForTrace(s)))
  const namedEventOrProgram = namedEventSignals.some(s => norm.includes(normalizeQueryForTrace(s)))
  const personAttributeFact =
    understanding.extracted_entities.person.length > 0 &&
    personAttributeSignals.some(s => norm.includes(normalizeQueryForTrace(s)))
  const historicalShrineLifecycleQuery = isHistoricalShrineLifecycleQuery(norm)
  const singularProjectLookup =
    singularProjectSignals.some(s => norm.includes(normalizeQueryForTrace(s))) &&
    !norm.includes(normalizeQueryForTrace("مشاريع")) &&
    !historicalShrineLifecycleQuery
  const broadCapabilityOverview =
    understanding.operation_intent === "explain" ||
    norm.includes(normalizeQueryForTrace("كيف")) ||
    norm.includes(normalizeQueryForTrace("خطوة")) ||
    norm.includes(normalizeQueryForTrace("صف")) ||
    norm.includes(normalizeQueryForTrace("وصف")) ||
    norm.includes(normalizeQueryForTrace("الخدمات")) ||
    norm.includes(normalizeQueryForTrace("للزائر")) ||
    norm.includes(normalizeQueryForTrace("الزيارة بالنيابة")) ||
    norm.includes(normalizeQueryForTrace("الزيارات المليونية"))

  let entityFirstReason = "general"
  if (broadCapabilityOverview) entityFirstReason = "general"
  else if (officeHolderFact) entityFirstReason = "office_holder_fact"
  else if (namedEventOrProgram) entityFirstReason = "named_event_or_program"
  else if (personAttributeFact) entityFirstReason = "person_attribute_fact"
  else if (singularProjectLookup || understanding.extracted_entities.source_specific.includes("projects_query")) {
    entityFirstReason = "singular_project_lookup"
  } else if (
    (understanding.operation_intent === "fact_question" || understanding.operation_intent === "direct_answer") &&
    understanding.extracted_entities.topic.length > 0
  ) {
    entityFirstReason = "entity_fact_query"
  }

  const entityFirstMode = entityFirstReason !== "general"

  return {
    office_holder_fact: officeHolderFact,
    named_event_or_program: namedEventOrProgram,
    person_attribute_fact: personAttributeFact,
    singular_project_lookup: singularProjectLookup,
    entity_first_mode: entityFirstMode,
    entity_first_reason: entityFirstReason
  }
}

export function getQueryClassKey(understanding: QueryUnderstandingResult): string {
  return `${understanding.operation_intent}:${understanding.content_intent}`
}
