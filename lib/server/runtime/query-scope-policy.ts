import { type QueryUnderstandingResult } from "../query-understanding"

function normalizeArabicLight(text: string): string {
  return (text || "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[\u0622\u0623\u0625\u0627]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\s+/g, " ")
    .trim()
}

function includesAny(norm: string, values: string[]): boolean {
  return values.some(value => norm.includes(normalizeArabicLight(value)))
}

export function isSmallTalkQuery(text: string): boolean {
  const norm = normalizeArabicLight(text)
  if (!norm) return true

  return includesAny(norm, [
    "مرحبا",
    "اهلا",
    "السلام عليكم",
    "شكرا",
    "شكرا لك",
    "تسلم",
    "من انت",
    "من أنت",
    "ماذا تستطيع",
    "شنو تقدر تسوي",
    "ما الذي يمكنك فعله",
    "كيف استخدمك",
    "كيف استخدم هذا البوت",
    "ساعدني",
  ])
}

function hasInstitutionSignal(norm: string): boolean {
  return includesAny(norm, [
    "العتبة العباسية",
    "العتبه العباسيه",
    "العتبة",
    "العتبه",
    "العباسية",
    "العباسيه",
    "الكفيل",
    "alkafeel",
    "موقع الكفيل",
    "الموقع",
    "في الموقع",
    "ضمن الموقع",
    "لديكم",
    "عندكم",
    "لدى العتبة",
    "تابع للعتبة",
  ])
}

function hasDomainEntitySignals(understanding?: QueryUnderstandingResult): boolean {
  if (!understanding) return false

  if (understanding.extracted_entities.source_specific.length > 0) return true
  if (understanding.extracted_entities.person.length > 0) return true

  const placeSignals = understanding.extracted_entities.place.map(normalizeArabicLight)
  if (placeSignals.some(place => includesAny(place, ["العتبة", "العتبه", "كربلاء", "الحرم", "المرقد", "الصحن"]))) {
    return true
  }

  const topicSignals = understanding.extracted_entities.topic.map(normalizeArabicLight)
  return topicSignals.some(topic => includesAny(topic, [
    "العتبة",
    "العتبه",
    "الكفيل",
    "العباس",
    "ابي الفضل",
    "أبي الفضل",
    "خطب الجمعة",
    "وحي الجمعة",
    "المتولي الشرعي",
  ]))
}

export function isOutOfScopeQuery(
  text: string,
  understanding?: QueryUnderstandingResult
): boolean {
  const norm = normalizeArabicLight(text)
  if (!norm || isSmallTalkQuery(text)) return false
  if (hasInstitutionSignal(norm) || hasDomainEntitySignals(understanding)) return false

  const operation = understanding?.operation_intent || "fact_question"
  return operation === "fact_question"
    || operation === "direct_answer"
    || operation === "explain"
    || operation === "classify"
    || operation === "summarize"
}