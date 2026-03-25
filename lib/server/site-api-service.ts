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

function detectQueryIntentSources(query: string): SiteSourceName[] {
  const q = (query || "").toLowerCase()

  const videoHints = ["فيديو", "فديو", "مرئي", "يوتيوب", "مقطع"]
  if (videoHints.some(k => q.includes(k))) {
    return ["videos_latest", "videos_categories", "videos_by_category", "articles_latest"]
  }

  const historyHints = ["تاريخ", "سيرة", "العباس", "العتبة", "أبو الفضل"]
  if (historyHints.some(k => q.includes(k))) {
    return [
      "shrine_history_by_section",
      "abbas_history_by_id",
      "shrine_history_sections",
      "articles_latest"
    ]
  }

  const langHints = ["ترجمة", "لغة", "كلمة", "مصطلح", "معنى"]
  if (langHints.some(k => q.includes(k))) {
    return ["lang_words_ar", "articles_latest", "videos_latest"]
  }

  return ["articles_latest", "videos_latest", "shrine_history_by_section", "lang_words_ar"]
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
      const catId = params.category_id || "1a2f5"
      return fillEndpointTemplate(endpoint, { catId })
    }
    case "shrine_history_by_section": {
      const secId = params.section_id || "1"
      return fillEndpointTemplate(endpoint, { secId })
    }
    case "abbas_history_by_id": {
      const id = params.id || "9"
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

function scoreUnifiedItem(item: any, query: string): number {
  const q = (query || "").trim().toLowerCase()
  if (!q) return 1

  const words = q.split(/\s+/).filter(Boolean)
  const fields = [
    String(item?.name || "").toLowerCase(),
    String(item?.description || "").toLowerCase(),
    String(item?.source_type || "").toLowerCase(),
    ...(Array.isArray(item?.sections)
      ? item.sections.map((s: any) => String(s?.name || "").toLowerCase())
      : [])
  ]

  let score = 0
  for (const f of fields) {
    if (!f) continue
    if (f.includes(q)) score += 10
    for (const w of words) {
      if (w.length > 1 && f.includes(w)) score += 3
    }
  }
  return score
}

export async function siteSearchContent(
  query: string,
  source: SiteSourceName | "auto" = "auto",
  limit: number = 5,
  params: SourceFetchParams = {}
): Promise<APICallResult> {
  const safeLimit = Math.min(Math.max(limit || 5, 1), 20)
  const candidates = source === "auto"
    ? detectQueryIntentSources(query).slice(0, 3)
    : [source]

  const fetched = await Promise.all(
    candidates.map(async s => ({ source: s, result: await getSourceDocuments(s, params) }))
  )

  let merged: any[] = []
  for (const entry of fetched) {
    if (entry.result.success && Array.isArray(entry.result.data)) {
      merged.push(...entry.result.data)
    }
  }

  // fallback موسع في حال لم نجد نتائج
  if (merged.length === 0 && source === "auto") {
    const fallback = await Promise.all(
      ALL_SOURCES.slice(0, 5).map(async s => ({ source: s, result: await getSourceDocuments(s, params) }))
    )
    for (const entry of fallback) {
      if (entry.result.success && Array.isArray(entry.result.data)) {
        merged.push(...entry.result.data)
      }
    }
  }

  const deduped = new Map<string, any>()
  for (const item of merged) {
    const key = `${item?.source_type || "source"}:${item?.id || item?.name || Math.random()}`
    if (!deduped.has(key)) deduped.set(key, item)
  }

  const scored = Array.from(deduped.values())
    .map(item => ({ item, score: scoreUnifiedItem(item, query) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, safeLimit)
    .map(x => x.item)

  return {
    success: true,
    data: {
      results: scored,
      total: scored.length,
      query,
      source_used: source,
      candidate_sources: candidates
    }
  }
}

export async function siteGetContentById(
  id: string,
  source: SiteSourceName | "auto" = "auto",
  params: SourceFetchParams = {}
): Promise<APICallResult> {
  const candidates = source === "auto" ? ALL_SOURCES : [source]

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
  const targets: SiteSourceName[] = ["articles_latest", "videos_latest", "shrine_history_by_section", "lang_words_ar"]
  const stats = await Promise.all(targets.map(s => getSourceDocuments(s)))

  const bySource = targets.map((s, i) => ({
    source: s,
    count: stats[i].success && Array.isArray(stats[i].data) ? stats[i].data.length : 0
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
