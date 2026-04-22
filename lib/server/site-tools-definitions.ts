/**
 * تعريف الأدوات (Tools) للـ Function Calling
 * 
 * هذه الأدوات تُستخدم من قبل OpenAI لاختيار الـ endpoint المناسب
 * جميع الأدوات مرتبطة بـ REST API الخاص بموقع alkafeel.net
 */

import { ChatCompletionTool } from "openai/resources/chat/completions"

const SOURCE_ENUM = [
  "auto",
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

/**
 * أداة البحث في المشاريع
 * 
 * الاستخدام: عندما يطلب المستخدم البحث عن مشاريع أو فلترتها
 */
export const TOOL_SEARCH_PROJECTS: ChatCompletionTool = {
  type: "function",
  function: {
    name: "search_projects",
    description: "بحث دقيق وسريع داخل مصادر الموقع المتعددة مع اختيار مصدر تلقائي حسب نية السؤال.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "كلمة البحث بالعربية"
        },
        source: {
          type: "string",
          enum: SOURCE_ENUM,
          description: "المصدر المطلوب (auto للاختيار التلقائي)"
        },
        category_id: {
          type: "string",
          description: "معرف تصنيف الفيديو (اختياري)"
        },
        section_id: {
          type: "string",
          description: "معرف قسم التاريخ (اختياري)"
        },
        limit: {
          type: "number",
          description: "عدد النتائج (افتراضي: 5، أقصى: 20)",
          minimum: 1,
          maximum: 20
        }
      },
      required: ["query"]
    }
  }
}

export const TOOL_SEARCH_CONTENT: ChatCompletionTool = {
  type: "function",
  function: {
    name: "search_content",
    description: "بحث اتحادي متعدد المصادر مع fallback ذكي للحفاظ على الدقة.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "نص البحث"
        },
        source: {
          type: "string",
          enum: SOURCE_ENUM,
          description: "المصدر المطلوب أو auto"
        },
        category_id: {
          type: "string",
          description: "تصنيف الفيديو عند الحاجة"
        },
        section_id: {
          type: "string",
          description: "قسم التاريخ عند الحاجة"
        },
        id: {
          type: "string",
          description: "معرف مباشر لبعض المصادر (اختياري)"
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 20,
          description: "حد النتائج"
        }
      },
      required: ["query"]
    }
  }
}

/**
 * أداة الحصول على تفاصيل مشروع محدد
 * 
 * الاستخدام: عندما يطلب المستخدم معلومات عن مشروع برقم أو اسم محدد
 */
export const TOOL_GET_PROJECT_BY_ID: ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_project_by_id",
    description: "جلب تفاصيل سجل محدد بالمعرف من مصدر محدد أو تلقائي.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "المعرف"
        },
        source: {
          type: "string",
          enum: SOURCE_ENUM,
          description: "المصدر (اختياري)"
        }
      },
      required: ["id"]
    }
  }
}

export const TOOL_GET_CONTENT_BY_ID: ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_content_by_id",
    description: "تفاصيل عنصر واحد باستخدام المعرف من مصدر محدد أو من كل المصادر.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "المعرف"
        },
        source: {
          type: "string",
          enum: SOURCE_ENUM,
          description: "المصدر"
        }
      },
      required: ["id"]
    }
  }
}

/**
 * أداة الحصول على قائمة الفئات المتاحة
 * 
 * الاستخدام: عندما يسأل المستخدم عن أنواع المشاريع المتوفرة
 */
export const TOOL_FILTER_PROJECTS: ChatCompletionTool = {
  type: "function",
  function: {
    name: "filter_projects",
    description: "قائمة التصنيفات المتاحة من مصدر محدد أو من عدة مصادر.",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          enum: SOURCE_ENUM,
          description: "المصدر"
        }
      },
      required: []
    }
  }
}

export const TOOL_LIST_SOURCE_CATEGORIES: ChatCompletionTool = {
  type: "function",
  function: {
    name: "list_source_categories",
    description: "جلب أقسام/تصنيفات المحتوى من المصدر المطلوب.",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          enum: SOURCE_ENUM,
          description: "المصدر"
        }
      },
      required: []
    }
  }
}

/**
 * أداة الحصول على أحدث المشاريع
 * 
 * الاستخدام: عندما يطلب المستخدم آخر المشاريع أو الأحدث
 */
export const TOOL_GET_LATEST_PROJECTS: ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_latest_projects",
    description: "أحدث العناصر من مصدر محدد أو تلقائي.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "عدد المشاريع (افتراضي: 5، أقصى: 20)",
          minimum: 1,
          maximum: 20
        },
        source: {
          type: "string",
          enum: SOURCE_ENUM,
          description: "المصدر"
        },
        query: {
          type: "string",
          description: "نص المستخدم الأصلي للمطابقة الدلالية (مثل تحديد قسم فيديو)"
        },
        category_id: {
          type: "string",
          description: "تصنيف الفيديو"
        },
        section_id: {
          type: "string",
          description: "قسم التاريخ"
        }
      },
      required: []
    }
  }
}

