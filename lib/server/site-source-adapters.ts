import { fillEndpointTemplate, getSiteAPIConfig } from "./site-api-config"
import { callSiteAPI, type APICallResult } from "./site-api-transport"

export type SiteSourceName =
  | "articles_latest"
  | "videos_latest"
  | "videos_categories"
  | "videos_by_category"
  | "shrine_history_timeline"
  | "shrine_history_sections"
  | "shrine_history_by_section"
  | "abbas_history_by_id"
  | "lang_words_ar"
  | "friday_sermons"
  | "wahy_friday"

export interface SourceFetchParams {
  source?: SiteSourceName | "auto"
  category_id?: string
  section_id?: string
  id?: string
}

export const ALL_SOURCES: SiteSourceName[] = [
  "articles_latest",
  "videos_latest",
  "videos_categories",
  "videos_by_category",
  "shrine_history_timeline",
  "shrine_history_sections",
  "shrine_history_by_section",
  "abbas_history_by_id",
  "lang_words_ar",
  "friday_sermons",
  "wahy_friday"
]

const SOURCE_CACHE_DURATION_MS: Record<SiteSourceName, number> = {
  articles_latest: 15 * 60 * 1000,
  videos_latest: 15 * 60 * 1000,
  videos_categories: 6 * 60 * 60 * 1000,
  videos_by_category: 20 * 60 * 1000,
  shrine_history_timeline: 12 * 60 * 60 * 1000,
  shrine_history_sections: 12 * 60 * 60 * 1000,
  shrine_history_by_section: 60 * 60 * 1000,
  abbas_history_by_id: 60 * 60 * 1000,
  lang_words_ar: 24 * 60 * 60 * 1000,
  friday_sermons: 30 * 60 * 1000,
  wahy_friday: 30 * 60 * 1000
}

const SOURCE_REQUEST_POLICY: Record<SiteSourceName, { timeout: number; retries: number }> = {
  articles_latest: { timeout: 12000, retries: 0 },
  videos_latest: { timeout: 14000, retries: 0 },
  videos_categories: { timeout: 8000, retries: 0 },
  videos_by_category: { timeout: 12000, retries: 0 },
  shrine_history_timeline: { timeout: 14000, retries: 1 },
  shrine_history_sections: { timeout: 10000, retries: 0 },
  shrine_history_by_section: { timeout: 14000, retries: 1 },
  abbas_history_by_id: { timeout: 14000, retries: 1 },
  lang_words_ar: { timeout: 7000, retries: 0 },
  friday_sermons: { timeout: 13000, retries: 0 },
  wahy_friday: { timeout: 13000, retries: 0 }
}

function getSourceRequestPolicy(source: SiteSourceName): { timeout: number; retries: number } {
  return SOURCE_REQUEST_POLICY[source]
}

export const CATEGORY_INDEX_SOURCES: SiteSourceName[] = ["videos_categories", "shrine_history_sections"]
export const EXPANDABLE_SOURCES: SiteSourceName[] = ["articles_latest", "videos_latest", "friday_sermons", "wahy_friday"]

function normalizeSection(value: string): { id: string; name: string } {
  const text = (value || "غير مصنف").trim() || "غير مصنف"
  return { id: text, name: text }
}

function toUnixDate(value: any): string {
  const num = Number(value)
  if (Number.isFinite(num) && num > 0) {
    return new Date(num * 1000).toISOString()
  }
  return new Date().toISOString()
}

function pickText(...values: any[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v
  }
  return ""
}

function buildSourceEndpoint(
  source: SiteSourceName,
  params: SourceFetchParams
): string {
  const config = getSiteAPIConfig()
  const endpoint = config.sourceEndpoints[source]
  if (!endpoint) {
    throw new Error(`Endpoint غير معرف للمصدر: ${source}`)
  }

  switch (source) {
    case "videos_by_category": {
      if (!params.category_id) throw new Error(`Source ${source} requires category_id`)
      return fillEndpointTemplate(endpoint, { catId: params.category_id })
    }
    case "shrine_history_by_section": {
      if (!params.section_id) throw new Error(`Source ${source} requires section_id`)
      return fillEndpointTemplate(endpoint, { secId: params.section_id })
    }
    case "abbas_history_by_id": {
      if (!params.id) throw new Error(`Source ${source} requires id`)
      return fillEndpointTemplate(endpoint, { id: params.id })
    }
    default:
      return endpoint
  }
}

