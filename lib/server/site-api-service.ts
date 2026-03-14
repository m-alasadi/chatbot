/**
 * Service Layer للتواصل مع REST API الخاص بالموقع
 * 
 * جميع استدعاءات API تمر عبر هذه الطبقة
 * يتم التحكم بالـ Whitelist والتحقق من الأمان هنا
 */

import { getSiteAPIConfig } from "./site-api-config"
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

        // بناء URL كامل
        let url = `${config.baseUrl}${endpoint}`

        // إضافة query parameters
        if (params && Object.keys(params).length > 0) {
          const searchParams = new URLSearchParams()
          Object.entries(params).forEach(([key, value]) => {
            searchParams.append(key, String(value))
          })
          url += `?${searchParams.toString()}`
        }

        // إعداد Headers
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "application/json"
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

/**
 * جلب جميع المشاريع من API
 * يتم cache النتائج لتجنب استدعاءات متكررة
 */
let projectsCache: any[] | null = null
let projectsCacheTime: number = 0
const CACHE_DURATION = 30 * 60 * 1000 // 30 دقيقة — تقليل استدعاءات API

async function getAllProjects(): Promise<APICallResult> {
  console.log("[getAllProjects] Starting...")
  
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
  const result = await callSiteAPI("/allProjects")
  
  console.log("[getAllProjects] API result:", result.success ? `Success (${result.data?.length} projects)` : `Failed: ${result.error}`)
  
  if (result.success && Array.isArray(result.data)) {
    projectsCache = result.data
    projectsCacheTime = now
    console.log("[getAllProjects] Cached", result.data.length, "projects")
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
        return await siteSearch(args.query, args.section, args.limit)

      case "get_project_by_id":
        return await siteGetProject(args.id)

      case "filter_projects":
        return await siteListCategories(args.include_counts)

      case "get_latest_projects":
        return await siteGetLatest(args.limit, args.section)

      case "get_statistics":
        return await siteGetStatistics()

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
