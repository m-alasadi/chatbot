/**
 * نظام الاقتراحات الذكية لتوجيه المستخدم داخل الموقع
 * 
 * يُستخدم في حالات:
 * - عدم وجود نتائج من API
 * - الأسئلة خارج نطاق الموقع
 * - توجيه المستخدم لمحتوى ذي صلة
 */

import {
  SITE_CATEGORIES,
  COMMON_SEARCH_TERMS,
  SUGGESTED_QUESTIONS,
  findCategoryByKeywords,
  getAllCategoryNames
} from "./site-categories"

// ====================================
// أنواع الاقتراحات
// ====================================

export interface Suggestion {
  type: "search" | "category" | "question" | "latest"
  text: string
  description?: string
}

export interface SuggestionResponse {
  message: string
  suggestions: Suggestion[]
  context: "no_results" | "out_of_scope" | "api_error" | "ambiguous"
}

// ====================================
// توليد الاقتراحات - نتائج فارغة
// ====================================

/**
 * اقتراحات عند عدم وجود نتائج للبحث
 */
export function generateNoResultsSuggestions(
  query: string,
  context?: {
    searchedCategory?: string
    attemptedAction?: string
  }
): SuggestionResponse {
  const suggestions: Suggestion[] = []

  // 1. حاول اقتراح تصنيف ذي صلة
  const relatedCategory = findCategoryByKeywords(query)
  if (relatedCategory) {
    suggestions.push({
      type: "category",
      text: `استعرض جميع مشاريع ${relatedCategory.nameAr}`,
      description: `قد تجد ما تبحث عنه في هذه الفئة`
    })

    // اقتراح مثال من التصنيف
    if (relatedCategory.examples.length > 0) {
      suggestions.push({
        type: "search",
        text: relatedCategory.examples[0],
        description: "مثال على مشروع في هذه الفئة"
      })
    }
  }

  // 2. اقترح عرض أحدث المشاريع
  if (suggestions.length < 2) {
    suggestions.push({
      type: "latest",
      text: "عرض أحدث المشاريع",
      description: "تصفح آخر المشاريع المضافة للموقع"
    })
  }

  // 3. اقترح كلمات بحث بديلة أو أسئلة شائعة
  if (suggestions.length < 3) {
    const randomQuestions = getRandomSuggestions(SUGGESTED_QUESTIONS, 1)
    suggestions.push({
      type: "question",
      text: randomQuestions[0],
      description: "سؤال مقترح"
    })
  }

  // 4. إذا لم نصل لـ 3 اقتراحات، أضف تصنيفات شائعة
  if (suggestions.length < 3) {
    const popularCategories = ["التعليم", "الصحة والطب", "الخدمات الاجتماعية"]
    const remainingNeeded = 3 - suggestions.length

    for (let i = 0; i < remainingNeeded && i < popularCategories.length; i++) {
      suggestions.push({
        type: "category",
        text: `استعرض مشاريع ${popularCategories[i]}`,
        description: "فئة شائعة"
      })
    }
  }

  const message = buildNoResultsMessage(query, context)

  return {
    message,
    suggestions: suggestions.slice(0, 3), // اضمن 3 اقتراحات فقط
    context: "no_results"
  }
}

/**
 * بناء رسالة عند عدم وجود نتائج
 */
function buildNoResultsMessage(
  query: string,
  context?: {
    searchedCategory?: string
    attemptedAction?: string
  }
): string {
  let message = `عذراً، لم أجد نتائج في بيانات الموقع عن "${query}".`

  if (context?.searchedCategory) {
    message += ` (ضمن فئة: ${context.searchedCategory})`
  }

  message += "\n\nيمكنك تجربة أحد الاقتراحات التالية:"

  return message
}

// ====================================
// توليد الاقتراحات - خارج النطاق
// ====================================

/**
 * اقتراحات عند سؤال خارج نطاق الموقع
 */
export function generateOutOfScopeSuggestions(query: string): SuggestionResponse {
  const suggestions: Suggestion[] = []

  // اقترح تصنيفات متنوعة
  const diverseCategories = [
    { nameAr: "التعليم", id: "education" },
    { nameAr: "الصحة والطب", id: "health" },
    { nameAr: "الخدمات الدينية", id: "religious" }
  ]

  diverseCategories.forEach(cat => {
    suggestions.push({
      type: "category",
      text: `استعرض مشاريع ${cat.nameAr}`,
      description: "تصفح هذه الفئة"
    })
  })

  const message = buildOutOfScopeMessage(query)

  return {
    message,
    suggestions: suggestions.slice(0, 3),
    context: "out_of_scope"
  }
}

/**
 * بناء رسالة للأسئلة خارج النطاق
 */
function buildOutOfScopeMessage(query: string): string {
  return `أنا متخصص في الإجابة عن أسئلة متعلقة بموقع alkafeel.net والمشاريع المسجلة فيه فقط.

سؤالك عن "${query}" خارج نطاق اختصاصي.

يمكنني مساعدتك في:
• البحث عن المشاريع
• استعراض الفئات والتصنيفات
• معرفة أحدث المشاريع
• الاستعلام عن تفاصيل مشروع معين

جرّب أحد الاقتراحات التالية:`
}

