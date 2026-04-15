/**
 * Service Layer للتواصل مع REST API الخاص بالموقع
 * 
 * جميع استدعاءات API تمر عبر هذه الطبقة
 * يتم التحكم بالـ Whitelist والتحقق من الأمان هنا
 */

import { fillEndpointTemplate, getSiteAPIConfig } from "./site-api-config"
import type { AllowedToolName } from "./site-tools-definitions"
import { sanitizeAPIResponse } from "./data-sanitizer"

/**
 * إعدادات Timeout و Retry
 */
const API_TIMEOUT_MS = 30000 // 30 ثانية (API بطيء بسبب حجم البيانات)
const MAX_RETRIES = 1 // محاولة واحدة فقط (البيانات كبيرة)
const RETRY_DELAY_MS = 1000 // التأخير بين المحاولات

/**
 * نتيجة استدعاء API
 */
export interface APICallResult {
  success: boolean
  data?: any
  error?: string
  statusCode?: number
}

/**
 * معلومات الاتصال بـ API
 */
interface APIRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE"
  body?: Record<string, any>
  params?: Record<string, string | number | boolean>
  timeout?: number // Timeout مخصص
  retries?: number // عدد محاولات مخصص
}

type SiteSourceName =
  | "articles_latest"
  | "videos_latest"
  | "videos_categories"
  | "videos_by_category"
  | "shrine_history_sections"
  | "shrine_history_by_section"
  | "abbas_history_by_id"
  | "lang_words_ar"
  | "friday_sermons"
  | "wahy_friday"

interface SourceFetchParams {
  source?: SiteSourceName | "auto"
  category_id?: string
  section_id?: string
  id?: string
}

const ALL_SOURCES: SiteSourceName[] = [
  "articles_latest",
  "videos_latest",
  "videos_categories",
  "videos_by_category",
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
  shrine_history_sections: 12 * 60 * 60 * 1000,
  shrine_history_by_section: 60 * 60 * 1000,
  abbas_history_by_id: 60 * 60 * 1000,
  lang_words_ar: 24 * 60 * 60 * 1000,
  friday_sermons: 30 * 60 * 1000,
  wahy_friday: 30 * 60 * 1000
}

/**
 * Fetch مع Timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = API_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    return response
  } catch (error: any) {
    clearTimeout(timeoutId)
    if (error.name === "AbortError") {
      throw new Error(`انتهت مهلة الاتصال بعد ${timeoutMs / 1000} ثانية`)
    }
    throw error
  }
}

/**
 * تأخير (للانتظار بين المحاولات)
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * تنفيذ Retry Logic
 */
async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  delayMs: number = RETRY_DELAY_MS
): Promise<T> {
  let lastError: Error

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error: any) {
      lastError = error

      // إذا كان آخر محاولة، ارمِ الخطأ
      if (attempt === maxRetries) {
        break
      }

      // سجل المحاولة
      console.log(
        `[API Retry] Attempt ${attempt + 1} failed. Retrying in ${delayMs}ms...`
      )

      // انتظر قبل المحاولة التالية
      await delay(delayMs)

      // زيادة التأخير للمحاولة التالية (Exponential Backoff)
      delayMs *= 2
    }
  }

  throw lastError!
}

/**
 * استدعاء عام لـ REST API مع التحقق من الأمان
 * 
 * @param endpoint - المسار النسبي (مثل: /api/projects)
 * @param options - خيارات الطلب
 */