/** Check whether a parametric source can be fetched with the given params */
export function canFetchSource(source: SiteSourceName, params: SourceFetchParams): boolean {
  switch (source) {
    case "videos_by_category":        return !!params.category_id
    case "shrine_history_by_section": return !!params.section_id
    case "abbas_history_by_id":       return !!params.id
    default: return true
  }
}

/**
 * توحيد شكل البيانات القادمة من APIs مختلفة إلى مصفوفة مشاريع موحدة
 */
export function normalizeProjectsDataset(rawData: any): any[] {
  if (Array.isArray(rawData)) {
    return rawData
  }

  const siteDomain = (process.env.SITE_DOMAIN || "https://alkafeel.net").replace(/\/+$/, "")
  const articleUrlTemplate = process.env.SITE_ARTICLE_URL_TEMPLATE || "/news/index?id={id}&lang=ar"

  function resolveArticleUrl(item: any): string {
    const explicitUrl =
      item?.url ||
      item?.link ||
      item?.permalink ||
      item?.news_url ||
      item?.article_url

    if (typeof explicitUrl === "string" && explicitUrl.trim().length > 0) {
      return explicitUrl
    }

    // حقل request يحتوي المعرّف الصحيح (hash/slug) لصفحة الخبر — يُستخدم كأولوية على الـ id الرقمي
    const requestSlug = item?.request
    if (typeof requestSlug === "string" && requestSlug.trim().length > 0) {
      return `${siteDomain}/news/${encodeURIComponent(requestSlug.trim())}?lang=ar`
    }

    const id = String(item?.id || "").trim()
    if (!id) return siteDomain

    const articlePath = articleUrlTemplate.replace("{id}", encodeURIComponent(id))

    // Fallback pattern for news pages when API item has no direct URL.
    if (articlePath.startsWith("http://") || articlePath.startsWith("https://")) {
      return articlePath
    }

    const normalizedPath = articlePath.startsWith("/") ? articlePath : `/${articlePath}`
    return `${siteDomain}${normalizedPath}`
  }

  if (rawData && Array.isArray(rawData.data)) {
    return rawData.data.map((item: any) => {
      const sectionName = item.cat_title || "غير مصنف"
      const unixTime = Number(item.time)
      const createdAt = Number.isFinite(unixTime) && unixTime > 0
        ? new Date(unixTime * 1000).toISOString()
        : new Date().toISOString()
      const articleUrl = resolveArticleUrl(item)

      return {
        id: String(item.id || ""),
        name: item.title || item.name || "بدون عنوان",
        description: item.text || item.description || "",
        image: item.image || null,
        created_at: createdAt,
        address: item.address || "",
        sections: [
          {
            id: sectionName,
            name: sectionName
          }
        ],
        kftags: [],
        properties: [],
        url: articleUrl,
        source_type: "articles_latest",
        source_raw: item
      }
    })
  }

  return []
}

