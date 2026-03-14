/**
 * Rate Limiter Middleware
 * 
 * يمنع إساءة استخدام API من خلال:
 * - تحديد عدد الطلبات لكل IP
 * - حماية من Spam وDDoS
 * - تنظيف تلقائي للبيانات القديمة
 */

/**
 * معلومات Rate Limit لكل IP
 */
interface RateLimitInfo {
  count: number // عدد الطلبات
  resetTime: number // وقت إعادة التعيين (timestamp)
  blockedUntil?: number // إذا كان محظوراً مؤقتاً
}

/**
 * إعدادات Rate Limiter
 */
export interface RateLimiterConfig {
  maxRequests: number // الحد الأقصى للطلبات
  windowMs: number // الفترة الزمنية بالميلي ثانية
  blockDurationMs: number // مدة الحظر عند التجاوز
  message?: string // رسالة الخطأ
}

/**
 * الإعدادات الافتراضية
 */
const DEFAULT_CONFIG: RateLimiterConfig = {
  maxRequests: 20, // 20 طلب
  windowMs: 60 * 1000, // لكل دقيقة
  blockDurationMs: 5 * 60 * 1000, // حظر لمدة 5 دقائق
  message: "تجاوزت الحد المسموح من الطلبات. يُرجى المحاولة بعد قليل."
}

/**
 * خريطة تخزين Rate Limits (في الذاكرة)
 * في Production يُفضل استخدام Redis
 */
const rateLimitStore = new Map<string, RateLimitInfo>()

/**
 * فترة التنظيف التلقائي (5 دقائق)
 */
const CLEANUP_INTERVAL = 5 * 60 * 1000

/**
 * تنظيف البيانات القديمة
 */
function cleanupOldEntries(): void {
  const now = Date.now()
  const entriesToDelete: string[] = []

  for (const [ip, info] of rateLimitStore.entries()) {
    // إذا انتهت فترة الحظر وانتهت نافذة الوقت
    if (
      (!info.blockedUntil || info.blockedUntil < now) &&
      info.resetTime < now
    ) {
      entriesToDelete.push(ip)
    }
  }

  entriesToDelete.forEach(ip => rateLimitStore.delete(ip))

  if (entriesToDelete.length > 0) {
    console.log(`[Rate Limiter] Cleaned up ${entriesToDelete.length} entries`)
  }
}

// تشغيل التنظيف التلقائي
setInterval(cleanupOldEntries, CLEANUP_INTERVAL)

/**
 * استخراج IP من Request
 */
export function getClientIP(req: Request): string {
  // محاولة الحصول على IP الحقيقي من Headers
  const forwardedFor = req.headers.get("x-forwarded-for")
  const realIP = req.headers.get("x-real-ip")
  const cfConnectingIP = req.headers.get("cf-connecting-ip") // Cloudflare

  if (forwardedFor) {
    // x-forwarded-for يمكن أن يحتوي على عدة IPs
    return forwardedFor.split(",")[0].trim()
  }

  if (realIP) {
    return realIP
  }

  if (cfConnectingIP) {
    return cfConnectingIP
  }

  // Fallback - في Development
  return "unknown"
}

/**
 * التحقق من Rate Limit
 * 
 * @returns object - { allowed: boolean, retryAfter?: number, remaining?: number }
 */
