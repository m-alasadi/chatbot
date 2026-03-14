/**
 * تعريف الأدوات (Tools) للـ Function Calling
 * 
 * هذه الأدوات تُستخدم من قبل OpenAI لاختيار الـ endpoint المناسب
 * جميع الأدوات مرتبطة بـ REST API الخاص بموقع projects.alkafeel.net
 */

import { ChatCompletionTool } from "openai/resources/chat/completions"

/**
 * أداة البحث في المشاريع
 * 
 * الاستخدام: عندما يطلب المستخدم البحث عن مشاريع أو فلترتها
 */
export const TOOL_SEARCH_PROJECTS: ChatCompletionTool = {
  type: "function",
  function: {
    name: "search_projects",
    description: "بحث في مشاريع الموقع بالاسم والوصف والمواصفات والعلامات. النتائج مرتبة بالتطابق.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "كلمة البحث بالعربية"
        },
        section: {
          type: "string",
          description: "اسم القسم للتصفية (اختياري)"
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

/**
 * أداة الحصول على تفاصيل مشروع محدد
 * 
 * الاستخدام: عندما يطلب المستخدم معلومات عن مشروع برقم أو اسم محدد
 */
export const TOOL_GET_PROJECT_BY_ID: ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_project_by_id",
    description: "تفاصيل كاملة عن مشروع محدد بالـ ID. استخدمها للأسئلة التقنية الدقيقة.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "معرف المشروع (ID)"
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
    description: "قائمة الأقسام والتصنيفات المتاحة مع عدد المشاريع.",
    parameters: {
      type: "object",
      properties: {
        include_counts: {
          type: "boolean",
          description: "تضمين عدد المشاريع في كل فئة"
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
    description: "أحدث المشاريع المضافة للموقع.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "عدد المشاريع (افتراضي: 5، أقصى: 20)",
          minimum: 1,
          maximum: 20
        },
        section: {
          type: "string",
          description: "اسم القسم للتصفية (اختياري)"
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
    description: "إحصائيات عامة: عدد المشاريع، الأقسام الأكثر مشاريع.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  }
}

/**
 * قائمة جميع الأدوات المتاحة
 */
export const ALL_SITE_TOOLS: ChatCompletionTool[] = [
  TOOL_SEARCH_PROJECTS,
  TOOL_GET_PROJECT_BY_ID,
  TOOL_FILTER_PROJECTS,
  TOOL_GET_LATEST_PROJECTS,
  TOOL_GET_STATISTICS
]

/**
 * Whitelist: أسماء الأدوات المسموحة فقط
 */
export const ALLOWED_TOOL_NAMES = [
  "search_projects",
  "get_project_by_id",
  "filter_projects",
  "get_latest_projects",
  "get_statistics"
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
