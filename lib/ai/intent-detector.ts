/**
 * Intent Detector
 *
 * Single source of truth for Arabic query intent classification.
 * Determines whether a query is biographical, knowledge-layer-eligible,
 * hard-evidence-sensitive, or requires special handling.
 */

import type { Evidence } from "../server/evidence-extractor"
import type { QueryUnderstandingResult } from "../server/query-understanding"

// ── Normalization ───────────────────────────────────────────────────

export function normalizeArabicLight(text: string): string {
  return (text || "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[\u0622\u0623\u0625\u0627]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\s+/g, " ")
    .trim()
}

// ── Token extraction ────────────────────────────────────────────────

const GENERIC_TOKENS = new Set([
  "ما", "هو", "هي", "هل", "من", "عن", "في", "على", "الى", "او",
  "هن", "له", "لها", "لهم", "لي", "حول", "باختصار", "مختصر",
  "تكلم", "اشرح", "حدثني", "اخبرني", "عرفني", "ابحث", "خبر",
  "قديم", "يتحدث", "اعطني", "اعرض", "عليه", "السلام",
  "العتبه", "العتبة", "العباسيه", "العباسية", "مشروع", "مشاريع",
  // Operation / question words (asking *how many / which / when / where*).
  // These describe the operation requested, not the entity attribute, so
  // they must not be treated as content tokens when checking knowledge gaps.
  "عدد", "كم", "ماذا", "متى", "متي", "اين", "أين", "كيف", "لماذا", "لما",
  "ايش", "أيش", "ايّ", "اي", "أي", "أيهم", "ايهم",
])

export function extractSpecificQueryTokens(text: string): string[] {
  return normalizeArabicLight(text)
    .split(/\s+/)
    .filter(t => t.length >= 2 && !GENERIC_TOKENS.has(t))
}

// ── Office-holder queries ───────────────────────────────────────────

export function isOfficeHolderQuery(text: string): boolean {
  const norm = normalizeArabicLight(text)
  return (
    norm.includes(normalizeArabicLight("المتولي الشرعي")) ||
    (norm.includes(normalizeArabicLight("المتولي")) &&
      norm.includes(normalizeArabicLight("الشرعي")))
  )
}

// ── Abbas biography detection ───────────────────────────────────────

const SHRINE_ACTIVITY = [
  "توسعه", "توسعة", "بناء", "ترميم", "انشاء", "إنشاء", "قبه", "قبة",
  "رواق", "صحن", "بلاطه", "بلاطة", "مشروع", "مشاريع", "طابق",
  "تشييد", "اعمار", "اعمال", "عمل", "خدمه", "خدمة",
  "فعاليه", "فعاليات", "نشاط", "انشطه", "برنامج", "مناسبه",
  "زياره", "زيارة", "زائرين", "خبر", "اخبار",
]

const BIOGRAPHY_SIGNALS = [
  "لقب", "القاب", "كنيه", "كنية", "صفه", "صفات", "صفة",
  "من هو", "من هي", "ما هو", "ما هي", "سيره", "سيرة", "حياه", "حياة",
  "نشاه", "نشأة", "ولاده", "ولادة", "مولد",
  "ام ", "امه", "أمه", "ابيه", "ابوه", "والد", "والده", "والدته", "اخوه", "اخواته", "اخوات", "اخت",
  "زوجه", "زوجته", "زوجة", "زوجات", "زواج", "ولد", "ابناء", "اولاد",
  "اعمام", "عمه", "عمته",
  "استشهاد", "شهاده", "شهادة", "مقتل", "متي استشهد",
  "موقفه", "قمر بني هاشم", "سقايه", "سقاية", "عمر سنه",
  "تعريف", "نبذه", "نبذة",
]

/**
 * Returns true only for personal biography queries about Abbas (as),
 * NOT shrine construction/activity queries.
 */
export function isAbbasBiographyQuery(text: string): boolean {
  const norm = normalizeArabicLight(text)
  if (SHRINE_ACTIVITY.some(p => norm.includes(p))) return false
  return BIOGRAPHY_SIGNALS.some(p => norm.includes(p))
}

// ── Knowledge layer routing ─────────────────────────────────────────

export function isKnowledgePriorityQuery(
  text: string,
  understanding?: QueryUnderstandingResult
): boolean {
  const norm = normalizeArabicLight(text)
  if (isAbbasBiographyQuery(text)) return true
  if (isOfficeHolderQuery(text)) return true
  if (["سدنة", "سدانة", "كلدار", "الحرم"].some(p => norm.includes(p))) return true
  if (understanding?.content_intent === "history") return true
  if (
    understanding?.extracted_entities.person?.length ||
    understanding?.extracted_entities.topic?.some(t =>
      ["سدنة", "اخوات"].some(p => normalizeArabicLight(t).includes(p))
    )
  ) return true
  return false
}

const SKIP_KNOWLEDGE = [
  "عدد", "كم", "اجمالي", "كلي", "مجموع",
  "ميتاداتا", "وصفي", "معلومات وصفيه",
  "اقسام الفيديو", "تصنيفات", "فئات",
  "احدث خبر", "اخر خبر", "اخر فيديو",
  "اول خبر", "اقدم خبر", "اول فيديو",
  "اعرض احدث", "اعرض أحدث", "احدث الفيديوهات", "احدث اخبار",
  "احدث من وحي الجمعه", "احدث خطب الجمعه", "احدث خطبه الجمعه",
]

const DEEP_KNOWLEDGE = [
  "من هو", "من هي", "ما هو", "ما هي", "ماهو", "ماهي",
  "تاريخ", "سيره", "حياه", "نبذه", "استشهاد",
  "عتبه", "عباس", "ابو الفضل", "ابي الفضل", "ابا الفضل",
  "ضريح", "مرقد", "حرم", "صحن",
  "سدنه", "كلدار", "وصف",
  "زياره", "ابحث", "بحث", "معلومات عن", "تحدث عن", "حدثني",
  "اخبرني عن", "عرفني", "يذكر", "ماذا يذكر",
  "خطبه", "خطب", "جمعه", "وحي الجمعه", "اصدار", "اصدارات",
  "القاب", "صفات", "اخوه", "اخوات", "زواج", "كنيه", "نشاه",
  "ام البنين", "قمر بني هاشم", "سقايه",
]

export function shouldUseKnowledgeLayer(
  text: string,
  understanding?: QueryUnderstandingResult
): boolean {
  const norm = normalizeArabicLight(text)
  if (isAbbasBiographyQuery(text)) return true
  if (understanding) {
    const op = understanding.operation_intent
    if (op === "count" || op === "latest" || op === "list_items" || op === "browse") return false
  }
  if (SKIP_KNOWLEDGE.some(p => norm.includes(p))) return false
  if (DEEP_KNOWLEDGE.some(p => norm.includes(p))) return true
  return norm.length > 20
}

// ── Hard-evidence sensitivity ───────────────────────────────────────

const HARD_EVIDENCE_PATTERNS = [
  "متي", "تاريخ استشهاد", "تاريخ ولاده", "تاريخ وفاه",
  "سنه استشهاد", "سنه ولاده", "سنه وفاه",
  "عمر", "كم عمر", "كم كان عمر",
  "في اي سنه", "في اي عام",
  "هجري", "ميلادي",
  "عدد ابناء", "عدد اولاد", "عدد زوجات",
  "متي ولد", "متي استشهد", "متي توفي",
]

export function isHardEvidenceSensitive(text: string): boolean {
  const norm = normalizeArabicLight(text)
  return HARD_EVIDENCE_PATTERNS.some(p => norm.includes(p))
}

export function hasStrongAnswerEvidence(toolContent: string, query: string): boolean {
  if (!toolContent || toolContent.length < 30) return false
  const norm = normalizeArabicLight(query)

  if (["متي", "تاريخ", "سنه", "عام"].some(k => norm.includes(k))) {
    if (/\d{3,4}/.test(toolContent) || /[\u0660-\u0669]{3,4}/.test(toolContent)) return true
    if (["الطف", "كربلاء", "عاشوراء", "محرم", "شعبان"].some(e => toolContent.includes(e))) return true
    if (["وعشرين", "وثلاثين", "واربعين", "وخمسين", "وستين", "سنه"].some(w => toolContent.includes(w))) return true
    return false
  }

  if (["عمر", "عدد", "كم"].some(k => norm.includes(k))) {
    if (/\d+/.test(toolContent) || /[\u0660-\u0669]+/.test(toolContent)) return true
    return ["وعشرين", "وثلاثين", "واربعين", "وخمسين", "وستين",
      "عشر", "احد", "اثن", "ثلاث", "اربع", "خمس", "ست", "سبع", "ثمان", "تسع",
    ].some(w => toolContent.includes(w))
  }

  return toolContent.length > 100
}

// ── Evidence quality checks ─────────────────────────────────────────

export function evidenceContainsLikelyPersonName(evidence: Evidence[]): boolean {
  const pool = evidence.slice(0, 5).map(e => `${e.source_title} ${e.quote}`).join(" ")
  return /(السيد|الشيخ|سماحة|العلامة)\s+[\u0621-\u064A]{2,}(?:\s+[\u0621-\u064A]{2,}){1,3}/u.test(pool)
}

export function evidenceCoversSpecificTokens(query: string, evidence: Evidence[]): boolean {
  const tokens = extractSpecificQueryTokens(query)
  if (tokens.length === 0) return true
  const pool = normalizeArabicLight(
    evidence.slice(0, 4).map(e => `${e.source_title} ${e.quote} ${e.source_section}`).join(" ")
  )
  const matched = tokens.filter(t => pool.includes(t)).length
  return matched >= Math.min(2, tokens.length)
}

// ── Compound query splitting ────────────────────────────────────────

export function splitCompoundFactQuery(text: string): string[] {
  const raw = String(text || "")
    .replace(/[؟?]+/g, " | ")
    .replace(/،/g, " ، ")
    .replace(/\s+/g, " ")
    .trim()

  if (!raw) return []

  const questionLead = "(?:من|ما|متى|اين|أين|هل|كم|كيف|لماذا)"
  const segmented = raw
    .replace(new RegExp(`\\s+و(?=${questionLead}\\s)`, "gu"), " | ")
    .replace(new RegExp(`\\s+ثم\\s+(?=${questionLead}\\s)`, "gu"), " | ")
    .replace(new RegExp(`،\\s*(?=${questionLead}\\s)`, "gu"), " | ")
    .replace(/\s+و(?=(?:اسم|زوج[ةت]|ابن|بن[ت]|ام|أم|والد[ةت]?|اولاد|أولاد|ألقاب|لقب)\S*)/gu, " | ")

  return [...new Set(
    segmented.split("|").map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean)
  )].slice(0, 3)
}