export function checkRateLimit(
  ip: string,
  config: Partial<RateLimiterConfig> = {}
): {
  allowed: boolean
  retryAfter?: number
  remaining?: number
  resetTime?: number
} {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const now = Date.now()

  let info = rateLimitStore.get(ip)

  // إذا لم يكن موجوداً، أنشئ جديد
  if (!info) {
    info = {
      count: 1,
      resetTime: now + cfg.windowMs
    }
    rateLimitStore.set(ip, info)

    return {
      allowed: true,
      remaining: cfg.maxRequests - 1,
      resetTime: info.resetTime
    }
  }

  // التحقق من الحظر المؤقت
  if (info.blockedUntil && info.blockedUntil > now) {
    const retryAfter = Math.ceil((info.blockedUntil - now) / 1000)
    return {
      allowed: false,
      retryAfter
    }
  }

  // إذا انتهت النافذة الزمنية، أعد التعيين
  if (info.resetTime < now) {
    info.count = 1
    info.resetTime = now + cfg.windowMs
    info.blockedUntil = undefined
    rateLimitStore.set(ip, info)

    return {
      allowed: true,
      remaining: cfg.maxRequests - 1,
      resetTime: info.resetTime
    }
  }

  // زيادة العداد
  info.count++

  // إذا تجاوز الحد
  if (info.count > cfg.maxRequests) {
    // حظر مؤقت
    info.blockedUntil = now + cfg.blockDurationMs
    rateLimitStore.set(ip, info)

    const retryAfter = Math.ceil(cfg.blockDurationMs / 1000)

    console.warn(
      `[Rate Limiter] IP ${ip} exceeded limit. Blocked for ${retryAfter}s`
    )

    return {
      allowed: false,
      retryAfter
    }
  }

  // ضمن الحد المسموح
  rateLimitStore.set(ip, info)

  return {
    allowed: true,
    remaining: cfg.maxRequests - info.count,
    resetTime: info.resetTime
  }
}

/**
 * إنشاء Response لـ Rate Limit Error
 */
export function createRateLimitResponse(
  retryAfter: number,
  message?: string
): Response {
  const errorMessage =
    message || DEFAULT_CONFIG.message || "Too many requests"

  return new Response(
    JSON.stringify({
      error: "rate_limit_exceeded",
      message: errorMessage,
      retryAfter
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": retryAfter.toString(),
        "X-RateLimit-Limit": DEFAULT_CONFIG.maxRequests.toString(),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": new Date(
          Date.now() + retryAfter * 1000
        ).toISOString()
      }
    }
  )
}

/**
 * Middleware للتحقق من Rate Limit
 * 
 * استخدام:
 * ```typescript
 * const result = applyRateLimit(req)
 * if (!result.allowed) {
 *   return createRateLimitResponse(result.retryAfter!)
 * }
 * ```
 */
export function applyRateLimit(
  req: Request,
  config?: Partial<RateLimiterConfig>
): {
  allowed: boolean
  retryAfter?: number
  remaining?: number
  ip: string
} {
  const ip = getClientIP(req)
  const result = checkRateLimit(ip, config)

  return {
    ...result,
    ip
  }
}

/**
 * الحصول على معلومات Rate Limit لـ IP معين
 * (للـ debugging)
 */
export function getRateLimitInfo(ip: string): RateLimitInfo | null {
  return rateLimitStore.get(ip) || null
}

/**
 * إعادة تعيين Rate Limit لـ IP معين
 * (للاختبار أو الإدارة)
 */
export function resetRateLimit(ip: string): void {
  rateLimitStore.delete(ip)
  console.log(`[Rate Limiter] Reset for IP: ${ip}`)
}

/**
 * مسح جميع Rate Limits
 * (للاختبار فقط)
 */
export function clearAllRateLimits(): void {
  rateLimitStore.clear()
  console.log(`[Rate Limiter] Cleared all rate limits`)
}

/**
 * الحصول على إحصائيات
 */
export function getRateLimitStats(): {
  totalIPs: number
  blockedIPs: number
  activeIPs: number
} {
  const now = Date.now()
  let blockedIPs = 0
  let activeIPs = 0

  for (const [, info] of rateLimitStore.entries()) {
    if (info.blockedUntil && info.blockedUntil > now) {
      blockedIPs++
    } else if (info.resetTime > now) {
      activeIPs++
    }
  }

  return {
    totalIPs: rateLimitStore.size,
    blockedIPs,
    activeIPs
  }
}