export const TOOL_GET_LATEST_BY_SOURCE: ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_latest_by_source",
    description: "أحدث المحتوى حسب المصدر مع زمن استجابة سريع.",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          enum: SOURCE_ENUM,
          description: "المصدر"
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 20,
          description: "عدد النتائج"
        },
        query: {
          type: "string",
          description: "نص المستخدم الأصلي للمطابقة الدلالية (مثل تحديد قسم فيديو)"
        },
        category_id: {
          type: "string",
          description: "تصنيف الفيديو"
        },
        section_id: {
          type: "string",
          description: "قسم التاريخ"
        }
      },
      required: []
    }
  }
}

/**
 * أداة الحصول على إحصائيات المشاريع
 * 
 * الاستخدام: عندما يسأل المستخدم عن الإحصائيات أو الأرقام
 */
export const TOOL_GET_STATISTICS: ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_statistics",
    description: "إحصائيات عامة عن أحجام البيانات في المصادر المتعددة.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  }
}

/**
 * أداة استرجاع بيانات وصفية عن مصدر معين
 */
export const TOOL_GET_SOURCE_METADATA: ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_source_metadata",
    description: "الحصول على معلومات وصفية عن مصدر معين: عدد العناصر المخزنة مؤقتاً، هل يدعم التصفح بالصفحات، هل يحتاج معاملات إضافية.",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "اسم المصدر",
          enum: SOURCE_ENUM.filter(s => s !== "auto")
        }
      },
      required: ["source"]
    }
  }
}

/**
 * أداة تصفح صفحة محددة من مصدر مُرقّم
 */
export const TOOL_BROWSE_SOURCE_PAGE: ChatCompletionTool = {
  type: "function",
  function: {
    name: "browse_source_page",
    description: "تصفح صفحة محددة من مصدر يدعم التقسيم بالصفحات (الأخبار أو الفيديوهات). مفيد للبحث عن محتوى أقدم غير موجود في الصفحة الأولى.",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "اسم المصدر (articles_latest أو videos_latest أو friday_sermons أو wahy_friday)",
          enum: ["articles_latest", "videos_latest", "friday_sermons", "wahy_friday"]
        },
        page: {
          type: "integer",
          description: "رقم الصفحة (الافتراضي 1)"
        },
        per_page: {
          type: "integer",
          description: "عدد النتائج لكل صفحة (الافتراضي 10، الحد الأقصى 20)"
        },
        order: {
          type: "string",
          description: "ترتيب النتائج: newest (الأحدث أولاً، افتراضي) أو oldest (الأقدم أولاً)",
          enum: ["newest", "oldest"]
        }
      },
      required: ["source"]
    }
  }
}

/**
 * قائمة جميع الأدوات المتاحة
 */
export const ALL_SITE_TOOLS: ChatCompletionTool[] = [
  TOOL_SEARCH_PROJECTS,
  TOOL_SEARCH_CONTENT,
  TOOL_GET_PROJECT_BY_ID,
  TOOL_GET_CONTENT_BY_ID,
  TOOL_FILTER_PROJECTS,
  TOOL_LIST_SOURCE_CATEGORIES,
  TOOL_GET_LATEST_PROJECTS,
  TOOL_GET_LATEST_BY_SOURCE,
  TOOL_GET_STATISTICS,
  TOOL_GET_SOURCE_METADATA,
  TOOL_BROWSE_SOURCE_PAGE
]

/**
 * Whitelist: أسماء الأدوات المسموحة فقط
 */
export const ALLOWED_TOOL_NAMES = [
  "search_projects",
  "search_content",
  "get_project_by_id",
  "get_content_by_id",
  "filter_projects",
  "list_source_categories",
  "get_latest_projects",
  "get_latest_by_source",
  "get_statistics",
  "get_source_metadata",
  "browse_source_page"
] as const

export type AllowedToolName = (typeof ALLOWED_TOOL_NAMES)[number]

/**
 * التحقق من أن اسم الأداة مسموح
 */
export function isAllowedTool(toolName: string): toolName is AllowedToolName {
  return ALLOWED_TOOL_NAMES.includes(toolName as AllowedToolName)
}

/**
 * الحصول على أداة محددة بالاسم
 */
export function getToolByName(
  toolName: AllowedToolName
): ChatCompletionTool | undefined {
  return ALL_SITE_TOOLS.find(tool => tool.function.name === toolName)
}
