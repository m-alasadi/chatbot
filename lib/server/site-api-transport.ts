import { getSiteAPIConfig } from "./site-api-config"
import { sanitizeAPIResponse } from "./data-sanitizer"
import { recordSourceFetchMetrics } from "./observability/runtime-metrics"
import { debugLog } from "./debug-log"

/**
 * إعدادات Timeout و Retry
 */
const API_TIMEOUT_MS = 30000 // 30 ثانية (API بطيء بسبب حجم البيانات)
const MAX_RETRIES = 1 // محاولة واحدة فقط (البيانات كبيرة)
const RETRY_DELAY_MS = 1000 // التأخير بين المحاولات

/**
 * قائمة hosts مسموح بها عند تمرير endpoint مطلق (defense-in-depth ضد SSRF).
 * تشمل origin الـ baseUrl المضبوط في البيئة، والدومينات الرسمية لـ alkafeel.
 * تدعم توسيعة عبر SITE_API_ALLOWED_HOSTS (فاصلة بينها).
 */
function getAllowedAbsoluteHosts(): Set<string> {
  const hosts = new Set<string>()
  try {
    const cfg = getSiteAPIConfig()
    hosts.add(new URL(cfg.baseUrl).host.toLowerCase())
    hosts.add(new URL(cfg.allProjectsEndpoint).host.toLowerCase())
  } catch {
    /* config not ready — fall back to defaults below */
  }
  // دومينات رسمية معروفة
  hosts.add("alkafeel.net")
  hosts.add("projects.alkafeel.net")
  hosts.add("www.alkafeel.net")
  // توسيع عبر متغير بيئة للأراضي الإضافية
  const extra = String(process.env.SITE_API_ALLOWED_HOSTS || "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  for (const h of extra) hosts.add(h)
  return hosts
}

/**
 * رفض absolute URLs غير المسموح بها (loopback / RFC1918 / metadata) مع فحص الـ host.
 */
function assertSafeAbsoluteUrl(rawUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error("عنوان URL غير صالح")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("بروتوكول غير مسموح")
  }
  const host = parsed.hostname.toLowerCase()
  // رفض loopback / link-local / metadata
  const blocked = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "169.254.169.254", // cloud metadata
    "metadata.google.internal",
  ]
  if (blocked.includes(host)) {
    throw new Error("host محظور")
  }
  // رفض IPv4 private ranges
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    if (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    ) {
      throw new Error("عنوان داخلي محظور")
    }
  }
  const allowed = getAllowedAbsoluteHosts()
  if (allowed.size > 0 && !allowed.has(host)) {
    throw new Error(`host غير مسموح به: ${host}`)
  }
}

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
export interface APIRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE"
  body?: Record<string, any>
  params?: Record<string, string | number | boolean>
  timeout?: number // Timeout مخصص
  retries?: number // عدد محاولات مخصص
  source?: string // وسم المصدر لأغراض التتبع وضبط الأداء
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
  delayMs: number = RETRY_DELAY_MS,
  contextLabel: string = "unknown"
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
        debugLog(
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
export async function callSiteAPI(
  endpoint: string,
  options: APIRequestOptions = {}
): Promise<APICallResult> {
  const {
    method = "GET",
    body,
    params,
    timeout = API_TIMEOUT_MS,
    retries = MAX_RETRIES,
    source
  } = options
  const requestStartedAt = Date.now()
  let attemptsExecuted = 0
  let timeoutDetected = false

  // تغليف العملية في retry logic
  return await retryOperation(
    async () => {
      attemptsExecuted++
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
          assertSafeAbsoluteUrl(endpoint)
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
          "Accept-Language": config.acceptLanguage,
          "User-Agent": "Mozilla/5.0",
          "X-Requested-With": "XMLHttpRequest"
        }

        const siteOrigin = new URL(normalizedBase).origin
        headers["Origin"] = siteOrigin
        headers["Referer"] = `${siteOrigin}/history?lang=ar`

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

        // ✅ تنظيف البيانات الحساسة
        data = sanitizeAPIResponse(data)

        return {
          success: true,
          data,
          statusCode: response.status
        }
      } catch (error: any) {
        console.error("[Site API Error]:", error.message)
        if (
          error.message?.includes("مهلة") ||
          error.message?.toLowerCase?.().includes("timeout") ||
          error.message?.includes("AbortError")
        ) {
          timeoutDetected = true
        }

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
    RETRY_DELAY_MS,
    source || endpoint
  ).then((result) => {
    const durationMs = Date.now() - requestStartedAt
    const slowThresholdMs = Number(process.env.SITE_API_SLOW_THRESHOLD_MS || 3500)
    recordSourceFetchMetrics({
      source: source || "unknown",
      endpoint,
      durationMs,
      success: Boolean(result.success),
      retryCount: Math.max(0, attemptsExecuted - 1),
      timedOut: timeoutDetected
    })
    if (durationMs >= slowThresholdMs) {
      debugLog(
        `[SiteAPI SlowPath] source=${source || "unknown"} endpoint=${endpoint} duration_ms=${durationMs} timeout_ms=${timeout} retries=${retries}`
      )
    }
    return result
  }).catch((error: Error) => {
    recordSourceFetchMetrics({
      source: source || "unknown",
      endpoint,
      durationMs: Date.now() - requestStartedAt,
      success: false,
      retryCount: Math.max(0, attemptsExecuted - 1),
      timedOut: timeoutDetected || error.message.includes("timeout")
    })
    // إذا فشلت جميع المحاولات
    return {
      success: false,
      error: `فشل الاتصال بعد ${retries + 1} محاولات: ${error.message}`
    }
  })
}