// ====================================
// توليد الاقتراحات - خطأ API
// ====================================

/**
 * اقتراحات عند حدوث خطأ في API
 */
export function generateAPIErrorSuggestions(): SuggestionResponse {
  const suggestions: Suggestion[] = [
    {
      type: "latest",
      text: "عرض أحدث المشاريع",
      description: "تصفح آخر المشاريع المضافة"
    },
    {
      type: "category",
      text: "عرض جميع الفئات",
      description: "تصفح تصنيفات المشاريع"
    },
    {
      type: "question",
      text: "ما هي الخدمات المتاحة في الموقع؟",
      description: "سؤال عام"
    }
  ]

  const message = `عذراً، حدث خطأ مؤقت أثناء جلب البيانات من النظام.

يُرجى المحاولة مرة أخرى بعد قليل، أو جرّب أحد الاقتراحات التالية:`

  return {
    message,
    suggestions,
    context: "api_error"
  }
}

// ====================================
// توليد الاقتراحات - سؤال غامض
// ====================================

/**
 * اقتراحات عند سؤال غامض أو غير واضح
 */
export function generateAmbiguousSuggestions(): SuggestionResponse {
  const suggestions: Suggestion[] = [
    {
      type: "latest",
      text: "أحدث المشاريع",
      description: "تصفح آخر ما تم إضافته"
    },
    {
      type: "category",
      text: "عرض جميع الفئات",
      description: "اختر فئة تهمك"
    },
    {
      type: "search",
      text: "مشاريع الأربعين",
      description: "مشاريع شائعة"
    }
  ]

  const message = `لم أفهم سؤالك بوضوح.

يمكنني مساعدتك بشكل أفضل إذا حددت ما تبحث عنه، مثل:
• "ابحث عن مشاريع التعليم"
• "أعطني تفاصيل المشروع رقم 5"
• "ما أحدث المشاريع؟"

أو جرّب أحد الاقتراحات التالية:`

  return {
    message,
    suggestions,
    context: "ambiguous"
  }
}

// ====================================
// دوال مساعدة
// ====================================

/**
 * احصل على اقتراحات عشوائية من قائمة
 */
function getRandomSuggestions(items: string[], count: number): string[] {
  const shuffled = [...items].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

/**
 * صيّغ رسالة مع الاقتراحات
 */
export function formatSuggestionsForResponse(response: SuggestionResponse): string {
  let formatted = response.message + "\n\n"

  response.suggestions.forEach((suggestion, index) => {
    const emoji = getSuggestionEmoji(suggestion.type)
    formatted += `${index + 1}. ${emoji} ${suggestion.text}\n`
    if (suggestion.description) {
      formatted += `   ↳ ${suggestion.description}\n`
    }
  })

  return formatted.trim()
}

/**
 * احصل على emoji حسب نوع الاقتراح
 */
function getSuggestionEmoji(type: Suggestion["type"]): string {
  const emojiMap = {
    search: "🔍",
    category: "📂",
    question: "❓",
    latest: "⏰"
  }
  return emojiMap[type] || "•"
}

/**
 * تحقق إذا كانت النتائج فارغة من API Response
 */
export function isEmptyAPIResponse(response: any): boolean {
  if (!response) return true

  // تحقق من أنماط مختلفة للنتائج الفارغة
  if (typeof response === "string") {
    try {
      const parsed = JSON.parse(response)
      return isEmptyAPIResponse(parsed)
    } catch {
      return response.trim().length === 0
    }
  }

  // Object response
  if (typeof response === "object") {
    // تحقق من patterns شائعة
    if (response.results && Array.isArray(response.results)) {
      return response.results.length === 0
    }
    if (response.data && Array.isArray(response.data)) {
      return response.data.length === 0
    }
    if (response.items && Array.isArray(response.items)) {
      return response.items.length === 0
    }
    if (response.projects && Array.isArray(response.projects)) {
      return response.projects.length === 0
    }
    // إذا كان total = 0
    if (typeof response.total === "number") {
      return response.total === 0
    }
  }

  return false
}

/**
 * استخرج query من سؤال المستخدم
 */
export function extractQueryFromMessage(message: string): string {
  // إزالة كلمات مثل "ابحث عن" أو "أعطني" الخ
  const cleanedMessage = message
    .replace(/^(ابحث عن|ابحث|اعرض لي|أعطني|أريد|وين|هل توجد|هل فيه|فين)\s*/i, "")
    .trim()

  return cleanedMessage || message
}

// ====================================
// اقتراحات ذكية بناءً على السياق
// ====================================

/**
 * اختر الاقتراحات المناسبة حسب الحالة
 */
export function generateContextualSuggestions(
  context: "no_results" | "out_of_scope" | "api_error" | "ambiguous",
  query?: string
): SuggestionResponse {
  switch (context) {
    case "no_results":
      return generateNoResultsSuggestions(query || "")

    case "out_of_scope":
      return generateOutOfScopeSuggestions(query || "")

    case "api_error":
      return generateAPIErrorSuggestions()

    case "ambiguous":
      return generateAmbiguousSuggestions()

    default:
      return generateAmbiguousSuggestions()
  }
}
