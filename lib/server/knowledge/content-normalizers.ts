/**
 * Content Normalizers — extract richest text from each API source
 * into NormalizedContent for the knowledge layer.
 */

import type {
  NormalizedContent,
  ContentSourceId,
  ContentSourceFamily,
} from "./content-types"

// ── HTML stripping ──────────────────────────────────────────────────
function stripHtml(html: string): string {
  if (!html) return ""
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim()
}

function pickText(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim()
  }
  return ""
}

function toISODate(value: unknown): string {
  if (!value) return new Date().toISOString()
  const num = Number(value)
  if (Number.isFinite(num) && num > 1_000_000) {
    // Unix timestamp (seconds or ms)
    const ts = num > 1e12 ? num : num * 1000
    return new Date(ts).toISOString()
  }
  if (typeof value === "string" && value.includes("T")) return value
  return new Date().toISOString()
}

function summarize(text: string, maxLen = 300): string {
  const clean = stripHtml(text)
  if (clean.length <= maxLen) return clean
  return clean.substring(0, maxLen).replace(/\s+\S*$/, "") + "…"
}

const SITE_DOMAIN = () =>
  (process.env.SITE_DOMAIN || "https://alkafeel.net").replace(/\/+$/, "")

// ── Per-source normalizer functions ─────────────────────────────────

function normalizeArticle(raw: any): NormalizedContent {
  const id = String(raw.id || "")
  const title = pickText(raw.title, raw.name, "بدون عنوان")
  const bodyText = pickText(raw.text, raw.description, raw.content, raw.summary)
  const fullText = stripHtml(bodyText)

  const domain = SITE_DOMAIN()
  const tpl = process.env.SITE_ARTICLE_URL_TEMPLATE || "/news/index?id={id}"
  const url =
    pickText(raw.url, raw.link, raw.permalink, raw.news_url) ||
    `${domain}${tpl.replace("{id}", encodeURIComponent(id))}`

  return {
    id: `articles_latest::${id}`,
    source: "articles_latest",
    family: "news",
    title,
    section: pickText(raw.cat_title, "أخبار"),
    url,
    published_at: toISODate(raw.time || raw.created_at),
    summary: summarize(bodyText),
    full_text: fullText,
    metadata: {
      image: raw.image || undefined,
      category: raw.cat_title || undefined,
      address: raw.address || undefined,
      original_id: raw.id,
    },
  }
}

function normalizeVideo(
  raw: any,
  source: "videos_latest" | "videos_by_category" | "friday_sermons" | "wahy_friday"
): NormalizedContent {
  const id = String(raw.id || raw.video_id || "")
  const title = pickText(raw.title, raw.name, "فيديو بدون عنوان")
  const bodyText = pickText(raw.caption, raw.description, raw.text, raw.summary, title)
  const fullText = stripHtml(bodyText)

  const slug = raw.request || raw.news_id || raw.article_id
  const domain = SITE_DOMAIN()
  const url = slug
    ? `${domain}/media/${encodeURIComponent(String(slug))}?lang=ar`
    : domain

  const family = (source === "friday_sermons" || source === "wahy_friday") ? "sermon" as const : "video" as const
  const defaultSection = source === "friday_sermons" ? "خطب الجمعة"
    : source === "wahy_friday" ? "من وحي الجمعة"
    : "فيديوهات"

  return {
    id: `${source}::${id}`,
    source,
    family,
    title,
    section: pickText(raw.cat_title, raw.category, defaultSection),
    url,
    published_at: toISODate(raw.time || raw.created_at),
    summary: summarize(bodyText),
    full_text: fullText,
    metadata: {
      image: raw.image || raw.thumb || undefined,
      category: raw.cat_title || raw.category || undefined,
      original_id: raw.id,
    },
  }
}

function normalizeVideoCategory(raw: any): NormalizedContent {
  const id = String(raw.id || raw.cat_id || raw.slug || raw.request || "")
  const title = pickText(raw.title, raw.cat_title, raw.name, "قسم فيديو")
  const bodyText = pickText(raw.description, "قسم من أقسام المكتبة المرئية")

  return {
    id: `videos_categories::${id}`,
    source: "videos_categories",
    family: "category",
    title,
    section: "أقسام الفيديو",
    url: SITE_DOMAIN(),
    published_at: new Date().toISOString(),
    summary: bodyText,
    full_text: stripHtml(bodyText),
    metadata: { original_id: raw.id || raw.cat_id || raw.request },
  }
}