function normalizeSourceDataset(source: SiteSourceName, rawData: any): any[] {
  const siteDomain = (process.env.SITE_DOMAIN || "https://alkafeel.net").replace(/\/+$/, "")
  const arr = Array.isArray(rawData)
    ? rawData
    : Array.isArray(rawData?.data)
      ? rawData.data
      : []

  if (source === "articles_latest") {
    return normalizeProjectsDataset(rawData)
  }

  if (source === "videos_latest" || source === "videos_by_category" || source === "friday_sermons" || source === "wahy_friday") {
    const defaultSection = source === "friday_sermons" ? "خطب الجمعة"
      : source === "wahy_friday" ? "من وحي الجمعة"
      : "فيديو"
    return arr.map((item: any) => {
      const section = pickText(item?.cat_title, item?.category, defaultSection)
      const id = String(item?.id || item?.video_id || "")
      // حقل request يحتوي المعرّف الصحيح (hash/slug) لصفحة الخبر
      const mediaSlug = item?.request || item?.news_id || item?.article_id || item?.newsId || item?.articleId
      const url = mediaSlug
        ? `${siteDomain}/media/${encodeURIComponent(String(mediaSlug))}?lang=ar`
        : siteDomain

      return {
        id,
        name: pickText(item?.title, item?.name, "بدون عنوان"),
        description: pickText(item?.caption, item?.description, item?.text, item?.summary),
        image: item?.image || item?.thumb || null,
        created_at: toUnixDate(item?.time || item?.created_at),
        address: "",
        sections: [normalizeSection(section)],
        kftags: [],
        properties: [],
        url,
        source_type: source,
        source_raw: item
      }
    })
  }

  if (source === "videos_categories") {
    return arr.map((item: any) => ({
      id: String(item?.id || item?.cat_id || item?.slug || item?.request || ""),
      name: pickText(item?.title, item?.name, item?.cat_title, "قسم فيديو"),
      description: pickText(item?.description, item?.caption, "قسم من أقسام الفيديو"),
      image: item?.image || item?.photo || item?.icon || null,
      created_at: new Date().toISOString(),
      address: "",
      sections: [normalizeSection("أقسام الفيديو")],
      kftags: [],
      properties: [],
      url: siteDomain,
      source_type: source,
      source_raw: item
    }))
  }

  if (source === "shrine_history_sections") {
    return arr.map((item: any) => ({
      id: String(item?.id || item?.sec_id || item?.title || ""),
      name: pickText(item?.title, item?.name, item?.sec_title, "قسم تاريخ"),
      description: pickText(item?.text, item?.description, "قسم من تاريخ العتبة"),
      image: item?.image || null,
      created_at: new Date().toISOString(),
      address: "",
      sections: [normalizeSection("أقسام تاريخ العتبة")],
      kftags: [],
      properties: [],
      url: `${siteDomain}/history?lang=ar`,
      source_type: source,
      source_raw: item
    }))
  }

  if (source === "shrine_history_timeline") {
    return arr.map((item: any) => ({
      id: String(item?.id || item?.history_id || item?.title || ""),
      name: pickText(item?.title, item?.name, "مرحلة تاريخية"),
      description: pickText(item?.text, item?.description, item?.content),
      image: item?.image || null,
      created_at: toUnixDate(item?.time || item?.created_at),
      address: "",
      sections: [normalizeSection("المراحل التاريخية للعتبة العباسية")],
      kftags: [],
      properties: [],
      url: `${siteDomain}/history?lang=ar`,
      source_type: source,
      source_raw: item
    }))
  }

  if (source === "shrine_history_by_section" || source === "abbas_history_by_id") {
    const historyPath = source === "abbas_history_by_id" ? "/abbas?lang=ar" : "/history?lang=ar"
    return arr.map((item: any) => ({
      id: String(item?.id || item?.history_id || ""),
      name: pickText(item?.title, item?.name, "محتوى تاريخي"),
      description: pickText(item?.text, item?.description, item?.content),
      image: item?.image || null,
      created_at: toUnixDate(item?.time || item?.created_at),
      address: "",
      sections: [normalizeSection(source === "abbas_history_by_id" ? "تاريخ العباس" : "تاريخ العتبة")],
      kftags: [],
      properties: [],
      url: `${siteDomain}${historyPath}`,
      source_type: source,
      source_raw: item
    }))
  }

  if (source === "lang_words_ar") {
    if (!rawData || typeof rawData !== "object") return []
    return Object.entries(rawData).map(([key, value]) => ({
      id: key,
      name: key,
      description: String(value ?? ""),
      image: null,
      created_at: new Date().toISOString(),
      address: "",
      sections: [normalizeSection("قاموس اللغة")],
      kftags: [],
      properties: [],
      url: siteDomain,
      source_type: source,
      source_raw: { key, value }
    }))
  }

  return []
}

const multiSourceCache = new Map<string, { data: any[]; cachedAt: number }>()