export function isCompoundFactQuery(text: string): boolean {
  return splitCompoundFactQuery(text).length > 1
}

export function extractCompoundQueryAnchor(
  query: string,
  understanding?: QueryUnderstandingResult
): string {
  const candidates = [
    understanding?.extracted_entities.person?.[0],
    understanding?.extracted_entities.topic?.find(t => t.split(/\s+/).length >= 2),
    understanding?.extracted_entities.place?.[0],
  ].filter(Boolean) as string[]

  if (candidates.length > 0) return candidates[0]

  const norm = normalizeArabicLight(query)
  if (norm.includes(normalizeArabicLight("ابي الفضل")) || norm.includes(normalizeArabicLight("أبي الفضل")))
    return "أبي الفضل العباس"

  const hasStandaloneAbbas = norm.split(/\s+/).includes(normalizeArabicLight("العباس"))
  const institutionalContext =
    norm.includes(normalizeArabicLight("العتبة العباسية")) ||
    norm.includes(normalizeArabicLight("العتبه العباسيه")) ||
    norm.split(/\s+/).includes(normalizeArabicLight("العباسية")) ||
    norm.split(/\s+/).includes(normalizeArabicLight("العباسيه"))

  if (hasStandaloneAbbas && !institutionalContext) return "العباس"
  if (norm.includes(normalizeArabicLight("العتبة العباسية")) || norm.includes(normalizeArabicLight("العتبه العباسيه")))
    return "العتبة العباسية"

  return ""
}

export function buildCompoundCoverageInstruction(text: string): string | null {
  const parts = splitCompoundFactQuery(text)
  if (parts.length < 2) return null
  return `تعليمات تغطية الإجابة: السؤال الحالي مركب ويتضمن ${parts.length} مطالب. أجب عن كل مطلب بترتيبه الوارد صراحةً، ولا تكتفِ بالإجابة عن أول جزء فقط. إذا كانت معلومة أحد الأجزاء غير متاحة فاذكر ذلك لهذا الجزء وحده.`
}

export function enrichCompoundQueryPart(part: string, anchor: string): string {
  if (!anchor) return part
  if (normalizeArabicLight(part).includes(normalizeArabicLight(anchor))) return part
  return `${part} ${anchor}`.trim()
}