function normalizeHistorySection(raw: any): NormalizedContent {
  const id = String(raw.id || raw.sec_id || raw.title || "")
  const title = pickText(raw.title, raw.sec_title, raw.name, "قسم تاريخ")
  const bodyText = pickText(raw.text, raw.description, raw.content)
  const fullText = stripHtml(bodyText)

  return {
    id: `shrine_history_sections::${id}`,
    source: "shrine_history_sections",
    family: "history",
    title,
    section: "أقسام تاريخ العتبة",
    url: `${SITE_DOMAIN()}/history?lang=ar`,
    published_at: new Date().toISOString(),
    summary: summarize(bodyText),
    full_text: fullText,
    metadata: { original_id: raw.id || raw.sec_id },
  }
}

function normalizeHistoryTimeline(raw: any): NormalizedContent {
  const id = String(raw.id || raw.history_id || raw.title || "")
  const title = pickText(raw.title, raw.sec_title, raw.name, "مرحلة تاريخية")
  const bodyText = pickText(raw.text, raw.description, raw.content)
  const fullText = stripHtml(bodyText)

  return {
    id: `shrine_history_timeline::${id}`,
    source: "shrine_history_timeline",
    family: "history",
    title,
    section: "المراحل التاريخية للعتبة العباسية",
    url: `${SITE_DOMAIN()}/history?lang=ar`,
    published_at: toISODate(raw.time || raw.created_at),
    summary: summarize(bodyText),
    full_text: fullText,
    metadata: { original_id: raw.id || raw.history_id },
  }
}

function normalizeHistoryContent(
  raw: any,
  source: "shrine_history_by_section" | "abbas_history_by_id"
): NormalizedContent {
  const id = String(raw.id || raw.history_id || "")
  const title = pickText(raw.title, raw.name, "محتوى تاريخي")
  const bodyText = pickText(raw.text, raw.description, raw.content)
  const fullText = stripHtml(bodyText)
  const family: ContentSourceFamily = source === "abbas_history_by_id" ? "abbas" : "history"
  const path = source === "abbas_history_by_id" ? "/abbas?lang=ar" : "/history?lang=ar"

  return {
    id: `${source}::${id}`,
    source,
    family,
    title,
    section: family === "abbas" ? "تاريخ العباس" : "تاريخ العتبة",
    url: `${SITE_DOMAIN()}${path}`,
    published_at: toISODate(raw.time || raw.created_at),
    summary: summarize(bodyText),
    full_text: fullText,
    metadata: { original_id: raw.id },
  }
}

function normalizeLangWord(key: string, value: string): NormalizedContent {
  return {
    id: `lang_words_ar::${key}`,
    source: "lang_words_ar",
    family: "language",
    title: key,
    section: "قاموس اللغة",
    url: SITE_DOMAIN(),
    published_at: new Date().toISOString(),
    summary: String(value),
    full_text: String(value),
    metadata: {},
  }
}

// ── Public: normalize a raw API response for a given source ─────────

export function normalizeRawToContent(
  source: ContentSourceId,
  rawData: unknown
): NormalizedContent[] {
  const arr = Array.isArray(rawData)
    ? rawData
    : Array.isArray((rawData as any)?.data)
      ? (rawData as any).data
      : null

  switch (source) {
    case "articles_latest":
      return (arr ?? []).map(normalizeArticle)

    case "videos_latest":
    case "videos_by_category":
    case "friday_sermons":
    case "wahy_friday":
      return (arr ?? []).map((r: any) => normalizeVideo(r, source as any))

    case "videos_categories":
      return (arr ?? []).map(normalizeVideoCategory)

    case "shrine_history_timeline":
      return (arr ?? []).map(normalizeHistoryTimeline)

    case "shrine_history_sections":
      return (arr ?? []).map(normalizeHistorySection)

    case "shrine_history_by_section":
    case "abbas_history_by_id":
      return (arr ?? []).map((r: any) => normalizeHistoryContent(r, source))

    case "lang_words_ar": {
      if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) return []
      return Object.entries(rawData as Record<string, string>).map(
        ([k, v]) => normalizeLangWord(k, v)
      )
    }
    case "abbas_local_dataset":
      // Abbas local dataset is pre-normalized by abbas-local-loader.ts
      return []
    default:
      return []
  }
}
