import { type AllowedToolName } from "../site-tools-definitions"
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

export interface ForcedUtilityIntent {
  tool: AllowedToolName
  args: Record<string, any>
}

function includesAnyLatestSingle(norm: string): boolean {
  const leadWords = ["اعطني", "أعطني", "هات", "ما هو", "ما هي", "شنو"]
  const singularLatestPhrases = ["احدث خبر", "أحدث خبر", "اخر خبر", "آخر خبر"]

  return singularLatestPhrases.some(phrase => norm.includes(normalizeArabicLight(phrase))) &&
    leadWords.some(word => norm.includes(normalizeArabicLight(word)))
}

export function detectForcedUtilityIntent(
  userText: string,
  understanding: QueryUnderstandingResult | undefined,
  isBiographyQuery: (text: string) => boolean
): ForcedUtilityIntent | null {
  const norm = normalizeArabicLight(userText)

  const newsHints = ["اخبار", "خبر", "مقال", "مقالات"]
  const videoHints = ["فيديو", "فديو", "فيديوهات", "مقاطع", "مرئي"]
  const wahyFridayHints = ["وحي الجمعه", "من وحي", "وحي"]
  const sermonHints = ["خطبه", "خطب", "جمعه", "خطيب", "منبر", "صلاه الجمعه", "صلاه جمعه"]
  const isNews = newsHints.some(h => norm.includes(h))
  const isVideo = videoHints.some(h => norm.includes(h))
  const isWahyFriday = wahyFridayHints.some(h => norm.includes(h))
  const isSermon = sermonHints.some(h => norm.includes(h))

  const understoodNews = understanding?.content_intent === "news"
  const understoodVideo = understanding?.content_intent === "video"
  const understoodWahy = understanding?.content_intent === "wahy"
  const understoodSermon = understanding?.content_intent === "sermon"
  const isCountIntent = understanding?.operation_intent === "count"
  const isLatestIntent = understanding?.operation_intent === "latest"
  const isListIntent = understanding?.operation_intent === "list_items"
  const isBrowseIntent = understanding?.operation_intent === "browse"
  const isExplicitTopNewsRequest =
    (isNews || understoodNews) &&
    !(isVideo || understoodVideo) &&
    (
      norm.includes(normalizeArabicLight("ابرز")) ||
      norm.includes(normalizeArabicLight("اليوم"))
    )

  // 1. Source-specific count → get_source_metadata
  // But NOT for biographical queries like "عدد ألقاب العباس" — those go to knowledge layer.
  const countKeywords = ["عدد", "كم", "اجمالي", "كلي", "مجموع"]
  if ((isCountIntent || countKeywords.some(k => norm.includes(k))) && !isBiographyQuery(userText)) {
    if (isWahyFriday || understoodWahy) return { tool: "get_source_metadata", args: { source: "wahy_friday" } }
    if (isSermon || understoodSermon) return { tool: "get_source_metadata", args: { source: "friday_sermons" } }
    if ((isNews || understoodNews) && !(isVideo || understoodVideo)) return { tool: "get_source_metadata", args: { source: "articles_latest" } }
    if ((isVideo || understoodVideo) && !(isNews || understoodNews)) return { tool: "get_source_metadata", args: { source: "videos_latest" } }
  }

  // 2. Metadata / descriptive info → get_source_metadata
  const metaKeywords = ["معلومات وصفيه", "وصفي", "ميتاداتا"]
  if (metaKeywords.some(k => norm.includes(k))) {
    if (isNews || (!isVideo && norm.includes("مصدر"))) return { tool: "get_source_metadata", args: { source: "articles_latest" } }
    if (isVideo) return { tool: "get_source_metadata", args: { source: "videos_latest" } }
  }

  // 3. Oldest / first → browse_source_page with order=oldest
  const oldestKeywords = ["اول", "اقدم", "oldest", "first"]
  if (isBrowseIntent || oldestKeywords.some(k => norm.includes(k))) {
    if (isWahyFriday || understoodWahy) return { tool: "browse_source_page", args: { source: "wahy_friday", page: 1, order: "oldest" } }
    if (isSermon || understoodSermon) return { tool: "browse_source_page", args: { source: "friday_sermons", page: 1, order: "oldest" } }
    if ((isVideo || understoodVideo) && !(isNews || understoodNews)) return { tool: "browse_source_page", args: { source: "videos_latest", page: 1, order: "oldest" } }
    if (isNews || understoodNews || norm.includes("نشر") || norm.includes("موقع")) {
      return { tool: "browse_source_page", args: { source: "articles_latest", page: 1, order: "oldest" } }
    }
  }

  // 4. Explicit latest listing requests (utility listing, not semantic retrieval)
  const latestKeywords = ["احدث", "اخر", "آخر", "الجديد", "احدث ", "اخر "]
  const explicitListingWords = ["اعرض", "عرض", "هات", "قائمة", "لائحة", "list"]
  const isExplicitLatestListing =
    (isLatestIntent || latestKeywords.some(k => norm.includes(normalizeArabicLight(k)))) &&
    (isListIntent || explicitListingWords.some(k => norm.includes(normalizeArabicLight(k))))
  const isExplicitSingleLatestNewsRequest =
    (isNews || understoodNews || norm.includes(normalizeArabicLight("العتبة العباسية"))) &&
    includesAnyLatestSingle(norm)

  if (isExplicitSingleLatestNewsRequest) {
    return { tool: "get_latest_by_source", args: { source: "articles_latest", limit: 1 } }
  }

  if (isExplicitLatestListing) {
    if (isWahyFriday || understoodWahy) return { tool: "get_latest_by_source", args: { source: "wahy_friday", limit: 5 } }
    if (isSermon || understoodSermon) return { tool: "get_latest_by_source", args: { source: "friday_sermons", limit: 5 } }
    if ((isVideo || understoodVideo) && !(isNews || understoodNews)) return { tool: "get_latest_by_source", args: { source: "videos_latest", limit: 5 } }
    if ((isNews || understoodNews) && !(isVideo || understoodVideo)) return { tool: "get_latest_by_source", args: { source: "articles_latest", limit: 5 } }
  }

  // 5. Explicit top-news requests (e.g. "ما أبرز أخبار العتبة اليوم")
  // must stay on news source and return list-shaped news output.
  if (isExplicitTopNewsRequest) {
    return {
      tool: "get_latest_by_source",
      args: { source: "articles_latest", limit: 5 }
    }
  }

  // Compatibility-only forced routing:
  // keep deterministic non-search flows here; retrieval routing is owned by orchestrator.
  return null
}
