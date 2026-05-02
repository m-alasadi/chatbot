/**
 * تعريف مركزي لمجالات المساعدة (preferredDomain).
 * يُستخدم على جانبَي العميل (ChatWidget) والخادم (route + orchestrator).
 *
 * preferredDomain هو **أولوية بحث** وليس فلتر صارم:
 * - يُستخدم لتقديم مزود البيانات الأقرب أولاً.
 * - عند عدم كفاية النتائج، يُسمح بـ fallback إلى المصادر العامة.
 */

export type ChatDomain = "news" | "history" | "videos" | "sermons" | "abbas_bio" | "general"

export interface ChatDomainOption {
  id: ChatDomain
  label: string
  description: string
}

export const CHAT_DOMAINS: ChatDomainOption[] = [
  {
    id: "news",
    label: "الأخبار والمستجدات",
    description: "الأخبار والإعلانات والمستجدات"
  },
  {
    id: "history",
    label: "تاريخ العتبة المقدسة",
    description: "المعلومات التاريخية عن العتبة العباسية المقدسة"
  },
  {
    id: "videos",
    label: "الفيديوهات والمواد المرئية",
    description: "المقاطع المرئية والمحتوى الإعلامي"
  },
  {
    id: "sermons",
    label: "خطب الجمعة",
    description: "خطب الجمعة في الصحن العباسي الشريف"
  },
  {
    id: "abbas_bio",
    label: "سيرة أبي الفضل العباس عليه السلام",
    description: "السيرة والمعلومات الخاصة بأبي الفضل العباس عليه السلام"
  },
  {
    id: "general",
    label: "بحث عام",
    description: "البحث في جميع المصادر المتاحة"
  }
]

const DOMAIN_IDS = new Set<string>(CHAT_DOMAINS.map(d => d.id))

/**
 * تحقّق من أن القيمة الواردة عبارة عن مجال صحيح.
 * أي قيمة غير صالحة تُحوَّل إلى "general".
 */
export function normalizeChatDomain(value: unknown): ChatDomain {
  if (typeof value === "string" && DOMAIN_IDS.has(value)) {
    return value as ChatDomain
  }
  return "general"
}

export function getChatDomainLabel(id: ChatDomain): string {
  return CHAT_DOMAINS.find(d => d.id === id)?.label || "بحث عام"
}

/**
 * خريطة المجال → مصادر بيانات مقترحة (priority، not strict).
 * "general" يُعيد قائمة فارغة كي يبقى السلوك الافتراضي للأوركيستريتر دون تغيير.
 *
 * هذه المصادر هي أسماء مزودات البيانات الموجودة في retrieval-orchestrator.
 */
export function getDomainPreferredSources(domain: ChatDomain): string[] {
  switch (domain) {
    case "news":
      return ["articles_latest"]
    case "history":
      return ["shrine_history_sections", "shrine_history_by_section", "shrine_history_timeline"]
    case "videos":
      return ["videos_latest"]
    case "sermons":
      return ["friday_sermons", "wahy_friday"]
    case "abbas_bio":
      return ["abbas_history_by_id"]
    case "general":
    default:
      return []
  }
}