function buildSourceCacheKey(source: SiteSourceName, params: SourceFetchParams): string {
  return [
    source,
    params.category_id || "",
    params.section_id || "",
    params.id || ""
  ].join("|")
}

export async function getSourceDocuments(
  source: SiteSourceName,
  params: SourceFetchParams = {}
): Promise<APICallResult> {
  const cacheKey = buildSourceCacheKey(source, params)
  const cached = multiSourceCache.get(cacheKey)
  const now = Date.now()

  if (cached && now - cached.cachedAt < SOURCE_CACHE_DURATION_MS[source]) {
    return { success: true, data: cached.data }
  }

  let endpoint: string
  try {
    endpoint = buildSourceEndpoint(source, params)
  } catch {
    return { success: false, error: `Skipped ${source}: missing required parameter` }
  }

  const policy = getSourceRequestPolicy(source)
  const result = await callSiteAPI(endpoint, {
    timeout: policy.timeout,
    retries: policy.retries,
    source
  })
  if (!result.success) return result

  const normalized = normalizeSourceDataset(source, result.data)
  multiSourceCache.set(cacheKey, { data: normalized, cachedAt: now })
  return { success: true, data: normalized }
}

/** Fetch raw pagination metadata from a source endpoint without normalizing items */
export async function fetchSourceMetadataRaw(
  source: SiteSourceName,
  params: SourceFetchParams = {}
): Promise<{ total: number; per_page: number; current_page: number; last_page: number }> {
  const fallback = { total: 0, per_page: 16, current_page: 1, last_page: 1 }
  let endpoint: string
  try {
    endpoint = buildSourceEndpoint(source, params)
  } catch {
    return fallback
  }
  const policy = getSourceRequestPolicy(source)
  const result = await callSiteAPI(endpoint, {
    timeout: policy.timeout,
    retries: policy.retries,
    source
  })
  if (!result.success || !result.data || typeof result.data !== "object") return fallback

  const raw = result.data
  // Laravel-style pagination: { total, per_page, current_page, last_page, data: [...] }
  // API may return numeric fields as strings, so coerce with Number()
  const numTotal = Number(raw.total)
  const numPerPage = Number(raw.per_page)
  if (Number.isFinite(numTotal) && Number.isFinite(numPerPage) && numPerPage > 0) {
    const numLastPage = Number(raw.last_page) || Math.ceil(numTotal / numPerPage) || 1
    return {
      total: numTotal,
      per_page: numPerPage,
      current_page: Number(raw.current_page) || 1,
      last_page: numLastPage
    }
  }
  // Array response — estimate from length
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : []
  return {
    total: arr.length,
    per_page: 16,
    current_page: 1,
    last_page: 1
  }
}

/** Fetch a specific page of a paginated source (bypasses cache) */
export async function fetchSourcePage(
  source: SiteSourceName,
  page: number,
  params: SourceFetchParams = {}
): Promise<any[]> {
  let endpoint: string
  try {
    endpoint = buildSourceEndpoint(source, params)
  } catch {
    return []
  }
  // Replace page=1 with the requested page number
  const pagedEndpoint = endpoint.replace(/([?&])page=\d+/, `$1page=${page}`)
  if (pagedEndpoint === endpoint && page !== 1) return [] // source doesn't support pagination

  const policy = getSourceRequestPolicy(source)
  const result = await callSiteAPI(pagedEndpoint, {
    timeout: policy.timeout,
    retries: policy.retries,
    source
  })
  if (!result.success) return []
  return normalizeSourceDataset(source, result.data)
}

/** Human-readable source label (internal helper) */
export function friendlySourceLabel(source: string): string {
  const map: Record<string, string> = {
    articles_latest: "الأخبار",
    videos_latest: "الفيديوهات",
    videos_categories: "أقسام الفيديو",
    videos_by_category: "فيديوهات حسب القسم",
    shrine_history_timeline: "المراحل التاريخية للعتبة",
    shrine_history_sections: "أقسام تاريخ العتبة",
    shrine_history_by_section: "تاريخ العتبة",
    abbas_history_by_id: "تاريخ العباس",
    lang_words_ar: "القاموس اللغوي"
  }
  return map[source] || source
}
