/**
 * Query Understanding Module
 *
 * Classifies Arabic user queries to determine the correct retrieval intent:
 *   - fact    : asking for a specific fact (count, date, existence)
 *   - list    : asking for a list / browsing items
 *   - search  : open-ended search for content
 *   - general : everything else
 *
 * Used by function-calling-handler to route queries accurately and prevent
 * fact queries from being answered as list queries (and vice-versa).
 */

/** Light Arabic normalisation — strips diacritics, unifies alef, maps tā' marbūta → hā' */
export function normalizeArabicQuery(text: string): string {
  return (text || "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[\u0622\u0623\u0625\u0627]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

export type QueryIntentType = "fact" | "list" | "search" | "general"

// ── Intent detectors ────────────────────────────────────────────────

/**
 * Returns true when the query is asking for a *specific fact*:
 * counts, dates, year, existence checks ("هل يوجد").
 */
export function isFactQuery(text: string): boolean {
  const norm = normalizeArabicQuery(text)

  // Count / quantity
  const countPatterns = [
    "كم", "عدد", "اجمالي", "مجموع", "كلي",
    "كم عدد", "كم يبلغ", "كم يوجد",
  ]
  if (countPatterns.some(p => norm.includes(p))) return true

  // Date / time
  const datePatterns = [
    "متي", "تاريخ", "في اي سنه", "في اي عام",
    "في اي تاريخ", "منذ متي", "منذ كم",
  ]
  if (datePatterns.some(p => norm.includes(p))) return true

  // Existence questions ("هل يوجد …", "هل هناك …")
  const existencePatterns = [
    "هل يوجد", "هل هناك", "هل تتوفر", "هل يتوفر",
    "هل توجد", "هل تجد",
  ]
  if (existencePatterns.some(p => norm.includes(p))) return true

  return false
}

/**
 * Returns true when the query is requesting a *list* or *browsing* items
 * rather than a specific piece of information.
 */
export function isListQuery(text: string): boolean {
  const norm = normalizeArabicQuery(text)

  // English "oldest"/"first" are kept intentionally for mixed-language queries
  // (users occasionally type English keywords). This mirrors the original
  // oldestKeywords list in function-calling-handler.ts section 3.
  const listPatterns = [
    "اعرض", "اظهر", "قدم", "عرض", "اذكر", "اريد قائمه", "اريد قائمة",
    "احدث", "اخر", "جديد", "اخير",
    "قائمه", "قائمة", "لائحه", "لائحة",
    "اول", "اقدم", "oldest", "first",
    "كل الـ", "جميع الـ",
  ]
  return listPatterns.some(p => norm.includes(p))
}

/**
 * Classify a query into one of four intent types.
 *
 * Priority:  fact > list > search > general
 */
export function classifyQueryIntent(text: string): QueryIntentType {
  if (isFactQuery(text)) return "fact"
  if (isListQuery(text)) return "list"

  const norm = normalizeArabicQuery(text)
  const searchPatterns = [
    "ابحث", "بحث", "عن", "ما هو", "ما هي", "من هو", "من هي", "ماذا",
    "اخبرني", "حدثني", "عرفني", "يذكر", "اريد معرفه",
  ]
  if (searchPatterns.some(p => norm.includes(p))) return "search"

  return "general"
}

// ── Source-type helpers ─────────────────────────────────────────────

/** Canonical source identifiers that the count-routing in the handler supports */
export type CountableSource =
  | "wahy_friday"
  | "friday_sermons"
  | "articles_latest"
  | "videos_latest"
  | "shrine_history_sections"
  | "lang_words_ar"

/**
 * Detect which countable source a fact/count query is about.
 * Returns null when none can be determined (falls to generic search).
 */
export function detectCountSource(text: string): CountableSource | null {
  const norm = normalizeArabicQuery(text)

  if (["وحي الجمعه", "من وحي", "وحي"].some(h => norm.includes(h))) return "wahy_friday"
  if (["خطبه", "خطب", "جمعه", "خطيب", "منبر"].some(h => norm.includes(h))) return "friday_sermons"
  if (["فيديو", "فديو", "فيديوهات", "مقاطع", "مرئي"].some(h => norm.includes(h))) return "videos_latest"
  if (["اخبار", "خبر", "مقال", "مقالات"].some(h => norm.includes(h))) return "articles_latest"
  if (["تاريخ العتبه", "اقسام التاريخ", "اقسام تاريخ"].some(h => norm.includes(h))) return "shrine_history_sections"
  if (["قاموس", "كلمات", "لغه", "مصطلحات"].some(h => norm.includes(h))) return "lang_words_ar"

  return null
}
