/**
 * Data Sanitizer - تنظيف وحماية البيانات
 * 
 * يحمي من:
 * - تسريب البيانات الحساسة
 * - XSS attacks
 * - SQL/NoSQL injection
 * - معلومات شخصية غير مرغوبة
 */

/**
 * الحقول الحساسة التي يجب حذفها من Responses
 */
const SENSITIVE_FIELDS = [
  // معلومات أمنية فقط
  "password",
  "token",
  "apiKey",
  "api_key",
  "secret",
  "privateKey",
  "private_key",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  
  // معلومات مالية
  "creditCard",
  "credit_card",
  "cardNumber",
  "card_number",
  "cvv",
  "bankAccount",
  "bank_account",
  "iban",
  
  // معلومات هوية
  "ssn",
  "nationalId",
  "national_id",
  "passportNumber",
  "passport_number",
  "drivingLicense",
  "driving_license"
]

/**
 * أنماط للكشف عن البيانات الحساسة في النصوص
 */
const SENSITIVE_PATTERNS = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phone: /(\+?\d{1,4}[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}/g,
  creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  url: /(https?:\/\/[^\s]+)/g, // للتحكم في عرض URLs خارجية
}

/**
 * حذف الحقول الحساسة من Object
 */
export function removeSensitiveFields(data: any): any {
  if (!data || typeof data !== "object") {
    return data
  }

  // Array
  if (Array.isArray(data)) {
    return data.map(item => removeSensitiveFields(item))
  }

  // Object
  const sanitized: any = {}

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase()

    // تحقق إذا كان المفتاح حساساً
    const isSensitive = SENSITIVE_FIELDS.some(
      field => lowerKey.includes(field.toLowerCase())
    )

    if (isSensitive) {
      // استبدل بـ [REDACTED]
      sanitized[key] = "[REDACTED]"
    } else if (value && typeof value === "object") {
      // معالجة تكرارية للكائنات المتداخلة
      sanitized[key] = removeSensitiveFields(value)
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}

/**
 * إزالة HTML tags (حماية من XSS)
 */
export function stripHTMLTags(str: string): string {
  if (!str || typeof str !== "string") {
    return str
  }

  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "") // إزالة <script>
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "") // إزالة <style>
    .replace(/<\/?[^>]+(>|$)/g, "") // إزالة باقي HTML tags
    .trim()
}

/**
 * إزالة الأحرف الخاصة الخطرة
 */
export function sanitizeSpecialChars(str: string): string {
  if (!str || typeof str !== "string") {
    return str
  }

  return str
    .replace(/[<>]/g, "") // إزالة < و >
    .replace(/javascript:/gi, "") // إزالة javascript:
    .replace(/on\w+\s*=/gi, "") // إزالة event handlers مثل onclick=
    .trim()
}

/**
 * إخفاء المعلومات الشخصية في النص
 */
export function maskPersonalInfo(text: string): string {
  if (!text || typeof text !== "string") {
    return text
  }

  let sanitized = text

  // إخفاء Emails
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.email, "[EMAIL]")

  // إخفاء أرقام الهواتف
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.phone, "[PHONE]")

  // إخفاء أرقام بطاقات الائتمان
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.creditCard, "[CARD]")

  // إخفاء SSN
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.ssn, "[SSN]")

  return sanitized
}

/**
 * تنظيف user input قبل معالجته
 */
export function sanitizeUserInput(input: string): string {
  if (!input || typeof input !== "string") {
    return input
  }

  let sanitized = input

  // 1. إزالة HTML tags
  sanitized = stripHTMLTags(sanitized)

  // 2. إزالة أحرف خاصة خطرة
  sanitized = sanitizeSpecialChars(sanitized)

  // 3. إخفاء معلومات شخصية
  sanitized = maskPersonalInfo(sanitized)

  // 4. تحديد الطول الأقصى
  const MAX_LENGTH = 1000
  if (sanitized.length > MAX_LENGTH) {
    sanitized = sanitized.substring(0, MAX_LENGTH)
  }

  return sanitized.trim()
}

/**
 * تنظيف API Response قبل إرساله للنموذج
 */
export function sanitizeAPIResponse(response: any): any {
  if (!response) {
    return response
  }

  // 1. حذف الحقول الحساسة
  let sanitized = removeSensitiveFields(response)

  // 2. إذا كان string، نظف النص
  if (typeof sanitized === "string") {
    sanitized = maskPersonalInfo(sanitized)
  }

  // ملاحظة: لا نحول object إلى string هنا
  // لأننا نحتاج للاحتفاظ ببنية البيانات (arrays, objects)
  // التحويل لـ string يحصل فقط عند إرسال النتائج لـ OpenAI

  return sanitized
}

/**
 * التحقق من وجود محتوى ضار في النص
 */
export function containsMaliciousContent(text: string): boolean {
  if (!text || typeof text !== "string") {
    return false
  }

  const maliciousPatterns = [
    /<script/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<iframe/gi,
    /eval\(/gi,
    /document\.cookie/gi,
    /window\.location/gi,
  ]

  return maliciousPatterns.some(pattern => pattern.test(text))
}

/**
 * تنظيف Messages للمحادثة
 */
export function sanitizeMessages(
  messages: Array<{ role: string; content: string }>
): Array<{ role: string; content: string }> {
  return messages.map(msg => ({
    role: msg.role,
    content: sanitizeUserInput(msg.content)
  }))
}

/**
 * تحقق من صحة البيانات المُدخلة
 */
export interface ValidationResult {
  valid: boolean
  error?: string
  sanitized?: string
}

export function validateAndSanitize(input: string): ValidationResult {
  // 1. تحقق من وجود input
  if (!input || typeof input !== "string") {
    return {
      valid: false,
      error: "Input is required"
    }
  }

  // 2. تحقق من الطول
  if (input.length < 1) {
    return {
      valid: false,
      error: "Input is too short"
    }
  }

  if (input.length > 2000) {
    return {
      valid: false,
      error: "Input is too long (max 2000 characters)"
    }
  }

  // 3. تحقق من المحتوى الضار
  if (containsMaliciousContent(input)) {
    return {
      valid: false,
      error: "Input contains potentially harmful content"
    }
  }

  // 4. تنظيف
  const sanitized = sanitizeUserInput(input)

  // 5. تحقق من عدم فقدان المحتوى بعد التنظيف
  if (!sanitized || sanitized.length < 1) {
    return {
      valid: false,
      error: "Input is invalid after sanitization"
    }
  }

  return {
    valid: true,
    sanitized
  }
}

/**
 * تصدير دالة شاملة للتنظيف
 */
export function sanitize(data: any, type: "input" | "output" | "api"): any {
  switch (type) {
    case "input":
      return typeof data === "string"
        ? sanitizeUserInput(data)
        : sanitizeMessages(data)

    case "output":
      return typeof data === "string"
        ? maskPersonalInfo(data)
        : data

    case "api":
      return sanitizeAPIResponse(data)

    default:
      return data
  }
}

/**
 * Logger للأمان (يسجل المحاولات المشبوهة)
 */
export function logSecurityIssue(
  type: string,
  details: any,
  ip?: string
): void {
  console.warn(`[Security] ${type}`, {
    timestamp: new Date().toISOString(),
    ip,
    details
  })
}