async function callSiteAPI(
  endpoint: string,
  options: APIRequestOptions = {}
): Promise<APICallResult> {
  const {
    method = "GET",
    body,
    params,
    timeout = API_TIMEOUT_MS,
    retries = MAX_RETRIES
  } = options

  // تغليف العملية في retry logic
  return await retryOperation(
    async () => {
      try {
        const config = getSiteAPIConfig()

        // بناء URL كامل بشكل مرن (يدعم endpoint نسبي أو URL كامل)
        const normalizedBase = config.baseUrl.replace(/\/+$/, "")
        const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`

        const isAbsoluteEndpoint =
          endpoint.startsWith("http://") || endpoint.startsWith("https://")

        // إذا كان baseUrl يحتوي مسار عميق والـ endpoint يبدأ من root،
        // نركب الرابط على origin فقط لتجنب تكرار المسار.
        let url: string
        if (isAbsoluteEndpoint) {
          url = endpoint
        } else if (normalizedEndpoint.startsWith("/alkafeel_back_test/")) {
          const baseOrigin = new URL(normalizedBase).origin
          url = `${baseOrigin}${normalizedEndpoint}`
        } else {
          url = `${normalizedBase}${normalizedEndpoint}`
        }

        // إضافة query parameters
        if (params && Object.keys(params).length > 0) {
          const searchParams = new URLSearchParams()
          Object.entries(params).forEach(([key, value]) => {
            searchParams.append(key, String(value))
          })
          const separator = url.includes("?") ? "&" : "?"
          url += `${separator}${searchParams.toString()}`
        }

        // إعداد Headers
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Language": config.acceptLanguage
        }

        // إضافة Token إذا كان متوفراً
        if (config.token) {
          headers["Authorization"] = `Bearer ${config.token}`
        }

        // إعداد الطلب
        const requestOptions: RequestInit = {
          method,
          headers,
          ...(body && method !== "GET" && { body: JSON.stringify(body) })
        }

        // تنفيذ الطلب مع Timeout
        const response = await fetchWithTimeout(url, requestOptions, timeout)

        // معالجة الرد
        if (!response.ok) {
          return {
            success: false,
            error: `خطأ في الاتصال: ${response.status} ${response.statusText}`,
            statusCode: response.status
          }
        }

        // قراءة البيانات
        let data = await response.json()

        console.log("[callSiteAPI] Response type:", typeof data, "| Is Array:", Array.isArray(data))

        // ✅ Phase 4: تنظيف البيانات الحساسة
        data = sanitizeAPIResponse(data)

        console.log("[callSiteAPI] After sanitize - type:", typeof data, "| Is Array:", Array.isArray(data), "| Length:", Array.isArray(data) ? data.length : "N/A")

        return {
          success: true,
          data,
          statusCode: response.status
        }
      } catch (error: any) {
        console.error("[Site API Error]:", error.message)

        // إذا كان خطأ Network، يُعاد المحاولة
        if (
          error.message.includes("fetch") ||
          error.message.includes("network") ||
          error.message.includes("timeout")
        ) {
          throw error // للسماح بـ retry
        }

        // أخطاء أخرى لا تحتاج retry
        return {
          success: false,
          error: error.message || "حدث خطأ غير متوقع أثناء الاتصال بالـ API"
        }
      }
    },
    retries,
    RETRY_DELAY_MS
  ).catch((error: Error) => {
    // إذا فشلت جميع المحاولات
    return {
      success: false,
      error: `فشل الاتصال بعد ${retries + 1} محاولات: ${error.message}`
    }
  })
}

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

/** Category/index sources — structural, not end-content */
const CATEGORY_INDEX_SOURCES: SiteSourceName[] = ["videos_categories", "shrine_history_sections"]

/** Sources safe for pagination expansion (meaningful paginated content, not structural) */
const EXPANDABLE_SOURCES: SiteSourceName[] = ["articles_latest", "videos_latest", "friday_sermons", "wahy_friday"]

// ── Arabic normalization utilities ──────────────────────────────────

/** Full Arabic normalization: lowercase, strip diacritics/tatweel, normalize letter forms */
function normalizeArabic(text: string): string {
  return (text || "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "") // strip tashkeel
    .replace(/\u0640/g, "")                               // strip tatweel
    .replace(/[\u0622\u0623\u0625\u0627]/g, "\u0627")      // normalize alef variants → ا
    .replace(/\u0649/g, "\u064A")                           // ى → ي
    .replace(/\u0629/g, "\u0647")                           // ة → ه
    .replace(/\s+/g, " ")                                   // collapse whitespace
    .trim()
    .toLowerCase()
}

/** Tokenize an Arabic query into meaningful search tokens (≥2 chars) */
function tokenizeArabicQuery(query: string): string[] {
  return normalizeArabic(query)
    .split(/\s+/)
    .filter(w => w.length >= 2)
}

function extractNamedPhrase(query: string): string {
  const norm = normalizeArabic(query)
  const removablePrefixes = [
    "ما اسم", "من هو", "من هي", "اين يقام", "اين", "هل", "كم", "عدد لي", "عدد", "لخص لي", "اشرح لي"
  ]

  let cleaned = norm
  for (const prefix of removablePrefixes) {
    if (cleaned.startsWith(normalizeArabic(prefix))) {
      cleaned = cleaned.substring(normalizeArabic(prefix).length).trim()
      break
    }
  }

  const removableFillers = ["لعتبه", "للعتبه", "العتبه", "العباسيه", "العباسية", "من", "عن", "في", "على", "هل", "يوجد"]
  const tokens = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .filter(t => !removableFillers.includes(t))

  if (tokens.length < 2) return ""
  return tokens.slice(0, 4).join(" ")
}

/**
 * Detect whether the query looks like a (partial) article title rather than a question.
 * Title-like queries are long Arabic phrases without interrogative structure.
 */
function looksLikeTitleQuery(query: string): boolean {
  const trimmed = (query || "").trim()
  if (trimmed.length < 20) return false

  const norm = normalizeArabic(trimmed)

  // Question / command prefixes → NOT a title
  const questionPrefixes = [
    "ما هو", "ما هي", "من هو", "من هي", "كيف", "لماذا", "متي",
    "اين", "هل", "كم", "ابحث", "اعرض", "اعطني", "تحدث", "اريد",
    "عرف", "وضح", "اشرح", "ما الذي", "ما هو عدد"
  ]
  if (questionPrefixes.some(q => norm.startsWith(normalizeArabic(q)))) return false

  // Any question mark → not a title
  if (trimmed.includes("?") || trimmed.includes("\u061F")) return false

  // Must be majority Arabic characters
  const arabicChars = (trimmed.match(/[\u0600-\u06FF]/g) || []).length
  if (arabicChars / trimmed.replace(/\s/g, "").length < 0.5) return false

  // Long enough and no question markers anywhere → likely a title
  if (trimmed.length >= 30) return true

  // Medium length (20-29 chars): accept only if no question words appear at all
  const anyQuestion = questionPrefixes.some(q => norm.includes(normalizeArabic(q)))
  return !anyQuestion
}

/**
 * Title-specific scorer: measures how closely an item's title matches the query.
 * Returns 0–100.  50+ = confident match.
 */
function scoreTitleMatch(item: any, query: string): number {
  const normQ = normalizeArabic(query)
  const normTitle = normalizeArabic(item?.name || "")
  if (!normQ || !normTitle) return 0

  // Exact match
  if (normTitle === normQ) return 100
  // Title contains the full query
  if (normTitle.includes(normQ)) return 85
  // Query contains the full title
  if (normQ.includes(normTitle) && normTitle.length > 10) return 75

  // Token overlap ratio
  const qTokens = tokenizeArabicQuery(query)
  const tTokens = new Set(tokenizeArabicQuery(item?.name || ""))
  if (qTokens.length === 0 || tTokens.size === 0) return 0

  let matchCount = 0
  for (const t of qTokens) {
    for (const tt of tTokens) {
      if (tt.includes(t) || t.includes(tt)) { matchCount++; break }
    }
  }

  const ratio = matchCount / qTokens.length
  if (ratio >= 0.85) return 65
  if (ratio >= 0.7)  return 50
  if (ratio >= 0.5)  return 30
  if (ratio >= 0.3)  return 15
  return 0
}

/** Returns true only when the query clearly asks for categories / sections / classifications */
function isCategoryIntent(query: string): boolean {
  const norm = normalizeArabic(query)
  const categoryKeywords = [
    "الاقسام", "التصنيفات", "الفئات",
    "اقسام الفيديو", "اقسام التاريخ", "اقسام الاخبار",
    "ما هي الاقسام", "ما هي التصنيفات", "ما هي الفئات",
    "قائمه الاقسام", "قائمه التصنيفات"
  ]
  return categoryKeywords.some(kw => norm.includes(normalizeArabic(kw)))
}

/** Check whether a parametric source can be fetched with the given params */
function canFetchSource(source: SiteSourceName, params: SourceFetchParams): boolean {
  switch (source) {
    case "videos_by_category":        return !!params.category_id
    case "shrine_history_by_section": return !!params.section_id
    case "abbas_history_by_id":       return !!params.id
    default: return true
  }
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
      id: String(item?.id || item?.cat_id || item?.slug || ""),
      name: pickText(item?.title, item?.name, item?.cat_title, "قسم فيديو"),
      description: pickText(item?.description, "قسم من أقسام الفيديو"),
      image: item?.image || null,
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

async function getSourceDocuments(
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

  const result = await callSiteAPI(endpoint)
  if (!result.success) return result

  const normalized = normalizeSourceDataset(source, result.data)
  multiSourceCache.set(cacheKey, { data: normalized, cachedAt: now })
  return { success: true, data: normalized }
}

/**
 * توحيد شكل البيانات القادمة من APIs مختلفة إلى مصفوفة مشاريع موحدة
 */
function normalizeProjectsDataset(rawData: any): any[] {
  if (Array.isArray(rawData)) {
    return rawData
  }

  const siteDomain = (process.env.SITE_DOMAIN || "https://alkafeel.net").replace(/\/+$/, "")
  const articleUrlTemplate = process.env.SITE_ARTICLE_URL_TEMPLATE || "/news/index?id={id}"

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

/**
 * جلب جميع المشاريع من API
 * يتم cache النتائج لتجنب استدعاءات متكررة
 */
let projectsCache: any[] | null = null
let projectsCacheTime: number = 0
const CACHE_DURATION = 30 * 60 * 1000 // 30 دقيقة — تقليل استدعاءات API

async function getAllProjects(): Promise<APICallResult> {
  console.log("[getAllProjects] Starting...")
  const config = getSiteAPIConfig()
  
  // تحقق من الـ cache
  const now = Date.now()
  if (projectsCache && now - projectsCacheTime < CACHE_DURATION) {
    console.log("[getAllProjects] Returning cached data")
    return {
      success: true,
      data: projectsCache
    }
  }

  console.log("[getAllProjects] Cache miss, fetching from API...")
  
  // جلب البيانات من API
  const result = await callSiteAPI(config.allProjectsEndpoint)
  const normalizedProjects = result.success
    ? normalizeProjectsDataset(result.data)
    : []

  console.log(
    "[getAllProjects] API result:",
    result.success
      ? `Success (${normalizedProjects.length} projects)`
      : `Failed: ${result.error}`
  )

  if (result.success && normalizedProjects.length > 0) {
    projectsCache = normalizedProjects
    projectsCacheTime = now
    console.log("[getAllProjects] Cached", normalizedProjects.length, "projects")

    return {
      success: true,
      data: normalizedProjects
    }
  }

  if (result.success && normalizedProjects.length === 0) {
    return {
      success: false,
      error: "تم استلام البيانات لكن بصيغة غير مدعومة."
    }
  }

  return result
}

/**
 * البحث العميق في المشاريع
 * يبحث في: الاسم، الوصف، الأقسام، الخصائص (المكان، المواصفات، الجهة المنفذة...)،
 * العلامات (tags)، والعنوان
 * 
 * @param query - كلمة البحث
 * @param section - اسم القسم بالعربية (اختياري)
 * @param limit - عدد النتائج
 */
export async function siteSearch(
  query?: string,
  section?: string,
  limit: number = 5
): Promise<APICallResult> {
  const allProjects = await getAllProjects()
  
  if (!allProjects.success) {
    return allProjects
  }

  const projects = allProjects.data as any[]

  // ✅ معالجة query فارغ أو undefined — GPT أحياناً يرسل section فقط بدون query
  const safeQuery = (query || "").trim()

  // تقسيم الاستعلام إلى كلمات فردية للبحث المرن
  const normQuery = normalizeArabic(safeQuery)
  const queryWords = tokenizeArabicQuery(safeQuery)
  const lowerQuery = normQuery

  /**
   * استخراج كل النصوص القابلة للبحث من مشروع
   * يعيد مصفوفة من النصوص مع أوزان (weight) لترتيب النتائج
   */
  function getSearchableTexts(project: any): { text: string; weight: number }[] {
    const texts: { text: string; weight: number }[] = []

    // 1. اسم المشروع — وزن عالي جداً
    if (project.name) {
      texts.push({ text: normalizeArabic(project.name), weight: 10 })
    }

    // 2. الوصف — وزن عالي
    if (project.description) {
      texts.push({ text: normalizeArabic(project.description), weight: 5 })
    }

    // 3. العنوان — وزن عالي
    if (project.address) {
      texts.push({ text: normalizeArabic(project.address), weight: 5 })
    }

    // 4. أسماء الأقسام — وزن متوسط
    if (Array.isArray(project.sections)) {
      for (const s of project.sections) {
        if (s.name) texts.push({ text: normalizeArabic(s.name), weight: 3 })
      }
    }

    // 5. الخصائص properties (المكان، المواصفات، الجهة المنفذة، تاريخ الافتتاح...) — وزن متوسط-عالي
    if (Array.isArray(project.properties)) {
      for (const prop of project.properties) {
        // اسم الخاصية
        if (prop.name) texts.push({ text: normalizeArabic(prop.name), weight: 3 })
        // قيمة الخاصية (قد تكون في pivot.value أو value)
        const val = prop.pivot?.value || prop.value
        if (val && typeof val === "string") {
          texts.push({ text: normalizeArabic(val), weight: 4 })
        }
      }
    }

    // 6. العلامات kftags — وزن متوسط
    if (Array.isArray(project.kftags)) {
      for (const tag of project.kftags) {
        if (tag.title) texts.push({ text: normalizeArabic(tag.title), weight: 3 })
        if (tag.name) texts.push({ text: normalizeArabic(tag.name), weight: 3 })
      }
    }

    // 7. الأخبار kfnews — وزن منخفض
    if (Array.isArray(project.kfnews)) {
      for (const news of project.kfnews) {
        if (news.title) texts.push({ text: normalizeArabic(news.title), weight: 2 })
        if (news.description) texts.push({ text: normalizeArabic(news.description), weight: 1 })
      }
    }

    return texts
  }

  /**
   * حساب درجة التطابق لمشروع
   * كلما ارتفعت الدرجة، كان التطابق أفضل
   */
  function scoreProject(project: any): number {
    const searchTexts = getSearchableTexts(project)
    let score = 0

    for (const { text, weight } of searchTexts) {
      // مطابقة الاستعلام الكامل — أعلى نقاط
      if (text.includes(lowerQuery)) {
        score += weight * 3
      }

      // مطابقة الكلمات الفردية
      for (const word of queryWords) {
        if (text.includes(word)) {
          score += weight
        }
      }
    }

    return score
  }

  // فلترة المشاريع مع حساب درجة التطابق
  let scored = projects.map(project => ({
    project,
    score: scoreProject(project)
  }))

  // فلترة حسب القسم إذا كان محدداً
  if (section) {
    const normSection = normalizeArabic(section)
    scored = scored.filter(({ project }) =>
      project.sections?.some((s: any) =>
        normalizeArabic(s.name || "").includes(normSection)
      )
    )
  }

  // حذف المشاريع التي لم تطابق أي شيء (score = 0)
  // لكن إذا حددنا قسم بدون query فعلي، نقبل الكل
  if (queryWords.length > 0) {
    scored = scored.filter(({ score }) => score > 0)
  }

  // ترتيب حسب الدرجة (الأعلى أولاً)
  scored.sort((a, b) => b.score - a.score)

  // حد النتائج
  const filtered = scored.slice(0, limit).map(({ project }) => project)

  return {
    success: true,
    data: {
      results: filtered,
      total: filtered.length,
      query: safeQuery || section || ""
    }
  }
}

/**
 * الحصول على تفاصيل مشروع محدد
 * 
 * @param id - معرف المشروع
 */
export async function siteGetProject(id: string): Promise<APICallResult> {
  const allProjects = await getAllProjects()
  
  if (!allProjects.success) {
    return allProjects
  }

  const projects = allProjects.data as any[]
  const project = projects.find(p => String(p.id) === String(id))

  if (!project) {
    return {
      success: false,
      error: `لم يتم العثور على المشروع ${id}`
    }
  }

  return {
    success: true,
    data: project
  }
}

/**
 * الحصول على قائمة الفئات (الأقسام)
 * 
 * @param include_counts - تضمين عدد المشاريع في كل فئة
 */
export async function siteListCategories(
  include_counts: boolean = false
): Promise<APICallResult> {
  const allProjects = await getAllProjects()
  
  if (!allProjects.success) {
    return allProjects
  }

  const projects = allProjects.data as any[]
  const sectionsMap = new Map<number, {name: string, count: number}>()

  // استخراج جميع الأقسام
  projects.forEach(project => {
    if (Array.isArray(project.sections)) {
      project.sections.forEach((section: any) => {
        if (section.id && section.name) {
          const existing = sectionsMap.get(section.id)
          if (existing) {
            existing.count++
          } else {
            sectionsMap.set(section.id, { name: section.name, count: 1 })
          }
        }
      })
    }
  })

  const categories = Array.from(sectionsMap.entries()).map(([id, data]) => ({
    id,
    name: data.name,
    ...(include_counts && { count: data.count })
  }))

  return {
    success: true,
    data: {
      categories,
      total_categories: categories.length
    }
  }
}

/**
 * الحصول على أحدث المشاريع
 * 
 * @param limit - عدد المشاريع
 * @param category - فئة اختيارية
 */
export async function siteGetLatest(
  limit: number = 5,
  section?: string
): Promise<APICallResult> {
  const allProjects = await getAllProjects()
  
  if (!allProjects.success) {
    return allProjects
  }

  let projects = allProjects.data as any[]

  // فلترة حسب القسم إذا كان محدداً
  if (section) {
    projects = projects.filter(project => 
      project.sections?.some((s: any) => 
        s.name?.toLowerCase().includes(section.toLowerCase())
      )
    )
  }

  // ترتيب حسب تاريخ الإنشاء (الأحدث أولاً)
  projects.sort((a, b) => {
    const dateA = new Date(a.created_at || 0).getTime()
    const dateB = new Date(b.created_at || 0).getTime()
    return dateB - dateA
  })

  // حد النتائج
  projects = projects.slice(0, limit)

  return {
    success: true,
    data: {
      projects,
      total: projects.length,
      limit
    }
  }
}

/**
 * الحصول على إحصائيات المشاريع
 */
export async function siteGetStatistics(): Promise<APICallResult> {
  const allProjects = await getAllProjects()
  
  if (!allProjects.success) {
    return allProjects
  }

  const projects = allProjects.data as any[]
  
  // حساب الإحصائيات
  const totalProjects = projects.length
  
  // عد المشاريع حسب الأقسام
  const sectionCounts = new Map<string, number>()
  projects.forEach(project => {
    if (Array.isArray(project.sections)) {
      project.sections.forEach((section: any) => {
        const name = section.name || 'غير مصنف'
        sectionCounts.set(name, (sectionCounts.get(name) || 0) + 1)
      })
    }
  })

  const topSections = Array.from(sectionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ section: name, count }))

  return {
    success: true,
    data: {
      total_projects: totalProjects,
      top_sections: topSections,
      sections_count: sectionCounts.size
    }
  }
}

// ── Stronger multi-field scoring ────────────────────────────────────

interface WeightedField { text: string; weight: number }

/** Extract all searchable text fields from a unified item with weights */
function getItemSearchFields(item: any): WeightedField[] {
  const out: WeightedField[] = []
  if (item?.name)        out.push({ text: normalizeArabic(item.name), weight: 10 })
  if (item?.description) out.push({ text: normalizeArabic(item.description), weight: 5 })
  if (item?.address)     out.push({ text: normalizeArabic(item.address), weight: 5 })

  if (Array.isArray(item?.sections)) {
    for (const s of item.sections) {
      if (s?.name) out.push({ text: normalizeArabic(s.name), weight: 2 })
    }
  }
  if (Array.isArray(item?.properties)) {
    for (const p of item.properties) {
      if (p?.name) out.push({ text: normalizeArabic(p.name), weight: 3 })
      const val = p?.pivot?.value || p?.value
      if (typeof val === "string") out.push({ text: normalizeArabic(val), weight: 4 })
    }
  }
  if (Array.isArray(item?.kftags)) {
    for (const t of item.kftags) {
      if (t?.title) out.push({ text: normalizeArabic(t.title), weight: 3 })
      if (t?.name)  out.push({ text: normalizeArabic(t.name), weight: 3 })
    }
  }

  // source_raw extras (caption/summary) — weak
  const raw = item?.source_raw
  if (raw) {
    if (raw.caption)  out.push({ text: normalizeArabic(raw.caption), weight: 2 })
    if (raw.summary)  out.push({ text: normalizeArabic(raw.summary), weight: 2 })
  }

  // source_type only as very weak signal
  if (item?.source_type) out.push({ text: normalizeArabic(item.source_type), weight: 1 })

  return out
}

function scoreUnifiedItem(item: any, query: string): number {
  const normQ = normalizeArabic(query)
  if (!normQ) return 1

  const tokens = tokenizeArabicQuery(query)
  const namedPhrase = extractNamedPhrase(query)
  const fields = getItemSearchFields(item)
  let score = 0
  let matchedTokenCount = 0
  let hasSpecificNamedPhrase = false

  const genericTokens = new Set(["ما", "اسم", "من", "هو", "هي", "هل", "اين", "يقام", "كم", "عدد", "لي", "عن", "في", "على", "العتبه", "العتبة", "العباسيه", "العباسية", "مشروع", "مشاريع"])
  const specificTokens = tokens.filter(t => !genericTokens.has(t))
  let matchedSpecificToken = false

  for (const { text, weight } of fields) {
    if (!text) continue
    // Full query match — highest boost
    if (text.includes(normQ)) score += weight * 4

    if (namedPhrase && text.includes(namedPhrase)) {
      score += weight * 6
      hasSpecificNamedPhrase = true
    }

    // Per-token matching
    for (const tok of tokens) {
      if (text.includes(tok)) {
        score += weight
        matchedTokenCount++
        if (!matchedSpecificToken && specificTokens.includes(tok)) {
          matchedSpecificToken = true
        }
      }
    }
  }

  // Bonus when ALL tokens matched somewhere
  if (tokens.length > 1 && matchedTokenCount >= tokens.length) {
    score += 8
  }

  if (hasSpecificNamedPhrase) {
    score += 10
  }

  if (specificTokens.length > 0 && !matchedSpecificToken && !hasSpecificNamedPhrase) {
    score = Math.floor(score * 0.3)
  }

  // Penalty: if score only came from weak section/source_type matches
  if (score > 0 && score <= 4) {
    score = Math.max(1, score - 1)
  }

  return score
}

// ── Evidence snippet builder ────────────────────────────────────────

/** Build a short evidence snippet showing where the query matched in the item */
function buildEvidenceSnippet(item: any, query: string): string {
  const normQ = normalizeArabic(query)
  const tokens = tokenizeArabicQuery(query)
  if (!normQ && tokens.length === 0) return ""

  // Candidate raw text fields to extract snippet from, ordered by relevance
  const rawCandidates: { raw: string; weight: number }[] = []
  if (item?.name)        rawCandidates.push({ raw: item.name, weight: 10 })
  if (item?.description) rawCandidates.push({ raw: item.description, weight: 5 })
  if (item?.address)     rawCandidates.push({ raw: item.address, weight: 4 })
  const rawSrc = item?.source_raw
  if (rawSrc?.text)      rawCandidates.push({ raw: rawSrc.text, weight: 3 })
  if (rawSrc?.caption)   rawCandidates.push({ raw: rawSrc.caption, weight: 2 })
  if (rawSrc?.summary)   rawCandidates.push({ raw: rawSrc.summary, weight: 2 })
  if (rawSrc?.content)   rawCandidates.push({ raw: rawSrc.content, weight: 2 })

  // Find best matching field
  let bestSnippet = ""
  let bestScore = -1

  for (const { raw, weight } of rawCandidates) {
    if (!raw || typeof raw !== "string") continue
    const norm = normalizeArabic(raw)
    let fieldScore = 0
    let matchPos = -1

    const fullIdx = norm.indexOf(normQ)
    if (fullIdx !== -1) {
      fieldScore = weight * 4
      matchPos = fullIdx
    } else {
      for (const tok of tokens) {
        const idx = norm.indexOf(tok)
        if (idx !== -1) {
          fieldScore += weight
          if (matchPos === -1) matchPos = idx
        }
      }
    }

    if (fieldScore > bestScore) {
      bestScore = fieldScore
      // Extract a window around the match in the ORIGINAL (non-normalized) text
      if (matchPos !== -1) {
        const WINDOW = 120
        const start = Math.max(0, matchPos - 30)
        const end = Math.min(raw.length, matchPos + WINDOW)
        bestSnippet = (start > 0 ? "…" : "") + raw.slice(start, end).trim() + (end < raw.length ? "…" : "")
      } else {
        bestSnippet = raw.slice(0, 150).trim() + (raw.length > 150 ? "…" : "")
      }
    }
  }

  return bestSnippet
}

export async function siteSearchContent(
  query: string,
  source: SiteSourceName | "auto" = "auto",
  limit: number = 5,
  params: SourceFetchParams = {}
): Promise<APICallResult> {
  const safeLimit = Math.min(Math.max(limit || 5, 1), 20)
  const rawCandidates = source === "auto"
    ? rankCandidateSources(query, params)
    : [source]

  // Filter out parametric sources that cannot be fetched + category sources unless intent matches
  const candidates = rawCandidates.filter(s => {
    if (!canFetchSource(s, params)) return false
    if (CATEGORY_INDEX_SOURCES.includes(s) && !isCategoryIntent(query)) return false
    return true
  })

  const fetched = await Promise.all(
    candidates.map(async s => ({ source: s, result: await getSourceDocuments(s, params) }))
  )

  let merged: any[] = []
  for (const entry of fetched) {
    if (entry.result.success && Array.isArray(entry.result.data)) {
      merged.push(...entry.result.data)
    }
  }

  // Abbas/history auto-resolution: when sections were fetched, find relevant section
  // and automatically pull its content for broad biography queries
  const norm = normalizeArabic(query)
  const abbasAutoHints = ["العباس", "ابو الفضل", "ابا الفضل", "ابوالفضل"]
  const isAbbasBioQuery = abbasAutoHints.some(h => norm.includes(normalizeArabic(h)))
  if (isAbbasBioQuery && !params.section_id && !params.id && source === "auto") {
    // shrine_history_sections items already contain full text in description
    // Score them directly against the query and include relevant ones
    const sectionsResult = await getSourceDocuments("shrine_history_sections")
    if (sectionsResult.success && Array.isArray(sectionsResult.data)) {
      for (const item of sectionsResult.data) {
        const s = scoreUnifiedItem(item, query)
        if (s > 0) {
          merged.push(item)
        }
      }
    }
  }

  // fallback — only non-parametric, non-category sources
  if (merged.length === 0 && source === "auto") {
    const SAFE_FALLBACK: SiteSourceName[] = ["articles_latest", "videos_latest", "lang_words_ar"]
    const fallback = await Promise.all(
      SAFE_FALLBACK.map(async s => ({ source: s, result: await getSourceDocuments(s, params) }))
    )
    for (const entry of fallback) {
      if (entry.result.success && Array.isArray(entry.result.data)) {
        merged.push(...entry.result.data)
      }
    }
  }

  // Deduplicate
  const deduped = new Map<string, any>()
  for (const item of merged) {
    const key = `${item?.source_type || "source"}:${item?.id || item?.name || Math.random()}`
    if (!deduped.has(key)) deduped.set(key, item)
  }

  // Score, sort, slice
  let scored = Array.from(deduped.values())
    .map(item => ({ item, score: scoreUnifiedItem(item, query) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)

  // Expansion: if results are sparse, try loading more from expandable sources
  if (scored.length < safeLimit && source === "auto" && tokenizeArabicQuery(query).length > 0) {
    const expandSources = candidates.filter(s => EXPANDABLE_SOURCES.includes(s))
    if (expandSources.length > 0) {
      const extra = await expandSearchFromSources(expandSources, params, deduped)
      for (const item of extra) {
        const s = scoreUnifiedItem(item, query)
        if (s > 0) scored.push({ item, score: s })
      }
      scored.sort((a, b) => b.score - a.score)
    }
  }

  // Deep title search: if the query looks like a title and no existing result
  // is a strong title match, scan deeper into archives in parallel.
  const isTitleQ = looksLikeTitleQuery(query)
  const hasStrongTitleHit = scored.some(s => scoreTitleMatch(s.item, query) >= 50)
  if (isTitleQ && !hasStrongTitleHit && source === "auto") {
    console.log("[siteSearchContent] Title-query detected, launching deep archive scan...")
    const deepSources = candidates.filter(s => EXPANDABLE_SOURCES.includes(s))
    if (deepSources.length > 0) {
      const deepHits = await deepTitleSearch(query, deepSources, params, deduped, safeLimit)
      for (const h of deepHits) {
        scored.push(h)
      }
      scored.sort((a, b) => b.score - a.score)
    }
  }

  // Attach evidence snippets
  const results = scored.slice(0, safeLimit).map(x => ({
    ...x.item,
    _snippet: buildEvidenceSnippet(x.item, query)
  }))

  return {
    success: true,
    data: {
      results,
      total: results.length,
      result_count: results.length,
      top_score: scored.length > 0 ? scored[0].score : null,
      query,
      source_used: source,
      candidate_sources: candidates,
      source_attempts: candidates
    }
  }
}

/** Fetch a specific page of a paginated source (bypasses cache) */
async function fetchSourcePage(
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

  const result = await callSiteAPI(pagedEndpoint)
  if (!result.success) return []
  return normalizeSourceDataset(source, result.data)
}

/** Expand search by fetching additional pages from expandable sources (parallel batches) */
async function expandSearchFromSources(
  sources: SiteSourceName[],
  params: SourceFetchParams,
  alreadySeen: Map<string, any>
): Promise<any[]> {
  const extra: any[] = []
  const MAX_EXPANSION_PAGE = 6
  const BATCH = 5

  for (const s of sources) {
    const meta = await fetchSourceMetadataRaw(s)
    const maxPage = Math.min(meta.last_page, MAX_EXPANSION_PAGE)

    for (let batchStart = 2; batchStart <= maxPage; batchStart += BATCH) {
      const batchEnd = Math.min(batchStart + BATCH - 1, maxPage)
      const pages = Array.from({ length: batchEnd - batchStart + 1 }, (_, i) => batchStart + i)
      const batchResults = await Promise.all(pages.map(p => fetchSourcePage(s, p, params)))

      for (const items of batchResults) {
        for (const item of items) {
          const key = `${item?.source_type || "source"}:${item?.id || item?.name || Math.random()}`
          if (!alreadySeen.has(key)) {
            alreadySeen.set(key, item)
            extra.push(item)
          }
        }
      }
    }
  }
  return extra
}

// ── Deep title search (parallel batch scanning) ─────────────────────

/**
 * Scan deep into paginated archives in parallel batches looking for
 * high-confidence title matches.  Used when `looksLikeTitleQuery` is true.
 *
 * Strategy:  Scan from BOTH ends simultaneously:
 *  - newest → pages 2..MAX_DEEP_PAGE   (recent articles)
 *  - oldest → pages last_page..last_page-MAX_DEEP_PAGE  (very old articles)
 *  Both directions run in interleaved parallel batches.
 *  Stop early when a ≥50 confidence title match is found.
 */
async function deepTitleSearch(
  query: string,
  sources: SiteSourceName[],
  params: SourceFetchParams,
  alreadySeen: Map<string, any>,
  limit: number = 5
): Promise<{ item: any; score: number }[]> {
  const MAX_DEEP_PAGE = 150     // max pages per direction
  const BATCH_SIZE = 10
  const HIGH_CONFIDENCE = 50

  const hits: { item: any; score: number }[] = []

  for (const source of sources) {
    if (!EXPANDABLE_SOURCES.includes(source)) continue

    const meta = await fetchSourceMetadataRaw(source)
    if (meta.last_page <= 1) continue

    // Build page ranges for both directions
    const newestMax = Math.min(meta.last_page, MAX_DEEP_PAGE)
    const oldestStart = meta.last_page
    const oldestMin = Math.max(1, meta.last_page - MAX_DEEP_PAGE + 1)

    let foundHigh = false
    let newestPage = 2
    let oldestPage = oldestStart

    while (!foundHigh && (newestPage <= newestMax || oldestPage >= oldestMin)) {
      const pagesToFetch: number[] = []

      // Add a batch from the newest direction
      for (let i = 0; i < BATCH_SIZE && newestPage <= newestMax; i++, newestPage++) {
        pagesToFetch.push(newestPage)
      }
      // Add a batch from the oldest direction
      for (let i = 0; i < BATCH_SIZE && oldestPage >= oldestMin; i++, oldestPage--) {
        if (!pagesToFetch.includes(oldestPage)) pagesToFetch.push(oldestPage)
      }

      if (pagesToFetch.length === 0) break

      const batchResults = await Promise.all(
        pagesToFetch.map(p => fetchSourcePage(source, p, params))
      )

      for (const items of batchResults) {
        for (const item of items) {
          const key = `${item?.source_type || "source"}:${item?.id || item?.name || Math.random()}`
          if (alreadySeen.has(key)) continue
          alreadySeen.set(key, item)

          const ts = scoreTitleMatch(item, query)
          if (ts > 0) {
            const gs = scoreUnifiedItem(item, query)
            hits.push({ item, score: Math.max(ts, gs) })
            if (ts >= HIGH_CONFIDENCE) foundHigh = true
          }
        }
      }
    }
  }

  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}

// ── Weighted candidate source ranking ───────────────────────────────

interface SourceScore { source: SiteSourceName; score: number }

/** Rank candidate sources by query affinity instead of simple if/else branches */
function rankCandidateSources(query: string, params: SourceFetchParams = {}): SiteSourceName[] {
  const norm = normalizeArabic(query)
  const scores: SourceScore[] = []

  // Always include articles as baseline
  scores.push({ source: "articles_latest", score: 5 })

  // Video signals
  const videoHints = ["فيديو", "فديو", "مرئي", "يوتيوب", "مقطع", "مشاهده"]
  const videoBoost = videoHints.reduce((acc, h) => acc + (norm.includes(normalizeArabic(h)) ? 6 : 0), 0)
  scores.push({ source: "videos_latest", score: 3 + videoBoost })
  if (params.category_id) scores.push({ source: "videos_by_category", score: 4 + videoBoost })
  if (isCategoryIntent(query)) scores.push({ source: "videos_categories", score: 2 + videoBoost })

  // History signals
  const historyHints = ["تاريخ", "سيره", "العباس", "العتبه", "ابو الفضل", "تاريخي"]
  const histBoost = historyHints.reduce((acc, h) => acc + (norm.includes(normalizeArabic(h)) ? 5 : 0), 0)
  if (params.section_id) scores.push({ source: "shrine_history_by_section", score: 4 + histBoost })
  if (params.id) scores.push({ source: "abbas_history_by_id", score: 4 + histBoost })
  if (isCategoryIntent(query) && histBoost > 0) scores.push({ source: "shrine_history_sections", score: 2 + histBoost })

  // Abbas / broad biography intent — even without params, include sections for auto-resolution
  const abbasHints = ["العباس", "ابو الفضل", "ابا الفضل", "ابوالفضل"]
  const isAbbasIntent = abbasHints.some(h => norm.includes(normalizeArabic(h)))
  if (isAbbasIntent && !params.section_id && !params.id) {
    scores.push({ source: "shrine_history_sections", score: 6 + histBoost })
  }

  // Friday sermon signals
  const sermonHints = ["خطبه", "خطب", "جمعه", "صلاه الجمعه", "وحي الجمعه", "خطيب"]
  const sermonBoost = sermonHints.reduce((acc, h) => acc + (norm.includes(normalizeArabic(h)) ? 6 : 0), 0)
  if (sermonBoost > 0) {
    const isExplicitWahy =
      norm.includes(normalizeArabic("من وحي")) ||
      norm.includes(normalizeArabic("وحي الجمعه"))
    const isExplicitSermon =
      norm.includes(normalizeArabic("خطب")) ||
      norm.includes(normalizeArabic("خطبه")) ||
      norm.includes(normalizeArabic("خطيب"))

    const wahyBias = isExplicitWahy ? 4 : 0
    const sermonBias = isExplicitSermon ? 4 : 0

    scores.push({ source: "friday_sermons", score: 6 + sermonBoost + sermonBias })
    scores.push({ source: "wahy_friday", score: 5 + sermonBoost + wahyBias })
  }

  // Office-holder facts + named initiatives/events
  const officeHolderHints = ["المتولي", "المتولي الشرعي", "الامين العام", "امين عام", "مسؤول"]
  const officeBoost = officeHolderHints.reduce((acc, h) => acc + (norm.includes(normalizeArabic(h)) ? 7 : 0), 0)
  if (officeBoost > 0) {
    scores.push({ source: "articles_latest", score: 8 + officeBoost })
    scores.push({ source: "shrine_history_sections", score: 6 + officeBoost })
  }

  const namedEventHints = ["نداء العقيده", "نداء العقيدة", "مهرجان", "فعاليه", "فعالية", "مبادره", "مبادرة", "برنامج"]
  const eventBoost = namedEventHints.reduce((acc, h) => acc + (norm.includes(normalizeArabic(h)) ? 7 : 0), 0)
  if (eventBoost > 0) {
    scores.push({ source: "articles_latest", score: 8 + eventBoost })
    scores.push({ source: "videos_latest", score: 7 + eventBoost })
    scores.push({ source: "wahy_friday", score: 5 + eventBoost })
    scores.push({ source: "friday_sermons", score: 5 + eventBoost })
  }

  const singularProjectHints = ["مشروع ", "مشروع", "دجاج", "زراعي", "انتاج", "إنتاج", "تربية"]
  const projectBoost = singularProjectHints.reduce((acc, h) => acc + (norm.includes(normalizeArabic(h)) ? 5 : 0), 0)
  if (projectBoost > 0) {
    scores.push({ source: "articles_latest", score: 7 + projectBoost })
    scores.push({ source: "videos_latest", score: 5 + projectBoost })
  }

  // Language signals
  const langHints = ["ترجمه", "لغه", "كلمه", "مصطلح", "معني", "قاموس"]
  const langBoost = langHints.reduce((acc, h) => acc + (norm.includes(normalizeArabic(h)) ? 6 : 0), 0)
  if (langBoost > 0) scores.push({ source: "lang_words_ar", score: 4 + langBoost })
  else scores.push({ source: "lang_words_ar", score: 1 })

  // Sort by score desc, take top 4
  scores.sort((a, b) => b.score - a.score)

  // Deduplicate and return
  const seen = new Set<SiteSourceName>()
  const ranked: SiteSourceName[] = []
  for (const { source } of scores) {
    if (!seen.has(source)) {
      seen.add(source)
      ranked.push(source)
    }
  }
  return ranked.slice(0, 4)
}

export async function siteGetContentById(
  id: string,
  source: SiteSourceName | "auto" = "auto",
  params: SourceFetchParams = {}
): Promise<APICallResult> {
  const candidates = source === "auto" ? ALL_SOURCES : [source]
  const strId = String(id)

  // Phase 1: search in cached page-1 data for all candidate sources
  for (const s of candidates) {
    const result = await getSourceDocuments(s, { ...params, id })
    if (!result.success || !Array.isArray(result.data)) continue
    const hit = result.data.find((item: any) => String(item?.id) === strId)
    if (hit) {
      return { success: true, data: hit }
    }
  }

  // Phase 2: for paginated sources, use metadata to estimate candidate page
  const paginatedCandidates = candidates.filter(s => EXPANDABLE_SOURCES.includes(s))
  for (const s of paginatedCandidates) {
    // Fetch metadata to know how many pages exist
    const meta = await fetchSourceMetadataRaw(s)
    const maxPage = Math.min(meta.last_page, 10) // cap at 10 pages to stay bounded

    // Try numeric ID heuristic: if id is numeric and per_page is known,
    // estimate which page it might be on
    const numId = Number(strId)
    const pagesToTry: number[] = []

    if (Number.isFinite(numId) && numId > 0 && meta.per_page > 0 && meta.total > 0) {
      // Items are usually newest-first, so older IDs are on higher pages
      // Estimate: page ≈ ceil((total - numId_position) / per_page)
      // Since we don't know exact position, try a few nearby pages
      const estimatedPage = Math.ceil(meta.total / meta.per_page)
      const candidates_pages = [2, 3, estimatedPage, estimatedPage - 1, estimatedPage + 1]
      for (const p of candidates_pages) {
        if (p >= 2 && p <= maxPage && !pagesToTry.includes(p)) pagesToTry.push(p)
      }
    } else {
      // Fallback: try pages 2–5 sequentially
      for (let p = 2; p <= Math.min(5, maxPage); p++) pagesToTry.push(p)
    }

    for (const page of pagesToTry) {
      const items = await fetchSourcePage(s, page, params)
      if (items.length === 0) continue
      const hit = items.find((item: any) => String(item?.id) === strId)
      if (hit) {
        return { success: true, data: hit }
      }
    }
  }

  return {
    success: false,
    error: `لم يتم العثور على محتوى بالمعرف ${id}`
  }
}

export async function siteListSourceCategories(
  source: SiteSourceName | "auto" = "auto"
): Promise<APICallResult> {
  const categories: Array<{ id: string; name: string; source: string }> = []
  const candidates = source === "auto"
    ? ["articles_latest", "videos_categories", "shrine_history_sections"] as SiteSourceName[]
    : [source]

  for (const s of candidates) {
    const result = await getSourceDocuments(s)
    if (!result.success || !Array.isArray(result.data)) continue

    if (s === "articles_latest") {
      const map = new Map<string, string>()
      result.data.forEach((item: any) => {
        item?.sections?.forEach((sec: any) => {
          if (sec?.id && sec?.name) map.set(String(sec.id), String(sec.name))
        })
      })
      map.forEach((name, id) => categories.push({ id, name, source: s }))
      continue
    }

    result.data.forEach((item: any) => {
      categories.push({
        id: String(item?.id || ""),
        name: String(item?.name || "بدون اسم"),
        source: s
      })
    })
  }

  return {
    success: true,
    data: {
      categories,
      total_categories: categories.length,
      source_used: source
    }
  }
}

export async function siteGetLatestBySource(
  source: SiteSourceName | "auto" = "auto",
  limit: number = 5,
  params: SourceFetchParams = {}
): Promise<APICallResult> {
  const safeLimit = Math.min(Math.max(limit || 5, 1), 20)
  const candidates = source === "auto"
    ? (["articles_latest", "videos_latest"] as SiteSourceName[]).filter(s => canFetchSource(s, params))
    : [source]

  const results = await Promise.all(candidates.map(s => getSourceDocuments(s, params)))
  const merged = results
    .filter(r => r.success && Array.isArray(r.data))
    .flatMap(r => r.data as any[])

  merged.sort((a, b) => {
    const dateA = new Date(a?.created_at || 0).getTime()
    const dateB = new Date(b?.created_at || 0).getTime()
    return dateB - dateA
  })

  const items = merged.slice(0, safeLimit)
  return {
    success: true,
    data: {
      projects: items,
      total: items.length,
      limit: safeLimit,
      source_used: source,
      candidate_sources: candidates
    }
  }
}

export async function siteGetMultiSourceStatistics(): Promise<APICallResult> {
  const targets: SiteSourceName[] = ["articles_latest", "videos_latest", "lang_words_ar"]

  const bySource = await Promise.all(targets.map(async s => {
    // For paginated sources, use real metadata total
    if (EXPANDABLE_SOURCES.includes(s)) {
      const meta = await fetchSourceMetadataRaw(s)
      if (meta.total > 0) {
        return { source: s, count: meta.total }
      }
    }
    // Fallback: use loaded document count
    const docs = await getSourceDocuments(s)
    const count = docs.success && Array.isArray(docs.data) ? docs.data.length : 0
    return { source: s, count }
  }))

  const total = bySource.reduce((acc, cur) => acc + cur.count, 0)

  return {
    success: true,
    data: {
      total_records: total,
      sources_count: bySource.length,
      by_source: bySource
    }
  }
}

/** Fetch raw pagination metadata from a source endpoint without normalizing items */
async function fetchSourceMetadataRaw(
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
  const result = await callSiteAPI(endpoint)
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

/**
 * Get metadata about a source: pagination info, cache stats, param requirements.
 * If source is "auto" (cast externally), returns compact metadata for all primary sources.
 */
export async function siteGetSourceMetadata(
  source: SiteSourceName | "auto" = "articles_latest"
): Promise<APICallResult> {
  const needsParam: Record<string, string | undefined> = {
    videos_by_category: "category_id",
    shrine_history_by_section: "section_id",
    abbas_history_by_id: "id"
  }

  // auto → return compact summary for primary sources
  if (source === "auto") {
    const primaries: SiteSourceName[] = ["articles_latest", "videos_latest", "lang_words_ar"]
    const summaries = await Promise.all(primaries.map(async s => {
      const meta = await fetchSourceMetadataRaw(s)
      return {
        source: s,
        friendly_name: friendlySourceLabel(s),
        total: meta.total,
        per_page: meta.per_page,
        last_page: meta.last_page,
        has_pagination: EXPANDABLE_SOURCES.includes(s)
      }
    }))
    return { success: true, data: { sources: summaries } }
  }

  const meta = await fetchSourceMetadataRaw(source)
  const cached = await getSourceDocuments(source)
  const cachedCount = cached.success && Array.isArray(cached.data) ? cached.data.length : 0

  return {
    success: true,
    data: {
      source,
      friendly_name: friendlySourceLabel(source),
      total: meta.total,
      current_page: meta.current_page,
      last_page: meta.last_page,
      per_page: meta.per_page,
      has_pagination: EXPANDABLE_SOURCES.includes(source),
      cached_count: cachedCount,
      is_category_index: CATEGORY_INDEX_SOURCES.includes(source),
      required_param: needsParam[source] || null
    }
  }
}

/**
 * Browse a specific page of a paginated source.
 * Supports order="newest" (default, page 1 = newest) and order="oldest" (reverses page direction).
 */
export async function siteBrowseSourcePage(
  source: SiteSourceName,
  page: number = 1,
  perPage: number = 10,
  order: "newest" | "oldest" = "newest"
): Promise<APICallResult> {
  if (!EXPANDABLE_SOURCES.includes(source)) {
    return { success: false, error: `المصدر ${source} لا يدعم التصفح بالصفحات` }
  }

  const safePerPage = Math.min(Math.max(perPage || 10, 1), 20)
  let targetPage = Math.max(1, Math.floor(page))

  // For "oldest" order, derive the actual API page from metadata
  if (order === "oldest") {
    const meta = await fetchSourceMetadataRaw(source)
    // API page 1 = newest, page last_page = oldest
    // user page 1 oldest → API last_page, user page 2 oldest → API last_page-1, etc.
    targetPage = Math.max(1, meta.last_page - (targetPage - 1))
  }

  // Fetch metadata for accurate has_more and page info
  const meta = await fetchSourceMetadataRaw(source)

  const items = targetPage === 1
    ? ((await getSourceDocuments(source)).data || []) as any[]
    : await fetchSourcePage(source, targetPage, {})

  // For oldest order, reverse so oldest items come first
  const ordered = order === "oldest" ? [...items].reverse() : items

  // Compute has_more from metadata when available
  const hasMore = meta.last_page > 1
    ? (order === "oldest" ? targetPage > 1 : targetPage < meta.last_page)
    : false

  return {
    success: true,
    data: {
      items: ordered.slice(0, safePerPage),
      total_in_page: ordered.length,
      total_all: meta.total,
      last_page: meta.last_page,
      page: Math.max(1, Math.floor(page)),
      api_page: targetPage,
      source,
      order,
      has_more: hasMore
    }
  }
}

/** Human-readable source label (internal helper) */
function friendlySourceLabel(source: string): string {
  const map: Record<string, string> = {
    articles_latest: "الأخبار",
    videos_latest: "الفيديوهات",
    videos_categories: "أقسام الفيديو",
    videos_by_category: "فيديوهات حسب القسم",
    shrine_history_sections: "أقسام تاريخ العتبة",
    shrine_history_by_section: "تاريخ العتبة",
    abbas_history_by_id: "تاريخ العباس",
    lang_words_ar: "القاموس اللغوي"
  }
  return map[source] || source
}

/**
 * تنفيذ أداة بناءً على اسمها والمعاملات
 * 
 * هذه الدالة هي نقطة الدخول الرئيسية لتنفيذ أي أداة
 * 
 * @param toolName - اسم الأداة
 * @param args - معاملات الأداة
 */
export async function executeToolByName(
  toolName: AllowedToolName,
  args: Record<string, any>
): Promise<APICallResult> {
  console.log(`[Tool Execution] ${toolName}`, args)

  try {
    switch (toolName) {
      case "search_projects":
        return await siteSearchContent(args.query, args.source || "auto", args.limit, {
          category_id: args.category_id,
          section_id: args.section_id,
          id: args.id
        })

      case "search_content":
        return await siteSearchContent(args.query, args.source || "auto", args.limit, {
          category_id: args.category_id,
          section_id: args.section_id,
          id: args.id
        })

      case "get_project_by_id":
        return await siteGetContentById(args.id, args.source || "auto", {
          category_id: args.category_id,
          section_id: args.section_id,
          id: args.id
        })

      case "get_content_by_id":
        return await siteGetContentById(args.id, args.source || "auto", {
          category_id: args.category_id,
          section_id: args.section_id,
          id: args.id
        })

      case "filter_projects":
        return await siteListSourceCategories(args.source || "auto")

      case "list_source_categories":
        return await siteListSourceCategories(args.source || "auto")

      case "get_latest_projects":
        return await siteGetLatestBySource(args.source || "auto", args.limit, {
          category_id: args.category_id,
          section_id: args.section_id,
          id: args.id
        })

      case "get_latest_by_source":
        return await siteGetLatestBySource(args.source || "auto", args.limit, {
          category_id: args.category_id,
          section_id: args.section_id,
          id: args.id
        })

      case "get_statistics":
        return await siteGetMultiSourceStatistics()

      case "get_source_metadata":
        return await siteGetSourceMetadata(args.source || "auto")

      case "browse_source_page":
        return await siteBrowseSourcePage(
          args.source || "articles_latest",
          args.page,
          args.per_page || args.limit,
          args.order
        )

      default:
        return {
          success: false,
          error: `أداة غير معروفة: ${toolName}`
        }
    }
  } catch (error: any) {
    console.error(`[Tool Execution Error] ${toolName}:`, error)
    return {
      success: false,
      error: error.message || "حدث خطأ أثناء تنفيذ الأداة"
    }
  }
}
