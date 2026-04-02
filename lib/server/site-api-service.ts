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
  "lang_words_ar"
]

const SOURCE_CACHE_DURATION_MS: Record<SiteSourceName, number> = {
  articles_latest: 15 * 60 * 1000,
  videos_latest: 15 * 60 * 1000,
  videos_categories: 6 * 60 * 60 * 1000,
  videos_by_category: 20 * 60 * 1000,
  shrine_history_sections: 12 * 60 * 60 * 1000,
  shrine_history_by_section: 60 * 60 * 1000,
  abbas_history_by_id: 60 * 60 * 1000,
  lang_words_ar: 24 * 60 * 60 * 1000
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

// ============================================================
// A. Arabic normalization utilities
// ============================================================

/** Remove Arabic diacritics / tashkeel */
const DIACRITICS_RE = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g
/** Tatweel / kashida */
const TATWEEL_RE = /\u0640/g

function normalizeArabic(text: string): string {
  if (!text) return ""
  return text
    .toLowerCase()
    .replace(DIACRITICS_RE, "")
    .replace(TATWEEL_RE, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenizeArabicQuery(query: string): string[] {
  const norm = normalizeArabic(query)
  return norm.split(/\s+/).filter(w => w.length > 1)
}

// ============================================================
// B. Weighted source routing (replaces detectQueryIntentSources)
// ============================================================

interface SourceRouteHint {
  keywords: string[]
  weight: number
}

const SOURCE_HINTS: Record<SiteSourceName, SourceRouteHint[]> = {
  articles_latest: [
    { keywords: ["خبر", "اخبار", "مقال", "مقالات", "تقرير", "بيان", "اعلان", "نشاط", "فعاليه", "مشروع", "افتتاح", "زياره", "موكب", "خطبه", "خطب", "جمعه", "صلاه"], weight: 6 },
  ],
  videos_latest: [
    { keywords: ["فيديو", "فديو", "مرئي", "يوتيوب", "مقطع", "بث", "مباشر", "حلقه", "لقاء"], weight: 8 },
  ],
  videos_categories: [
    { keywords: ["اقسام الفيديو", "تصنيفات الفيديو", "فئات الفيديو"], weight: 8 },
  ],
  videos_by_category: [
    // parametric — هل المعامل متوفر يُحسم في مكان آخر
    { keywords: ["فيديو", "فديو", "مرئي"], weight: 4 },
  ],
  shrine_history_sections: [
    { keywords: ["اقسام التاريخ", "اقسام تاريخ", "فهرس التاريخ"], weight: 8 },
    { keywords: ["تاريخ", "سيره", "تراث"], weight: 3 },
  ],
  shrine_history_by_section: [
    { keywords: ["تاريخ العتبه", "تاريخ الحرم", "تاريخ المقام", "عمارات", "توسعه", "ترميم"], weight: 8 },
    { keywords: ["تاريخ", "سيره", "تراث"], weight: 5 },
  ],
  abbas_history_by_id: [
    { keywords: ["العباس", "ابو الفضل", "ابا الفضل", "قمر بني هاشم", "سيره العباس"], weight: 9 },
    { keywords: ["تاريخ", "سيره"], weight: 2 },
  ],
  lang_words_ar: [
    { keywords: ["ترجمه", "لغه", "كلمه", "مصطلح", "معني", "قاموس", "تفسير كلمه"], weight: 9 },
  ],
}

/** Sources that need a parameter to be useful */
const PARAMETRIC_REQUIREMENTS: Partial<Record<SiteSourceName, keyof SourceFetchParams>> = {
  videos_by_category: "category_id",
  shrine_history_by_section: "section_id",
  abbas_history_by_id: "id",
}

function rankCandidateSources(query: string, params?: SourceFetchParams): SiteSourceName[] {
  const q = normalizeArabic(query)
  const tokens = tokenizeArabicQuery(query)

  const scores: { source: SiteSourceName; score: number }[] = ALL_SOURCES.map(source => {
    // Skip parametric sources when required param is missing
    const requiredParam = PARAMETRIC_REQUIREMENTS[source]
    if (requiredParam && (!params || !params[requiredParam])) {
      // shrine_history_by_section gets a small base score (API returns default section)
      if (source === "shrine_history_by_section") {
        // allow with reduced weight — the endpoint has a default
      } else {
        return { source, score: 0 }
      }
    }

    let score = 0
    const hints = SOURCE_HINTS[source] || []
    for (const hint of hints) {
      for (const kw of hint.keywords) {
        const kwNorm = normalizeArabic(kw)
        if (q.includes(kwNorm)) {
          score += hint.weight
        } else {
          // token-level match
          for (const t of tokens) {
            if (kwNorm.includes(t) || t.includes(kwNorm)) {
              score += Math.floor(hint.weight * 0.5)
            }
          }
        }
      }
    }

    // Baseline: articles_latest always gets a small base score (catch-all)
    if (source === "articles_latest") score = Math.max(score, 2)

    return { source, score }
  })

  return scores
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.source)
}

// Keep backward compat — old name redirects to new
function detectQueryIntentSources(query: string): SiteSourceName[] {
  return rankCandidateSources(query)
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
      const catId = params.category_id
      if (!catId) throw new Error("videos_by_category requires category_id")
      return fillEndpointTemplate(endpoint, { catId })
    }
    case "shrine_history_by_section": {
      // section_id defaults to "1" — the API accepts it and returns the first section
      const secId = params.section_id || "1"
      return fillEndpointTemplate(endpoint, { secId })
    }
    case "abbas_history_by_id": {
      const id = params.id
      if (!id) throw new Error("abbas_history_by_id requires id")
      return fillEndpointTemplate(endpoint, { id })
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

  if (source === "videos_latest" || source === "videos_by_category") {
    return arr.map((item: any) => {
      const section = pickText(item?.cat_title, item?.category, "فيديو")
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
      id: String(item?.id || item?.sec_id || ""),
      name: pickText(item?.title, item?.name, item?.sec_title, "قسم تاريخ"),
      description: pickText(item?.description, "قسم من تاريخ العتبة"),
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

  const endpoint = buildSourceEndpoint(source, params)
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
        source_type: "articles_api",
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
  const queryWords = safeQuery
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 1) // تجاهل الأحرف المفردة
  
  const lowerQuery = safeQuery.toLowerCase()

  /**
   * استخراج كل النصوص القابلة للبحث من مشروع
   * يعيد مصفوفة من النصوص مع أوزان (weight) لترتيب النتائج
   */
  function getSearchableTexts(project: any): { text: string; weight: number }[] {
    const texts: { text: string; weight: number }[] = []

    // 1. اسم المشروع — وزن عالي جداً
    if (project.name) {
      texts.push({ text: project.name.toLowerCase(), weight: 10 })
    }

    // 2. الوصف — وزن عالي
    if (project.description) {
      texts.push({ text: project.description.toLowerCase(), weight: 5 })
    }

    // 3. العنوان — وزن عالي
    if (project.address) {
      texts.push({ text: project.address.toLowerCase(), weight: 5 })
    }

    // 4. أسماء الأقسام — وزن متوسط
    if (Array.isArray(project.sections)) {
      for (const s of project.sections) {
        if (s.name) texts.push({ text: s.name.toLowerCase(), weight: 3 })
      }
    }

    // 5. الخصائص properties (المكان، المواصفات، الجهة المنفذة، تاريخ الافتتاح...) — وزن متوسط-عالي
    if (Array.isArray(project.properties)) {
      for (const prop of project.properties) {
        // اسم الخاصية
        if (prop.name) texts.push({ text: prop.name.toLowerCase(), weight: 3 })
        // قيمة الخاصية (قد تكون في pivot.value أو value)
        const val = prop.pivot?.value || prop.value
        if (val && typeof val === "string") {
          texts.push({ text: val.toLowerCase(), weight: 4 })
        }
      }
    }

    // 6. العلامات kftags — وزن متوسط
    if (Array.isArray(project.kftags)) {
      for (const tag of project.kftags) {
        if (tag.title) texts.push({ text: tag.title.toLowerCase(), weight: 3 })
        if (tag.name) texts.push({ text: tag.name.toLowerCase(), weight: 3 })
      }
    }

    // 7. الأخبار kfnews — وزن منخفض
    if (Array.isArray(project.kfnews)) {
      for (const news of project.kfnews) {
        if (news.title) texts.push({ text: news.title.toLowerCase(), weight: 2 })
        if (news.description) texts.push({ text: news.description.toLowerCase(), weight: 1 })
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
    const lowerSection = section.toLowerCase()
    scored = scored.filter(({ project }) =>
      project.sections?.some((s: any) =>
        s.name?.toLowerCase().includes(lowerSection)
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

// ============================================================
// C. Improved unified scoring with Arabic normalization
// ============================================================

interface ScoredField {
  text: string
  weight: number
}

function getUnifiedSearchableFields(item: any): ScoredField[] {
  const fields: ScoredField[] = []

  const push = (val: any, weight: number) => {
    if (typeof val === "string" && val.trim().length > 0) {
      fields.push({ text: normalizeArabic(val), weight })
    }
  }

  // name/title — highest weight
  push(item?.name, 12)

  // description — high weight
  push(item?.description, 6)

  // address
  push(item?.address, 5)

  // sections
  if (Array.isArray(item?.sections)) {
    for (const s of item.sections) {
      push(s?.name, 3)
    }
  }

  // properties (name + value)
  if (Array.isArray(item?.properties)) {
    for (const prop of item.properties) {
      push(prop?.name, 3)
      const val = prop?.pivot?.value || prop?.value
      push(val, 4)
    }
  }

  // tags
  if (Array.isArray(item?.kftags)) {
    for (const tag of item.kftags) {
      push(tag?.title, 3)
      push(tag?.name, 3)
    }
  }

  // kfnews
  if (Array.isArray(item?.kfnews)) {
    for (const news of item.kfnews) {
      push(news?.title, 2)
      push(news?.description, 1)
    }
  }

  // source_raw useful text (low weight secondary fields)
  if (item?.source_raw) {
    push(item.source_raw?.caption, 2)
    push(item.source_raw?.summary, 2)
    push(item.source_raw?.cat_title, 2)
  }

  return fields
}

function scoreUnifiedItem(item: any, query: string): number {
  const normQuery = normalizeArabic(query)
  if (!normQuery) return 1

  const tokens = tokenizeArabicQuery(query)
  const fields = getUnifiedSearchableFields(item)

  let score = 0
  const totalTokens = tokens.length

  for (const { text, weight } of fields) {
    if (!text) continue

    // Exact full-query match — highest boost
    if (text.includes(normQuery)) {
      score += weight * 4
    }

    // Token-level matching
    let matchedTokens = 0
    for (const token of tokens) {
      if (text.includes(token)) {
        matchedTokens++
        score += weight
      }
    }

    // All-tokens-present bonus
    if (totalTokens >= 2 && matchedTokens === totalTokens) {
      score += weight * 2
    }
  }

  // Penalize very short generic names that match weakly
  const nameLen = (item?.name || "").length
  if (nameLen < 5 && score > 0 && score < 10) {
    score = Math.floor(score * 0.5)
  }

  return score
}

// ============================================================
// D. Evidence snippet builder
// ============================================================

function buildEvidenceSnippet(item: any, query: string): string {
  const normQuery = normalizeArabic(query)
  const tokens = tokenizeArabicQuery(query)
  if (!normQuery || tokens.length === 0) {
    return truncateSnippet(item?.description || item?.name || "", 200)
  }

  // Collect candidate texts ordered by relevance
  const candidates: { text: string; original: string; weight: number }[] = []
  const addCandidate = (original: string | undefined, weight: number) => {
    if (typeof original === "string" && original.trim().length > 0) {
      candidates.push({ text: normalizeArabic(original), original, weight })
    }
  }

  addCandidate(item?.name, 10)
  addCandidate(item?.description, 7)
  addCandidate(item?.address, 5)
  if (item?.source_raw?.text) addCandidate(item.source_raw.text, 6)
  if (item?.source_raw?.caption) addCandidate(item.source_raw.caption, 4)
  if (item?.source_raw?.summary) addCandidate(item.source_raw.summary, 4)
  if (Array.isArray(item?.properties)) {
    for (const prop of item.properties) {
      const val = prop?.pivot?.value || prop?.value
      if (typeof val === "string") addCandidate(val, 3)
    }
  }

  // Find best match: prefer field with full-query or most tokens
  let bestOriginal = ""
  let bestScore = -1
  let bestMatchPos = -1

  for (const { text, original, weight } of candidates) {
    let fieldScore = 0
    let matchPos = -1

    const fullIdx = text.indexOf(normQuery)
    if (fullIdx >= 0) {
      fieldScore = weight * 4
      matchPos = fullIdx
    } else {
      let matched = 0
      for (const t of tokens) {
        const idx = text.indexOf(t)
        if (idx >= 0) {
          matched++
          if (matchPos < 0) matchPos = idx
        }
      }
      fieldScore = matched * weight
    }

    if (fieldScore > bestScore) {
      bestScore = fieldScore
      bestOriginal = original
      bestMatchPos = matchPos
    }
  }

  if (!bestOriginal) {
    return truncateSnippet(item?.description || item?.name || "", 200)
  }

  // Extract window around match
  return extractWindow(bestOriginal, bestMatchPos, 250)
}

function truncateSnippet(text: string, max: number): string {
  if (!text) return ""
  const clean = text.replace(/\s+/g, " ").trim()
  if (clean.length <= max) return clean
  return clean.substring(0, max) + "…"
}

function extractWindow(text: string, matchPos: number, windowSize: number): string {
  const clean = text.replace(/\s+/g, " ").trim()
  if (clean.length <= windowSize) return clean

  if (matchPos < 0) matchPos = 0
  // Map matchPos proportionally if text was cleaned
  const ratio = clean.length / Math.max(text.length, 1)
  const approxPos = Math.floor(matchPos * ratio)

  const half = Math.floor(windowSize / 2)
  let start = Math.max(0, approxPos - half)
  let end = Math.min(clean.length, start + windowSize)
  if (end - start < windowSize) start = Math.max(0, end - windowSize)

  let snippet = clean.substring(start, end)
  if (start > 0) snippet = "…" + snippet
  if (end < clean.length) snippet = snippet + "…"
  return snippet
}

export async function siteSearchContent(
  query: string,
  source: SiteSourceName | "auto" = "auto",
  limit: number = 5,
  params: SourceFetchParams = {}
): Promise<APICallResult> {
  const safeLimit = Math.min(Math.max(limit || 5, 1), 50)
  const candidates = source === "auto"
    ? rankCandidateSources(query, params)
    : [source]

  // Limit concurrent fetches to top-ranked sources (max 4)
  const fetchCandidates = candidates.slice(0, 4)

  // Skip parametric sources that would throw due to missing params
  const safeCandidates = fetchCandidates.filter(s => {
    const req = PARAMETRIC_REQUIREMENTS[s]
    if (!req) return true
    if (s === "shrine_history_by_section") return true // has safe default
    return params && params[req]
  })

  const fetched = await Promise.all(
    safeCandidates.map(async s => ({ source: s, result: await getSourceDocuments(s, params) }))
  )

  let merged: any[] = []
  for (const entry of fetched) {
    if (entry.result.success && Array.isArray(entry.result.data)) {
      merged.push(...entry.result.data)
    }
  }

  // Broader fallback if no results from ranked sources
  if (merged.length === 0 && source === "auto") {
    const tried = new Set(safeCandidates)
    const fallbackSources = ALL_SOURCES.filter(s => {
      if (tried.has(s)) return false
      const req = PARAMETRIC_REQUIREMENTS[s]
      if (req && s !== "shrine_history_by_section" && (!params || !params[req])) return false
      return true
    }).slice(0, 4)

    const fallback = await Promise.all(
      fallbackSources.map(async s => ({ source: s, result: await getSourceDocuments(s, params) }))
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

  // Score, filter, sort
  let scoredResults = Array.from(deduped.values())
    .map(item => ({ item, score: scoreUnifiedItem(item, query) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, safeLimit)

  // ✅ Expanded pagination search if not enough results
  if (scoredResults.length < safeLimit && query.trim().length > 2) {
    const additionalItems = await expandedPaginationSearch(query, safeCandidates, safeLimit - scoredResults.length)

    if (additionalItems.length > 0) {
      const allItems = [...scoredResults.map(x => x.item), ...additionalItems]
      const finalDeduped = new Map<string, any>()
      for (const item of allItems) {
        const key = `${item?.source_type || "source"}:${item?.id || item?.name || Math.random()}`
        if (!finalDeduped.has(key)) finalDeduped.set(key, item)
      }
      scoredResults = Array.from(finalDeduped.values())
        .map(item => ({ item, score: scoreUnifiedItem(item, query) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, safeLimit)
    }
  }

  const scored = scoredResults.map(x => x.item)

  // Attach evidence snippet to each result
  for (const item of scored) {
    item._snippet = buildEvidenceSnippet(item, query)
  }

  // Quality hint
  const normQuery = normalizeArabic(query)
  const queryTokens = tokenizeArabicQuery(query)
  const hasStrongMatch = scored.some(item => {
    const normName = normalizeArabic(item?.name || "")
    return normName.includes(normQuery) ||
      (queryTokens.length >= 2 && queryTokens.every(t => normName.includes(t)))
  })

  return {
    success: true,
    data: {
      results: scored,
      total: scored.length,
      query,
      source_used: source,
      candidate_sources: safeCandidates,
      ...(!hasStrongMatch && scored.length < safeLimit && {
        hint: "البحث شمل أحدث المحتوى فقط. إذا كان السؤال عن محتوى قديم أو محدد، جرّب browse_source_page مع order=oldest للوصول لأقدم المحتوى، أو get_content_by_id إذا تعرف رقم المعرّف."
      })
    }
  }
}

/** Expanded pagination search helper for siteSearchContent */
async function expandedPaginationSearch(
  query: string,
  candidates: SiteSourceName[],
  needed: number
): Promise<any[]> {
  const paginatedSources: Partial<Record<SiteSourceName, string>> = {
    articles_latest: "/alkafeel_back_test/api/v1/articles/GetLast/50/all?page=",
    videos_latest: "/alkafeel_back_test/api/v1/videos/latest/50?page="
  }

  const additionalItems: any[] = []

  for (const s of candidates) {
    const baseEndpoint = paginatedSources[s]
    if (!baseEndpoint) continue

    // Phase 1: near pages (2-6)
    for (const page of [2, 3, 4, 5, 6]) {
      if (additionalItems.length >= needed) break
      const result = await callSiteAPI(`${baseEndpoint}${page}`)
      if (!result.success || !result.data?.data) continue

      const normalized = normalizeSourceDataset(s, result.data)
      const pageScored = normalized
        .map(item => ({ item, score: scoreUnifiedItem(item, query) }))
        .filter(x => x.score > 0)

      if (pageScored.length > 0) {
        additionalItems.push(...pageScored.map(x => x.item))
      }
    }

    // Phase 2: sample older pages
    if (additionalItems.length < needed) {
      const metaEndpoint = s === "articles_latest"
        ? "/alkafeel_back_test/api/v1/articles/GetLast/1/all?page=1"
        : "/alkafeel_back_test/api/v1/videos/latest/1?page=1"
      const meta = await callSiteAPI(metaEndpoint)
      if (meta.success && meta.data?.last_page) {
        const lastPage = Math.ceil(meta.data.total / 50)
        const samplePages = [
          Math.floor(lastPage * 0.25),
          Math.floor(lastPage * 0.5),
          Math.floor(lastPage * 0.75),
          lastPage - 1,
          lastPage
        ].filter(p => p > 6 && p <= lastPage)

        for (const page of samplePages) {
          if (additionalItems.length >= needed) break
          const result = await callSiteAPI(`${baseEndpoint}${page}`)
          if (!result.success || !result.data?.data) continue

          const normalized = normalizeSourceDataset(s, result.data)
          const pageScored = normalized
            .map(item => ({ item, score: scoreUnifiedItem(item, query) }))
            .filter(x => x.score > 0)

          if (pageScored.length > 0) {
            additionalItems.push(...pageScored.map(x => x.item))
          }
        }
      }
    }
  }

  return additionalItems
}

export async function siteGetContentById(
  id: string,
  source: SiteSourceName | "auto" = "auto",
  params: SourceFetchParams = {}
): Promise<APICallResult> {
  const candidates = source === "auto" ? ALL_SOURCES : [source]

  // الخطوة 1: البحث في الكاش المحلي أولاً
  for (const s of candidates) {
    const result = await getSourceDocuments(s, { ...params, id })
    if (!result.success || !Array.isArray(result.data)) continue
    const hit = result.data.find((item: any) => String(item?.id) === String(id))
    if (hit) {
      return {
        success: true,
        data: hit
      }
    }
  }

  // الخطوة 2: للمصادر المُصفحنة — بحث ذكي بالصفحات
  const numericId = parseInt(id)
  const paginatedSources: Partial<Record<SiteSourceName, string>> = {
    articles_latest: "/alkafeel_back_test/api/v1/articles/GetLast/50/all?page=",
    videos_latest: "/alkafeel_back_test/api/v1/videos/latest/50?page="
  }

  for (const s of candidates) {
    const baseEndpoint = paginatedSources[s]
    if (!baseEndpoint) continue

    // جلب metadata لمعرفة total
    const metaEndpoint = s === "articles_latest"
      ? "/alkafeel_back_test/api/v1/articles/GetLast/1/all?page=1"
      : "/alkafeel_back_test/api/v1/videos/latest/1?page=1"
    const meta = await callSiteAPI(metaEndpoint)
    if (!meta.success || !meta.data?.total) continue

    const total = meta.data.total
    const perPage = 50
    const lastPage = Math.ceil(total / perPage)

    if (!Number.isFinite(numericId) || numericId < 1) continue

    // التقدير الأولي
    const estimatedPosition = total - numericId + 1
    let targetPage = Math.max(1, Math.min(lastPage, Math.ceil(estimatedPosition / perPage)))

    // بحث ذكي: حتى 5 محاولات مع تصحيح بناءً على IDs الصفحة
    const triedPages = new Set<number>()
    for (let attempt = 0; attempt < 5; attempt++) {
      if (triedPages.has(targetPage)) break
      triedPages.add(targetPage)

      const result = await callSiteAPI(`${baseEndpoint}${targetPage}`)
      if (!result.success || !result.data?.data) break

      const items = Array.isArray(result.data.data) ? result.data.data : []
      if (items.length === 0) break

      // البحث في الصفحة الحالية
      const hit = items.find((item: any) => String(item?.id) === String(id))
      if (hit) {
        const normalized = normalizeSourceDataset(s, { data: [hit] })
        return {
          success: true,
          data: normalized[0] || hit
        }
      }

      // تصحيح ذكي: نقارن ID المطلوب مع IDs الصفحة لتقدير الاتجاه
      const pageIds = items.map((item: any) => parseInt(item?.id)).filter(Number.isFinite)
      if (pageIds.length === 0) break

      const maxId = Math.max(...pageIds)
      const minId = Math.min(...pageIds)

      if (numericId > maxId) {
        // ID أكبر = مقال أحدث = صفحة أقل
        const diff = Math.max(1, Math.ceil((numericId - maxId) / perPage))
        targetPage = Math.max(1, targetPage - diff)
      } else if (numericId < minId) {
        // ID أصغر = مقال أقدم = صفحة أكبر
        const diff = Math.max(1, Math.ceil((minId - numericId) / perPage))
        targetPage = Math.min(lastPage, targetPage + diff)
      } else {
        // ID ضمن المدى لكن غير موجود (فجوة) — نجرب الصفحات المجاورة
        for (const offset of [1, -1]) {
          const nearPage = targetPage + offset
          if (nearPage < 1 || nearPage > lastPage || triedPages.has(nearPage)) continue
          triedPages.add(nearPage)
          const r2 = await callSiteAPI(`${baseEndpoint}${nearPage}`)
          if (!r2.success || !r2.data?.data) continue
          const nearHit = r2.data.data.find((item: any) => String(item?.id) === String(id))
          if (nearHit) {
            const normalized = normalizeSourceDataset(s, { data: [nearHit] })
            return { success: true, data: normalized[0] || nearHit }
          }
        }
        break
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
  const safeLimit = Math.min(Math.max(limit || 5, 1), 50)
  const candidates = source === "auto"
    ? ["articles_latest", "videos_latest", "shrine_history_by_section"] as SiteSourceName[]
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
  // جلب الإحصائيات الحقيقية من pagination metadata بدل عدّ العناصر المحلية
  const paginatedSources: { source: SiteSourceName; endpoint: string }[] = [
    { source: "articles_latest", endpoint: "/alkafeel_back_test/api/v1/articles/GetLast/1/all?page=1" },
    { source: "videos_latest", endpoint: "/alkafeel_back_test/api/v1/videos/latest/1?page=1" }
  ]

  const paginationResults = await Promise.all(
    paginatedSources.map(async ({ source, endpoint }) => {
      const result = await callSiteAPI(endpoint)
      if (result.success && result.data && typeof result.data.total === "number") {
        return {
          source,
          total: result.data.total,
          last_page: result.data.last_page || 1,
          per_page: parseInt(result.data.per_page) || 0
        }
      }
      // fallback: عدّ العناصر المحلية
      const docs = await getSourceDocuments(source)
      return {
        source,
        total: docs.success && Array.isArray(docs.data) ? docs.data.length : 0,
        last_page: 1,
        per_page: 0
      }
    })
  )

  // المصادر غير المُصفحنة — نعدّها محلياً
  const nonPaginatedSources: SiteSourceName[] = ["shrine_history_by_section", "lang_words_ar"]
  const nonPaginated = await Promise.all(nonPaginatedSources.map(async s => {
    const docs = await getSourceDocuments(s)
    return {
      source: s,
      total: docs.success && Array.isArray(docs.data) ? docs.data.length : 0,
      last_page: 1,
      per_page: 0
    }
  }))

  const bySource = [...paginationResults, ...nonPaginated]
  const total = bySource.reduce((acc, cur) => acc + cur.total, 0)

  return {
    success: true,
    data: {
      total_records: total,
      sources_count: bySource.length,
      by_source: bySource
    }
  }
}

/**
 * جلب metadata المصدر (عدد كلي، صفحات، إلخ) بدون جلب كل البيانات
 */
export async function siteGetSourceMetadata(
  source: SiteSourceName | "auto" = "articles_latest"
): Promise<APICallResult> {
  const config = getSiteAPIConfig()

  // نبني endpoint بـ per_page=1 فقط لجلب metadata سريعاً
  const metadataEndpoints: Partial<Record<SiteSourceName, string>> = {
    articles_latest: "/alkafeel_back_test/api/v1/articles/GetLast/1/all?page=1",
    videos_latest: "/alkafeel_back_test/api/v1/videos/latest/1?page=1"
  }

  const targets = source === "auto"
    ? ["articles_latest", "videos_latest"] as SiteSourceName[]
    : [source]

  const results = await Promise.all(
    targets.map(async s => {
      const endpoint = metadataEndpoints[s]
      if (endpoint) {
        const result = await callSiteAPI(endpoint)
        if (result.success && result.data) {
          return {
            source: s,
            total: result.data.total ?? 0,
            current_page: result.data.current_page ?? 1,
            last_page: result.data.last_page ?? 1,
            per_page: parseInt(result.data.per_page) || 0,
            has_pagination: true
          }
        }
      }
      // fallback
      const docs = await getSourceDocuments(s)
      return {
        source: s,
        total: docs.success && Array.isArray(docs.data) ? docs.data.length : 0,
        current_page: 1,
        last_page: 1,
        per_page: 0,
        has_pagination: false
      }
    })
  )

  return {
    success: true,
    data: results.length === 1 ? results[0] : { sources: results }
  }
}

/**
 * تصفح صفحة محددة من مصدر (للوصول لأقدم/أحدث الأخبار)
 */
export async function siteBrowseSourcePage(
  source: SiteSourceName = "articles_latest",
  page: number = 1,
  perPage: number = 10,
  order: "newest" | "oldest" = "newest"
): Promise<APICallResult> {
  const safePerPage = Math.min(Math.max(perPage, 1), 50)
  const safePage = Math.max(page, 1)

  const pageEndpoints: Partial<Record<SiteSourceName, string>> = {
    articles_latest: `/alkafeel_back_test/api/v1/articles/GetLast/${safePerPage}/all?page=`,
    videos_latest: `/alkafeel_back_test/api/v1/videos/latest/${safePerPage}?page=`
  }

  const baseEndpoint = pageEndpoints[source]
  if (!baseEndpoint) {
    return {
      success: false,
      error: `المصدر ${source} لا يدعم التصفح بالصفحات`
    }
  }

  // إذا طلب "أقدم" — نحتاج أولاً معرفة آخر صفحة
  let targetPage = safePage
  if (order === "oldest") {
    const metaResult = await callSiteAPI(`${baseEndpoint}1`)
    if (metaResult.success && metaResult.data?.last_page) {
      targetPage = metaResult.data.last_page - (safePage - 1)
      if (targetPage < 1) targetPage = 1
    }
  }

  const endpoint = `${baseEndpoint}${targetPage}`
  const result = await callSiteAPI(endpoint)
  if (!result.success) return result

  const normalized = normalizeSourceDataset(source, result.data)

  // عكس الترتيب إذا طُلب الأقدم لعرض من الأقدم للأحدث
  if (order === "oldest") {
    normalized.reverse()
  }

  return {
    success: true,
    data: {
      items: normalized,
      count: normalized.length,
      page: targetPage,
      total: result.data?.total ?? 0,
      last_page: result.data?.last_page ?? 1,
      source,
      order
    }
  }
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
          args.page || 1,
          args.per_page || 10,
          args.order || "newest"
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
