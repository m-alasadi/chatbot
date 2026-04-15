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

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function detectContentIntent(norm: string): QueryContentIntent {
  const videoHints = ["فيديو", "فديو", "محاضره", "محاضرات", "مرئي", "مقطع", "يوتيوب"]
  const newsHints = ["خبر", "اخبار", "مقال", "مقالات", "بيان"]
  const biographyHints = [
    "من هو", "من هي", "سيره", "سيرة", "لقب", "القاب", "كنيه", "كنية", "استشهاد", "مولد", "ابو الفضل", "العباس بن علي",
    "زوج", "زوجة", "زوجات", "ابناء", "اولاد", "عمر", "تاريخ وفاه", "تاريخ وفاة", "تاريخ استشهاد", "متي استشهد"
  ]
  const officeHolderHints = ["المتولي", "المتولي الشرعي", "الامين العام", "أمين عام", "رئيس القسم", "مسؤول"]
  const namedProgramHints = ["نداء العقيدة", "مبادرة", "برنامج", "حملة", "مهرجان", "ملتقى"]
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
  const explainHints = ["اشرح", "شرح", "فسر", "تفسير", "وضح", "توضيح"]
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

  const personPatterns = ["العباس", "ابي الفضل", "أبي الفضل", "ابو الفضل", "أبو الفضل", "الشيخ زمان الحسناوي", "زمان الحسناوي"]
  for (const p of personPatterns) {
    const np = normalizeQueryForTrace(p)
    if (norm.includes(np)) person.push(p)
  }

  const topicPatterns = [
    "توسعه", "توسعة", "مشاريع", "المشاريع", "مشروع", "محاضرات", "فيديوهات", "اخبار", "خطب", "وحي الجمعة",
    "نداء العقيدة", "المتولي الشرعي", "زوجات", "ابناء", "القاب", "تعليمي", "زراعي", "انتاجي"
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
  if (norm.includes(normalizeQueryForTrace("تاريخ")) || norm.includes(normalizeQueryForTrace("العتبة"))) sourceSpecific.push("shrine_history_sections")
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
    norm.includes(normalizeQueryForTrace("مشاريع")) ||
    norm.includes(normalizeQueryForTrace("مشروع")) ||
    norm.includes(normalizeQueryForTrace("توسعة")) ||
    norm.includes(normalizeQueryForTrace("تعليمي")) ||
    norm.includes(normalizeQueryForTrace("زراعي")) ||
    norm.includes(normalizeQueryForTrace("انتاج")) ||
    norm.includes(normalizeQueryForTrace("دجاج"))
  ) {
    sourceSpecific.push("projects_query")
    sourceSpecific.push("articles_latest")
    sourceSpecific.push("videos_latest")
  }

  if (rawQuery.match(/[\u0621-\u064A]{3,}\s+[\u0621-\u064A]{3,}/)) {
    // Heuristic for Arabic named entities / multi-word phrases.
    topic.push(rawQuery.trim().split(/\s+/).slice(0, 3).join(" "))
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
      sources.push("shrine_history_sections")
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
