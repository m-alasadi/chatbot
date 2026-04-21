/**
 * Function Calling Handler
 * 
 * يدير تدفق Function Calling من OpenAI:
 * 1. يستقبل function call من OpenAI
 * 2. يتحقق من أن الأداة مسموحة (Whitelist)
 * 3. ينفذ الأداة عبر Service Layer
 * 4. يُرجع النتيجة لـ OpenAI
 */

import OpenAI from "openai"
import { ChatCompletionMessageParam } from "openai/resources/chat/completions"
import {
  isAllowedTool,
  type AllowedToolName
} from "./site-tools-definitions"
import { executeToolByName, type APICallResult } from "./site-api-service"
import { getFallbackResponse } from "./system-prompts"
import {
  isEmptyAPIResponse,
  generateNoResultsSuggestions,
  generateAPIErrorSuggestions,
  formatSuggestionsForResponse
} from "./smart-suggestions"
import { ensureKnowledgeReady } from "./knowledge/content-ingestion"
import { searchKnowledgeChunks, searchKnowledgeWithBackfill } from "./knowledge/knowledge-search"
import {
  extractBestEvidence,
  extractEvidenceFromToolResults,
  formatEvidenceForModel,
  buildMandatoryInstruction,
  generateDirectAnswer,
  formatGroundedAnswer,
  collectToolResultItems,
  type Evidence
} from "./evidence-extractor"
import { logChatTrace, normalizeQueryForTrace } from "./observability/chat-trace"
import { orchestrateRetrieval } from "./retrieval-orchestrator"
import {
  understandQuery,
  type QueryUnderstandingResult
} from "./query-understanding"
import {
  getLastUserMessage,
} from "./runtime/dialog-context-policy"
import {
  buildAnswerShapeInstruction,
} from "./runtime/answer-shape-policy"
import { detectForcedUtilityIntent } from "./runtime/forced-utility-routing-policy"
import {
  getPrimaryRetrievalToolForQuery,
  looksLikeSiteContentQuery,
} from "./runtime/retrieval-bootstrap-policy"

// ── Light Arabic normalization for intent detection ────────────────
function normalizeArabicLight(text: string): string {
  return (text || "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[\u0622\u0623\u0625\u0627]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\s+/g, " ")
    .trim()
}

function extractSpecificQueryTokens(text: string): string[] {
  const norm = normalizeArabicLight(text)
  const genericTokens = new Set([
    "ما", "هو", "هي", "هل", "من", "عن", "في", "على", "الى", "او",
    "هن", "له", "لها", "لهم",
    "لي", "حول", "باختصار", "مختصر", "تكلم", "اشرح", "حدثني", "اخبرني", "عرفني",
    "ابحث", "خبر", "قديم", "يتحدث", "اعطني", "اعرض", "عليه", "السلام",
    "العتبه", "العتبة", "العباسيه", "العباسية", "مشروع", "مشاريع"
  ])

  return norm
    .split(/\s+/)
    .filter(token => token.length >= 2)
    .filter(token => !genericTokens.has(token))
}

function isOfficeHolderQuery(text: string): boolean {
  const norm = normalizeArabicLight(text)
  return norm.includes(normalizeArabicLight("المتولي الشرعي")) ||
    (norm.includes(normalizeArabicLight("المتولي")) && norm.includes(normalizeArabicLight("الشرعي")))
}

const allowedUtilityTools = new Set([
  "get_source_metadata",
  "browse_source_page",
  "get_latest_by_source",
  "list_source_categories",
  "get_statistics"
])

function getPostBootstrapUtilityTools(
  tools: OpenAI.Chat.Completions.ChatCompletionTool[]
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.filter(tool => {
    if (tool.type !== "function") return true
    const name = tool.function?.name
    return typeof name === "string" && allowedUtilityTools.has(name)
  })
}

function isKnowledgePriorityQuery(
  text: string,
  understanding?: QueryUnderstandingResult
): boolean {
  const norm = normalizeArabicLight(text)
  if (isAbbasBiographyQuery(text)) return true
  if (isOfficeHolderQuery(text)) return true
  if (
    norm.includes(normalizeArabicLight("سدنة")) ||
    norm.includes(normalizeArabicLight("سدانة")) ||
    norm.includes(normalizeArabicLight("كلدار")) ||
    norm.includes(normalizeArabicLight("الحرم"))
  ) {
    return true
  }
  if (understanding?.content_intent === "history") return true
  if (
    understanding?.extracted_entities.person?.length ||
    understanding?.extracted_entities.topic?.some(topic =>
      normalizeArabicLight(topic).includes(normalizeArabicLight("سدنة")) ||
      normalizeArabicLight(topic).includes(normalizeArabicLight("اخوات"))
    )
  ) {
    return true
  }
  return false
}

function evidenceContainsLikelyPersonName(evidence: Evidence[]): boolean {
  const pool = evidence
    .slice(0, 5)
    .map(item => `${item.source_title} ${item.quote}`)
    .join(" ")
  return /(السيد|الشيخ|سماحة|العلامة)\s+[\u0621-\u064A]{2,}(?:\s+[\u0621-\u064A]{2,}){1,3}/u.test(pool)
}

function evidenceCoversSpecificTokens(query: string, evidence: Evidence[]): boolean {
  const specificTokens = extractSpecificQueryTokens(query)
  if (specificTokens.length === 0) return true

  const pool = normalizeArabicLight(
    evidence
      .slice(0, 4)
      .map(item => `${item.source_title} ${item.quote} ${item.source_section}`)
      .join(" ")
  )
  const matched = specificTokens.filter(token => pool.includes(token)).length
  const minimumMatches = Math.min(2, specificTokens.length)
  return matched >= minimumMatches
}

function splitCompoundFactQuery(text: string): string[] {
  const raw = String(text || "")
    .replace(/[؟?]+/g, " | ")
    .replace(/،/g, " ، ")
    .replace(/\s+/g, " ")
    .trim()

  if (!raw) return []

  const questionLead = "(?:من|ما|متى|اين|أين|هل|كم|كيف|لماذا)"
  const segmented = raw
    .replace(new RegExp(`\\s+و(?=${questionLead}\\s)`, "gu"), " | ")
    .replace(new RegExp(`\\s+ثم\\s+(?=${questionLead}\\s)`, "gu"), " | ")
    .replace(new RegExp(`،\\s*(?=${questionLead}\\s)`, "gu"), " | ")
    // Also split on "و" before noun phrases that ask about a DIFFERENT entity
    // e.g. "اسم ام العباس وزوجته" → two sub-questions about mother AND wife
    .replace(/\s+و(?=(?:اسم|زوج[ةت]|ابن|بن[ت]|ام|أم|والد[ةت]?|اولاد|أولاد|ألقاب|لقب)\S*)/gu, " | ")

  const parts = segmented
    .split("|")
    .map(part => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)

  return [...new Set(parts)].slice(0, 3)
}

function isCompoundFactQuery(text: string): boolean {
  return splitCompoundFactQuery(text).length > 1
}

function extractCompoundQueryAnchor(
  query: string,
  understanding?: QueryUnderstandingResult
): string {
  const candidates = [
    understanding?.extracted_entities.person?.[0],
    understanding?.extracted_entities.topic?.find(topic => topic.split(/\s+/).length >= 2),
    understanding?.extracted_entities.place?.[0]
  ].filter(Boolean) as string[]

  if (candidates.length > 0) return candidates[0]

  const norm = normalizeArabicLight(query)
  if (norm.includes(normalizeArabicLight("ابي الفضل")) || norm.includes(normalizeArabicLight("أبي الفضل"))) {
    return "أبي الفضل العباس"
  }
  const hasStandaloneAbbas = norm.split(/\s+/).includes(normalizeArabicLight("العباس"))
  const institutionalAbbasContext =
    norm.includes(normalizeArabicLight("العتبة العباسية")) ||
    norm.includes(normalizeArabicLight("العتبه العباسيه")) ||
    norm.split(/\s+/).includes(normalizeArabicLight("العباسية")) ||
    norm.split(/\s+/).includes(normalizeArabicLight("العباسيه"))
  if (hasStandaloneAbbas && !institutionalAbbasContext) {
    return "العباس"
  }
  if (norm.includes(normalizeArabicLight("العتبة العباسية")) || norm.includes(normalizeArabicLight("العتبه العباسيه"))) {
    return "العتبة العباسية"
  }

  return ""
}

function buildCompoundCoverageInstruction(text: string): string | null {
  const parts = splitCompoundFactQuery(text)
  if (parts.length < 2) return null

  return `تعليمات تغطية الإجابة: السؤال الحالي مركب ويتضمن ${parts.length} مطالب. أجب عن كل مطلب بترتيبه الوارد صراحةً، ولا تكتفِ بالإجابة عن أول جزء فقط. إذا كانت معلومة أحد الأجزاء غير متاحة فاذكر ذلك لهذا الجزء وحده.`
}

function enrichCompoundQueryPart(part: string, anchor: string): string {
  if (!anchor) return part

  const normPart = normalizeArabicLight(part)
  const normAnchor = normalizeArabicLight(anchor)
  if (normPart.includes(normAnchor)) return part

  return `${part} ${anchor}`.trim()
}


/**
 * Detect user intents that require a deterministic tool call
 * instead of letting the model freely choose (possibly wrong) tools.
 */

/**
 * Returns true only when the query is asking about Abbas's personal biography
 * (traits, titles, family, life, martyrdom) — NOT about shrine activities,
 * expansions, renovations, or any building/construction work.
 */
function isAbbasBiographyQuery(text: string): boolean {
  const norm = normalizeArabicLight(text)

  // If the query is about shrine construction/expansion/activities → NOT biographical
  const shrineActivityPatterns = [
    "توسعه", "توسعة", "بناء", "ترميم", "انشاء", "إنشاء", "قبه", "قبة",
    "رواق", "صحن", "بلاطه", "بلاطة", "مشروع", "مشاريع", "طابق",
    "تشييد", "اعمار", "اعمال", "عمل", "خدمه", "خدمة",
    "فعاليه", "فعاليات", "نشاط", "انشطه", "برنامج", "مناسبه",
    "زياره", "زيارة", "زائرين", "خبر", "اخبار",
  ]
  if (shrineActivityPatterns.some(p => norm.includes(p))) return false

  // Biographical signals: personal traits, family, life events
  const biographyPatterns = [
    "لقب", "القاب", "كنيه", "كنية", "صفه", "صفات", "صفة",
    "من هو", "من هي", "ما هو", "ما هي", "سيره", "سيرة", "حياه", "حياة",
    "نشاه", "نشأة", "ولاده", "ولادة", "مولد",
    "ام ", "امه", "أمه", "ابيه", "ابوه", "اخوه", "اخواته", "اخوات", "اخت",
    "زوجه", "زوجته", "زوجة", "زوجات", "زواج", "ولد", "ابناء", "اولاد",
    "اعمام", "عمه", "عمته",
    "استشهاد", "شهاده", "شهادة", "مقتل", "متي استشهد",
    "موقفه", "قمر بني هاشم", "سقايه", "سقاية", "عمر سنه",
    "تعريف", "نبذه", "نبذة",
  ]
  if (biographyPatterns.some(p => norm.includes(p))) return true

  return false
}

/**
 * تنظيف بيانات المشروع لتكون مختصرة ومفيدة لـ GPT
 * يشمل الخصائص المهمة مثل المكان والمواصفات والجهة المنفذة
 */
/** قص نص طويل مع الحفاظ على المعلومات المهمة */
function truncate(text: string, max: number): string {
  if (!text || text.length <= max) return text
  return text.substring(0, max) + "…"
}

function cleanProject(project: any, detailed: boolean = false): any {
  if (!project || typeof project !== "object") return project

  const siteDomain = (process.env.SITE_DOMAIN || "https://alkafeel.net").replace(/\/+$/, "")
  const articleUrlTemplate = process.env.SITE_ARTICLE_URL_TEMPLATE || "/news/index?id={id}"

  // تحديد رابط المصدر حسب نوع المحتوى
  const sourceType = project?.source_type
  const isVideoSource = sourceType === "videos_latest" || sourceType === "videos_by_category" || sourceType === "friday_sermons" || sourceType === "wahy_friday"
  const isHistorySource = sourceType === "shrine_history_by_section" || sourceType === "shrine_history_sections"
  const isAbbasSource = sourceType === "abbas_history_by_id"
  const mediaSlug = project?.source_raw?.request || project?.source_raw?.news_id || project?.source_raw?.article_id

  // تاريخ العتبة أو العباس: صفحة ثابتة
  if (isHistorySource || isAbbasSource) {
    const historyUrl = isAbbasSource
      ? `${siteDomain}/abbas?lang=ar`
      : `${siteDomain}/history?lang=ar`
    const sectionNames = Array.isArray(project.sections)
      ? project.sections.map((s: any) => s.name).filter(Boolean)
      : []
    return {
      id: project.id,
      name: project.name,
      description: truncate(project.description || "", detailed ? 500 : 150),
      sections: sectionNames,
      url: historyUrl,
    }
  }

  if (isVideoSource) {
    // استخدام request slug للفيديو إذا متوفر، وإلا استخدام URL الموجود من normalizeSourceDataset
    const videoUrl = mediaSlug
      ? `${siteDomain}/media/${encodeURIComponent(String(mediaSlug))}?lang=ar`
      : (project.url || siteDomain)
    const sectionNames = Array.isArray(project.sections)
      ? project.sections.map((s: any) => s.name).filter(Boolean)
      : []
    const maxPropLen = detailed ? 2000 : 300
    const properties: Record<string, string> = {}
    if (Array.isArray(project.properties)) {
      for (const prop of project.properties) {
        const val = prop.pivot?.value || prop.value
        if (prop.name && val && typeof val === "string") {
          properties[prop.name] = truncate(val, maxPropLen)
        }
      }
    }
    return {
      id: project.id,
      name: project.name,
      description: truncate(project.description || "", detailed ? 500 : 150),
      sections: sectionNames,
      properties: Object.keys(properties).length > 0 ? properties : undefined,
      url: videoUrl,
    }
  }

  const derivedSourceUrl =
    project?.source_raw?.url ||
    project?.source_raw?.link ||
    project?.source_raw?.permalink ||
    project?.source_raw?.news_url ||
    project?.source_raw?.article_url

  const fallbackArticleUrl = (() => {
    if (!project.id) return siteDomain
    const articlePath = articleUrlTemplate.replace(
      "{id}",
      encodeURIComponent(String(project.id))
    )
    if (articlePath.startsWith("http://") || articlePath.startsWith("https://")) {
      return articlePath
    }
    const normalizedPath = articlePath.startsWith("/") ? articlePath : `/${articlePath}`
    return `${siteDomain}${normalizedPath}`
  })()

  const articleUrl =
    project.url ||
    project.article_url ||
    derivedSourceUrl ||
    fallbackArticleUrl
  
  const sectionNames = Array.isArray(project.sections)
    ? project.sections.map((s: any) => s.name).filter(Boolean)
    : []

  // استخراج الخصائص المهمة — قص النصوص الطويلة في البحث، كاملة في التفاصيل
  const maxPropLen = detailed ? 2000 : 300
  const properties: Record<string, string> = {}
  if (Array.isArray(project.properties)) {
    for (const prop of project.properties) {
      const val = prop.pivot?.value || prop.value
      if (prop.name && val && typeof val === "string") {
        properties[prop.name] = truncate(val, maxPropLen)
      }
    }
  }

  return {
    id: project.id,
    name: project.name,
    description: truncate(project.description || "", detailed ? 500 : 150),
    sections: sectionNames,
    properties: Object.keys(properties).length > 0 ? properties : undefined,
    url: articleUrl,
  }
}

/**
 * تحويل اسم المصدر التقني إلى اسم عربي مفهوم
 */
function friendlySourceName(source: string): string {
  const map: Record<string, string> = {
    shrine_history_sections: "تاريخ العتبة",
    shrine_history_by_section: "تاريخ العتبة",
    abbas_history_by_id: "تاريخ العباس",
    articles_latest: "الأخبار",
    videos_latest: "الفيديوهات",
    videos_by_category: "الفيديوهات",
    videos_categories: "أقسام الفيديو",
    lang_words_ar: "القاموس اللغوي",
    friday_sermons: "خطب الجمعة",
    wahy_friday: "من وحي الجمعة",
  }
  return map[source] || source
}

function extractListingItems(result: APICallResult): any[] {
  const data = result?.data
  if (Array.isArray(data?.projects)) return data.projects
  if (Array.isArray(data?.items)) return data.items
  if (Array.isArray(data?.results)) return data.results
  return []
}

export function buildDeterministicLatestListAnswer(
  result: APICallResult,
  fallbackSource?: string
): string | null {
  if (!result?.success) return null

  const items = extractListingItems(result)
  if (items.length === 0) return null

  const sourceKey =
    String(result.data?.source_used || result.data?.source || fallbackSource || "").trim()
  const sourceLabel = sourceKey ? friendlySourceName(sourceKey) : "المصدر المطلوب"

  const lines: string[] = [
    `**أحدث النتائج من ${sourceLabel}**`
  ]

  for (let i = 0; i < Math.min(items.length, 5); i++) {
    const item = items[i]
    const title =
      String(item?.name || item?.title || "نتيجة بدون عنوان")
        .replace(/\s+/g, " ")
        .trim()
    const url = String(item?.url || "").trim()
    const snippet = String(item?._snippet || item?.description || "")
      .replace(/\s+/g, " ")
      .trim()

    lines.push(`${i + 1}. ${title}`)
    if (snippet) lines.push(`   ${snippet}`)
    if (url) lines.push(`   [المصدر](${url})`)
  }

  return lines.join("\n")
}

/**
 * تنظيف نتائج الـ API قبل إرسالها لـ GPT
 */
function cleanResultForGPT(result: APICallResult): any {
  if (!result.success) return result

  const data = result.data
  
  // إذا كانت نتائج بحث (results array) — مختصرة
  if (data?.results && Array.isArray(data.results)) {
    return {
      success: true,
      data: {
        results: data.results.map((p: any) => {
          const cleaned = cleanProject(p, false)
          // Preserve evidence snippet from search scoring
          if (p._snippet) cleaned._snippet = p._snippet
          return cleaned
        }),
        total: data.total,
        result_count: data.result_count,
        top_score: data.top_score,
        query: data.query,
        source_used: data.source_used ? friendlySourceName(data.source_used) : undefined,
        candidate_sources: data.candidate_sources,
        source_attempts: data.source_attempts,
      }
    }
  }

  // إذا كانت نتائج أحدث محتوى (projects array)
  if (data?.projects && Array.isArray(data.projects)) {
    return {
      success: true,
      data: {
        projects: data.projects.map((p: any) => cleanProject(p, false)),
        total: data.total,
        limit: data.limit,
        source_used: friendlySourceName(data.source_used),
      }
    }
  }

  // نتائج تصفح صفحة (browse_source_page)
  if (data?.items && Array.isArray(data.items) && data?.source) {
    return {
      success: true,
      data: {
        items: data.items.map((p: any) => cleanProject(p, false)),
        total_in_page: data.total_in_page,
        total_all: data.total_all,
        page: data.page,
        order: data.order,
        source: friendlySourceName(data.source),
        has_more: data.has_more
      }
    }
  }

  // بيانات وصفية عن مصدر واحد (get_source_metadata)
  if (data?.source && data?.friendly_name && typeof data?.total === "number") {
    return {
      success: true,
      data: {
        source: friendlySourceName(data.source),
        friendly_name: data.friendly_name,
        total: data.total,
        current_page: data.current_page,
        last_page: data.last_page,
        per_page: data.per_page,
        has_pagination: data.has_pagination,
      }
    }
  }

  // بيانات وصفية لعدة مصادر (auto)
  if (data?.sources && Array.isArray(data.sources)) {
    return {
      success: true,
      data: {
        sources: data.sources.map((s: any) => ({
          source: friendlySourceName(s.source),
          friendly_name: s.friendly_name,
          total: s.total,
          per_page: s.per_page,
          last_page: s.last_page,
          has_pagination: s.has_pagination,
        }))
      }
    }
  }

  // قوائم التصنيفات
  if (data?.categories && Array.isArray(data.categories)) {
    return {
      success: true,
      data: {
        categories: data.categories.slice(0, 50),
        total_categories: data.total_categories,
        source_used: friendlySourceName(data.source_used)
      }
    }
  }

  // إذا كان مشروع واحد — تفاصيل كاملة
  if (data?.id && data?.name) {
    return {
      success: true,
      data: cleanProject(data, true)
    }
  }

  // فئات أو إحصائيات — إرجاع كما هي
  return result
}

interface ResolveTraceSummary {
  routed_source?: string
  retry_attempts: number
  result_counts?: number
  top_score?: number | null
  unavailable_reason?: string
}

interface ToolCallContext {
  traceId?: string
  retryCounter?: { count: number }
  traceSummary?: ResolveTraceSummary
  userQuery?: string
  queryUnderstanding?: QueryUnderstandingResult
}

function getResultCountFromData(data: any): number {
  if (!data) return 0
  if (typeof data.total === "number") return data.total
  if (Array.isArray(data.results)) return data.results.length
  if (Array.isArray(data.projects)) return data.projects.length
  if (Array.isArray(data.items)) return data.items.length
  return 0
}

function getTopScoreFromData(data: any): number | null {
  if (!data) return null
  if (typeof data.top_score === "number") return data.top_score
  if (Array.isArray(data.results) && data.results.length > 0) {
    const first = data.results[0]
    const score = first?._score || first?.score
    if (typeof score === "number") return score
  }
  return null
}

type ToolFailureKind =
  | "timeout"
  | "rate_limit"
  | "upstream_unavailable"
  | "network"
  | "empty_results"
  | "unknown"

function classifyToolFailure(result: APICallResult, emptyResults: boolean): ToolFailureKind {
  if (emptyResults) return "empty_results"

  const text = String(result?.error || "").toLowerCase()
  if (!text) return "unknown"

  if (text.includes("request_budget_exhausted") || text.includes("timeout") || text.includes("timed out")) {
    return "timeout"
  }
  if (text.includes("rate limit") || text.includes("too many requests") || text.includes("429")) {
    return "rate_limit"
  }
  if (
    text.includes("503") ||
    text.includes("502") ||
    text.includes("504") ||
    text.includes("service unavailable") ||
    text.includes("bad gateway") ||
    text.includes("gateway")
  ) {
    return "upstream_unavailable"
  }
  if (
    text.includes("fetch") ||
    text.includes("network") ||
    text.includes("econn") ||
    text.includes("enotfound") ||
    text.includes("socket")
  ) {
    return "network"
  }

  return "unknown"
}

function buildToolFailureMessage(
  kind: ToolFailureKind,
  traceId?: string
): string {
  const traceSuffix = traceId ? `\n\nرقم التتبع: ${traceId}` : ""

  switch (kind) {
    case "timeout":
      return `تعذر إكمال الاستعلام في الوقت المتاح. يمكنك إعادة المحاولة أو تضييق السؤال قليلًا.${traceSuffix}`
    case "rate_limit":
      return `الخدمة تتلقى عددًا كبيرًا من الطلبات الآن. حاول بعد قليل.${traceSuffix}`
    case "upstream_unavailable":
      return `مصدر الإجابة غير متاح مؤقتًا الآن. حاول بعد قليل.${traceSuffix}`
    case "network":
      return `حدثت مشكلة اتصال أثناء جلب البيانات من المصدر.${traceSuffix}`
    case "empty_results":
      return `لم أجد نتائج مؤكدة في المصادر المتاحة لهذا السؤال.${traceSuffix}`
    default:
      return `تعذر إكمال الإجابة بسبب خلل مؤقت في مسار الاسترجاع.${traceSuffix}`
  }
}

/**
 * نتيجة معالجة Function Calling
 */
export interface FunctionCallResult {
  shouldContinue: boolean // هل نحتاج لإرسال طلب آخر لـ OpenAI؟
  messages: ChatCompletionMessageParam[] // الرسائل لإضافتها للمحادثة
  finalResponse?: string // الرد النهائي (إذا اكتمل)
  error?: string
}

/**
 * معالجة tool call واحد
 * 
 * @param toolCall - معلومات الأداة المراد استدعاءها
 */
async function processToolCall(
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  context: ToolCallContext = {}
): Promise<{
  tool_call_id: string
  role: "tool"
  content: string
}> {
  const toolName = toolCall.function.name
  const toolCallId = toolCall.id

  console.log(`[Function Call] Tool: ${toolName}, ID: ${toolCallId}`)

  // التحقق من Whitelist
  if (!isAllowedTool(toolName)) {
    console.error(`[Function Call] Rejected: ${toolName} not in whitelist`)
    return {
      tool_call_id: toolCallId,
      role: "tool",
      content: JSON.stringify({
        success: false,
        error: `الأداة "${toolName}" غير مسموحة`,
        message: "هذه الأداة غير متاحة حالياً في النظام."
      })
    }
  }

  // تحليل المعاملات
  let args: Record<string, any>
  try {
    args = JSON.parse(toolCall.function.arguments || "{}")
  } catch (error) {
    console.error(`[Function Call] Invalid arguments:`, error)
    return {
      tool_call_id: toolCallId,
      role: "tool",
      content: JSON.stringify({
        success: false,
        error: "معاملات غير صالحة",
        message: "حدث خطأ في تحليل المعاملات."
      })
    }
  }

  // تنفيذ الأداة (orchestrator-aware for retrieval tools)
  let result: APICallResult
  const isRetrievalTool = toolName === "search_content" || toolName === "search_projects"
  if (isRetrievalTool) {
    const retrievalUnderstanding = context.queryUnderstanding || understandQuery(String(args.query || context.userQuery || ""))
    const orchestrated = await orchestrateRetrieval(
      toolName as AllowedToolName,
      args,
      {
        traceId: context.traceId,
        requestBudgetMs: Number(process.env.RETRIEVAL_REQUEST_BUDGET_MS || 18000),
        queryUnderstanding: retrievalUnderstanding
      }
    )
    if (orchestrated) {
      result = orchestrated.finalResult
      if (context.retryCounter) {
        context.retryCounter.count += Math.max(0, orchestrated.attempts.length - 1)
      }
      if (context.traceSummary) {
        context.traceSummary.routed_source = orchestrated.routedSource || context.traceSummary.routed_source
        context.traceSummary.result_counts = orchestrated.resultCount
        context.traceSummary.top_score = orchestrated.topScore
        if (orchestrated.exhausted) {
          context.traceSummary.unavailable_reason = orchestrated.unavailableReason
        }
      }
    } else {
      result = await executeToolByName(
        toolName as AllowedToolName,
        args
      )
    }
  } else {
    result = await executeToolByName(
      toolName as AllowedToolName,
      args
    )
  }

  if (
    isRetrievalTool &&
    result.success &&
    isEmptyAPIResponse(result.data) &&
    typeof args.query === "string"
  ) {
    const normQ = normalizeArabicLight(args.query)
    if (normQ.includes(normalizeArabicLight("نداء العقيدة"))) {
      const relaxedQuery = args.query.replace(/نداء\s+العقيدة/g, "العقيدة")
      if (relaxedQuery !== args.query) {
        if (context.traceId) {
          logChatTrace({
            trace_id: context.traceId,
            stage: "retrieval_relaxed_retry",
            normalized_query: normalizeQueryForTrace(String(args.query || "")),
            routed_source: args.source,
            details: {
              reason: "named_event_phrase_relaxation",
              original_query: args.query,
              relaxed_query: relaxedQuery
            }
          })
        }
        const relaxedResult = await executeToolByName(
          toolName as AllowedToolName,
          { ...args, query: relaxedQuery, source: args.source || "auto" }
        )
        if (relaxedResult.success && !isEmptyAPIResponse(relaxedResult.data)) {
          result = relaxedResult
        }
      }
    }
  }

  const traceQuery = args.query || context.userQuery || ""

  if (context.traceId) {
    const resultCount = getResultCountFromData(result.data)
    const topScore = getTopScoreFromData(result.data)
    const routedSource =
      (result.data && (result.data.source_used || result.data.source || result.data.routed_source)) ||
      args.source
    logChatTrace({
      trace_id: context.traceId,
      stage: "tool_result",
      normalized_query: normalizeQueryForTrace(traceQuery),
      routed_source: routedSource,
      result_counts: resultCount,
      top_score: topScore,
      details: {
        tool_name: toolName,
        success: result.success
      }
    })
    if (context.traceSummary) {
      // Keep orchestrator-selected source when available; fallback to args.source.
      if (typeof routedSource === "string" && routedSource.trim().length > 0) {
        context.traceSummary.routed_source = routedSource
      }
      context.traceSummary.result_counts = resultCount
      context.traceSummary.top_score = topScore
    }
  }

  if (result.success && isEmptyAPIResponse(result.data)) {
    console.log(`[Function Call] Empty results detected after retries, generating suggestions`)

    if (context.traceId) {
      logChatTrace({
        trace_id: context.traceId,
        stage: "empty_results_fallback",
        normalized_query: normalizeQueryForTrace(String(args.query || context.userQuery || "")),
        routed_source: args.source,
        retry_attempts: context.retryCounter?.count || 0,
        unavailable_reason: "empty_results_after_retries",
        details: {
          tool_name: toolName,
          attempted_action: toolName
        }
      })
    }
    
    // استخرج query من المعاملات
    const query = args.query || args.searchTerm || args.keyword || ""
    const category = args.category || undefined
    
    // توليد الاقتراحات الذكية
    const suggestionsResponse = generateNoResultsSuggestions(query, {
      searchedCategory: category,
      attemptedAction: toolName
    })
    const failureKind = classifyToolFailure(result, true)
    const failureMessage = buildToolFailureMessage(failureKind, context.traceId)
     
    // إرجاع النتيجة مع الاقتراحات
    return {
      tool_call_id: toolCallId,
      role: "tool",
      content: JSON.stringify({
        success: false,
        empty_results: true,
        failure_kind: failureKind,
        retry_attempts: context.retryCounter?.count || 0,
        message: `${failureMessage}\n\n${formatSuggestionsForResponse(suggestionsResponse)}`,
        suggestions: suggestionsResponse.suggestions,
        context: suggestionsResponse.context,
        original_query: query
      })
    }
  }

  // معالجة الأخطاء مع اقتراحات
  if (!result.success) {
    console.error(`[Function Call] API Error:`, result.error)

    if (context.traceId) {
      logChatTrace({
        trace_id: context.traceId,
        stage: "tool_error_fallback",
        normalized_query: normalizeQueryForTrace(String(args.query || context.userQuery || "")),
        routed_source: args.source,
        retry_attempts: context.retryCounter?.count || 0,
        unavailable_reason: String(result.error || "tool_execution_failed"),
        details: {
          tool_name: toolName
        }
      })
    }
    
    const errorSuggestions = generateAPIErrorSuggestions()
    const failureKind = classifyToolFailure(result, false)
    const failureMessage = buildToolFailureMessage(failureKind, context.traceId)
     
    return {
      tool_call_id: toolCallId,
      role: "tool",
      content: JSON.stringify({
        success: false,
        failure_kind: failureKind,
        error: result.error,
        message: `${failureMessage}\n\n${formatSuggestionsForResponse(errorSuggestions)}`,
        suggestions: errorSuggestions.suggestions,
        context: errorSuggestions.context
      })
    }
  }

  // صياغة الرد العادي (نتائج موجودة)
  // تنظيف البيانات لتكون مختصرة ومفيدة لـ GPT
  const cleanedResult = cleanResultForGPT(result)

  const toolResponse = {
    tool_call_id: toolCallId,
    role: "tool" as const,
    content: JSON.stringify(cleanedResult)
  }

  console.log(
    `[Function Call] Result:`,
    result.success ? "Success" : "Failed"
  )

  return toolResponse
}

/**
 * معالجة مجموعة tool calls من OpenAI
 * 
 * @param toolCalls - قائمة الأدوات المطلوب استدعاءها
 */
export async function handleToolCalls(
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
  context: ToolCallContext = {}
): Promise<ChatCompletionMessageParam[]> {
  const toolResponses: ChatCompletionMessageParam[] = []

  // معالجة كل أداة
  for (const toolCall of toolCalls) {
    const response = await processToolCall(toolCall, context)
    toolResponses.push(response)
  }

  return toolResponses
}

/**
 * تدفق كامل لـ Function Calling
 * 
 * يدير التواصل المتكرر مع OpenAI حتى الحصول على رد نهائي
 * 
 * @param openai - عميل OpenAI
 * @param model - نموذج OpenAI
 * @param messages - رسائل المحادثة
 * @param tools - الأدوات المتاحة
 * @param maxIterations - الحد الأقصى للتكرار (لمنع حلقات لا نهائية)
 */
/**
 * تنفيذ tool calls فقط وإرجاع الرسائل الجاهزة للاستدعاء النهائي (streaming)
 * 
 * الفكرة: ننفذ كل tool calls بدون stream، ثم نرجع الرسائل
 * الجاهزة ليقوم route.ts بالاستدعاء الأخير كـ stream مباشرة للمستخدم
 */

// ── Knowledge layer helpers ─────────────────────────────────────────

/**
 * Determine whether the user query benefits from the knowledge layer
 * (full-text deep search). Skip for trivial / deterministic queries
 * like counts, metadata, categories, latest/oldest listings.
 */
function shouldUseKnowledgeLayer(
  text: string,
  understanding?: QueryUnderstandingResult
): boolean {
  const norm = normalizeArabicLight(text)

  // Abbas biographical queries always use the knowledge layer —
  // even when "عدد/كم" is present (e.g. "عدد زوجات العباس").
  if (isAbbasBiographyQuery(text)) return true

  if (understanding) {
    const op = understanding.operation_intent
    if (op === "count" || op === "latest" || op === "list_items" || op === "browse") {
      return false
    }
  }

  // Skip: counts, metadata, category listing, latest/oldest
  const skipPatterns = [
    "عدد", "كم", "اجمالي", "كلي", "مجموع",        // counts
    "ميتاداتا", "وصفي", "معلومات وصفيه",            // metadata
    "اقسام الفيديو", "تصنيفات", "فئات",             // category listing
    "احدث خبر", "اخر خبر", "اخر فيديو",             // latest
    "اول خبر", "اقدم خبر", "اول فيديو",             // oldest
    "اعرض احدث", "اعرض أحدث", "احدث الفيديوهات", "احدث اخبار",
    "احدث من وحي الجمعه", "احدث خطب الجمعه", "احدث خطبه الجمعه",
  ]
  if (skipPatterns.some(p => norm.includes(p))) return false

  // Positive: biography, history, descriptive, search-oriented queries
  const deepPatterns = [
    "من هو", "من هي", "ما هو", "ما هي", "ماهو", "ماهي",
    "تاريخ", "سيره", "حياه", "نبذه", "استشهاد",
    "عتبه", "عباس", "ابو الفضل", "ابي الفضل", "ابا الفضل",
    "ضريح", "مرقد", "حرم", "صحن",
    "سدنه", "كلدار", "وصف",
    "زياره", "ابحث", "بحث", "معلومات عن", "تحدث عن", "حدثني",
    "اخبرني عن", "عرفني", "يذكر", "ماذا يذكر",
    "خطبه", "خطب", "جمعه", "وحي الجمعه", "اصدار", "اصدارات",
    "القاب", "صفات", "اخوه", "اخوات", "زواج", "كنيه", "نشاه",
    "ام البنين", "قمر بني هاشم", "سقايه",
  ]
  if (deepPatterns.some(p => norm.includes(p))) return true

  // Generic: if it's a lengthy question (>20 chars after trim), assume it's descriptive
  return norm.length > 20
}

/**
 * Format knowledge search results compactly for the model.
 * Returns a short structured block instead of raw 800-char dumps.
 */
function formatKnowledgeResults(
  chunks: { chunk: { title: string; section: string; url: string; chunk_text: string; source?: string }; evidence_snippet: string; score: number }[]
): string {
  if (!chunks || chunks.length === 0) return ""

  // Extract structured evidence for grounded quotation
  const evidence = extractBestEvidence(chunks as any, "", 3)
  const evidenceBlock = formatEvidenceForModel(evidence)

  const lines: string[] = ["[سياق معرفي إضافي من النصوص الكاملة]"]
  for (const r of chunks) {
    const title = r.chunk.title || ""
    const section = r.chunk.section || ""
    const url = r.chunk.url || ""
    // Use generous snippet: for Abbas chunks, include more text to capture biographical facts
    const isAbbas = r.chunk.source === "abbas_local_dataset"
    const maxSnippet = isAbbas ? 550 : 400
    // For Abbas chunks, prefer full chunk text to ensure date/biographical facts are captured
    const snippet = isAbbas
      ? r.chunk.chunk_text.substring(0, maxSnippet)
      : (r.evidence_snippet || r.chunk.chunk_text.substring(0, maxSnippet))
    lines.push(`• ${title}${section ? ` — ${section}` : ""}`)
    lines.push(`  ${snippet}`)
    if (url) lines.push(`  ${url}`)
  }

  // Append structured evidence block for grounded quoting
  if (evidenceBlock) {
    lines.push("")
    lines.push(evidenceBlock)
  }

  return lines.join("\n")
}

/**
 * Search knowledge index and return compact formatted context, or null.
 * Single entry point for all knowledge injection — avoids duplication.
 */
async function getKnowledgeContext(
  query: string,
  understanding?: QueryUnderstandingResult
): Promise<{ context: string; topScore: number; evidence: Evidence[] } | null> {
  try {
    const norm = normalizeArabicLight(query)
    const isAbbasAttributeQuery =
      isAbbasBiographyQuery(query) &&
      ["ابناء", "أبناء", "زوجات", "القاب", "كنيه", "كنية"].some(t => norm.includes(normalizeArabicLight(t)))
    const compoundParts = splitCompoundFactQuery(query)
    const compoundAnchor = extractCompoundQueryAnchor(query, understanding)
    const searchPlans = compoundParts.length > 1
      ? compoundParts.map(part => ({
          label: part,
          searchQuery: enrichCompoundQueryPart(part, compoundAnchor)
        }))
      : [{ label: query, searchQuery: query }]

    await ensureKnowledgeReady()
    const contexts: string[] = []
    const evidencePool: Evidence[] = []
    let topScore = 0

    for (const plan of searchPlans) {
      const response = await searchKnowledgeWithBackfill(plan.searchQuery, {
        limit: isAbbasAttributeQuery ? 6 : 4,
        minScore: isAbbasAttributeQuery ? 0.6 : 1.5
      })
      if (response.chunks.length === 0) continue

      topScore = Math.max(topScore, response.chunks[0].score)
      const formatted = formatKnowledgeResults(response.chunks)
      evidencePool.push(...extractBestEvidence(response.chunks as any, plan.searchQuery, searchPlans.length > 1 ? 2 : 3))
      contexts.push(
        searchPlans.length > 1
          ? `[جزء مطلوب: ${plan.label}]\n${formatted}`
          : formatted
      )
    }

    if (contexts.length === 0 && searchPlans.length > 1) {
      const fallback = await searchKnowledgeWithBackfill(query, {
        limit: isAbbasAttributeQuery ? 6 : 4,
        minScore: isAbbasAttributeQuery ? 0.6 : 1.5
      })
      if (fallback.chunks.length > 0) {
        topScore = Math.max(topScore, fallback.chunks[0].score)
        evidencePool.push(...extractBestEvidence(fallback.chunks as any, query, searchPlans.length > 1 ? 2 : 3))
        contexts.push(formatKnowledgeResults(fallback.chunks))
      }
    }

    if (contexts.length === 0) {
      console.log(`[Knowledge] No chunks for: "${query}"`)
      return null
    }

    console.log(`[Knowledge] Found ${contexts.length} context block(s) for: "${query}"`)
    const uniqueEvidence = evidencePool
      .filter(item => item?.quote)
      .filter((item, index, arr) =>
        arr.findIndex(other =>
          other.quote === item.quote &&
          other.source_title === item.source_title &&
          other.source_url === item.source_url
        ) === index
      )
      .sort((a, b) => b.confidence - a.confidence)
    return {
      context: contexts.join("\n\n"),
      topScore,
      evidence: uniqueEvidence.slice(0, 4)
    }
  } catch (e) {
    console.warn("[Knowledge] Search failed:", (e as Error).message)
    return null
  }
}

/**
 * Extract evidence from tool result messages and inject as structured quotes.
 * Uses mandatory instruction when confidence is high, soft suggestion otherwise.
 * Returns the evidence list for use in the pipeline (direct-answer check).
 */
function extractToolResultEvidence(
  messages: ChatCompletionMessageParam[],
  userQuery: string
): Evidence[] {
  const allItems = collectToolResultItems(messages as any[])
  if (allItems.length === 0) return []

  const compoundQuery = isCompoundFactQuery(userQuery)
  const limit = isOfficeHolderQuery(userQuery) ? 5 : compoundQuery ? 5 : 3
  return extractEvidenceFromToolResults(allItems, userQuery, limit)
}

function injectToolEvidenceBlock(
  messages: ChatCompletionMessageParam[],
  userQuery: string,
  evidence: Evidence[]
): void {
  if (evidence.length === 0) return

  const compoundQuery = isCompoundFactQuery(userQuery)
  const topConfidence = evidence[0]?.confidence ?? 0
  console.log(`[Evidence] ${evidence.length} items, top confidence: ${topConfidence}%`)

  const block = compoundQuery
    ? formatEvidenceForModel(evidence)
    : topConfidence >= 40
      ? buildMandatoryInstruction(evidence)
      : formatEvidenceForModel(evidence)

  if (block) {
    messages.push({ role: "system", content: block })
  }
}

/**
 * Inject knowledge context + evidence guard into the message array.
 * Returns the extracted tool-result evidence list for use by the caller.
 */
async function injectKnowledgeAndGuard(
  messages: ChatCompletionMessageParam[],
  userQuery: string,
  understanding?: QueryUnderstandingResult
): Promise<Evidence[]> {
  let extractedEvidence = extractToolResultEvidence(messages, userQuery)
  const topEvidenceConfidence = extractedEvidence[0]?.confidence ?? 0
  const hasKnowledgeContextAlready = messages.some(
    m => m.role === "system" && typeof m.content === "string" && m.content.includes("[سياق معرفي إضافي من النصوص الكاملة]")
  )
  const knowledgePriority = isKnowledgePriorityQuery(userQuery, understanding)
  let knowledgeTopScore = 0

  // Only use knowledge layer for qualifying queries
  let abbasKnowledgeInjected = false
  let knowledgeInjected = false
  let knowledgeEvidence: Evidence[] = []
  const shouldRunKnowledgeLayer =
    !hasKnowledgeContextAlready &&
    shouldUseKnowledgeLayer(userQuery, understanding) &&
    (knowledgePriority || topEvidenceConfidence < 55)

  if (shouldRunKnowledgeLayer) {
    const kResult = await getKnowledgeContext(userQuery, understanding)
    if (kResult) {
      const { context: kCtx, topScore, evidence } = kResult
      knowledgeInjected = true
      knowledgeTopScore = topScore
      knowledgeEvidence = evidence
      // Detect if Abbas knowledge content was returned WITH a strong relevance score.
      // A low top-score (< 7.0) means the knowledge base only has tangentially related
      // content — don't suppress tool results in that case.
      const ABBASS_BIO_MIN_SCORE = 7.0
      if (
        (kCtx.includes("العباس بن علي") || kCtx.includes("alkafeel.net/abbas")) &&
        topScore >= ABBASS_BIO_MIN_SCORE
      ) {
        abbasKnowledgeInjected = true
      }
      // If any tool returned empty results, replace that message content with
      // knowledge results to prevent the model from fixating on "empty"
      const emptyToolIdx = messages.findIndex(m =>
        m.role === "tool" && typeof m.content === "string" && m.content.includes('"empty_results":true')
      )
      if (emptyToolIdx >= 0) {
        console.log(`[Knowledge] Tool returned empty — overriding with knowledge context`)
        ;(messages[emptyToolIdx] as any).content = JSON.stringify({
          success: true,
          data: {
            source_used: "النصوص الكاملة للموقع",
            note: "النتائج التالية من البحث في النصوص الكاملة المفهرسة"
          }
        }) + "\n\n" + kCtx
        messages.push({
          role: "system",
          content: "استخدم السياق المعرفي المستخرج من النصوص الكاملة للإجابة مباشرة إذا كان مرتبطًا بالسؤال. لا تقل إن المعلومات غير متاحة ما دام هذا السياق يحتوي على شواهد ذات صلة."
        })
      } else {
        // Normal injection: add as supplementary system context
        messages.push({ role: "system", content: kCtx })
      }
    } else {
      const norm = normalizeArabicLight(userQuery)
      const asksAbbasAttributes =
        isAbbasBiographyQuery(userQuery) &&
        ["ابناء", "أبناء", "زوجات", "القاب", "كنيه", "كنية"].some(t => norm.includes(normalizeArabicLight(t)))

      if (asksAbbasAttributes) {
        messages.push({
          role: "system",
          content: "ℹ️ لم تتوفر مطابقة كافية من الفهرس المحلي لهذا التفصيل. إن كان السؤال عن السمات الشخصية لأبي الفضل العباس (عليه السلام) مثل الأبناء أو الألقاب، يمكنك الإجابة من المعرفة التاريخية الموثوقة بصياغة مباشرة ومختصرة، ولا تنتقل إلى أخبار مشاريع العتبة."
        })
      }
    }
  }

  const weakToolEntityCoverage =
    extractedEvidence.length > 0 &&
    !evidenceCoversSpecificTokens(userQuery, extractedEvidence)
  const officeHolderWithoutName =
    isOfficeHolderQuery(userQuery) &&
    extractedEvidence.length > 0 &&
    !evidenceContainsLikelyPersonName(extractedEvidence)
  const shouldPreferKnowledgeContext =
    knowledgeInjected &&
    knowledgePriority &&
    (
      weakToolEntityCoverage ||
      officeHolderWithoutName ||
      extractedEvidence.length === 0 ||
      topEvidenceConfidence < 70
    ) &&
    knowledgeTopScore >= 4.5

  if (shouldPreferKnowledgeContext) {
    messages.push({
      role: "system",
      content: "📚 استخدم [سياق معرفي إضافي من النصوص الكاملة] كمصدر أول لهذا السؤال التاريخي/الاسمي. إذا كانت نتائج الأدوات مجرد تطابقات لفظية عامة أو أخبار غير مباشرة، فلا تبنِ الإجابة عليها."
    })
  }

  // Evidence guard: skip when Abbas local knowledge was injected —
  // the Abbas dataset IS the authoritative source for biographical facts.
  // Do NOT extract tool-result evidence here — news articles mentioning
  // "مرقد أبي الفضل" would be ranked high incorrectly and override the
  // real Abbas biographical content already present in the knowledge context.
  if (abbasKnowledgeInjected) {
    // Only suppress tool results for biographical questions (traits, family, life).
    // For shrine activity/construction queries, let tool results come through normally.
    if (isAbbasBiographyQuery(userQuery)) {
      const norm = normalizeArabicLight(userQuery)
      const kCtxNorm = normalizeArabicLight(
        messages.filter(m => m.role === "system").map(m => typeof m.content === "string" ? m.content : "").join(" ")
      )

      // Detect compound queries — they may need MULTIPLE sources
      const isCompound = isCompoundFactQuery(userQuery)

      // Detect knowledge gaps: topics the local knowledge base doesn't cover
      const wivesQuery = ["زوج", "زوجة", "زوجات", "نكاح", "تزوج"].some(t => norm.includes(t))
      const contextMentionsAbbasWives = kCtxNorm.includes("تزوج العباس") || kCtxNorm.includes("زوجة العباس") || kCtxNorm.includes("زوجات العباس")
      const knowledgeGap = wivesQuery && !contextMentionsAbbasWives

      if (isCompound || knowledgeGap) {
        // Compound query or knowledge gap: DON'T suppress tool results.
        // The knowledge base covers part of the question, but tool results (news/articles)
        // may contain answers for the parts the knowledge base doesn't cover.
        console.log(`[Evidence Guard] Abbas biography — compound/gap query, combining knowledge + tool results`)

        // If tool results exist and might cover the gap, use them alongside knowledge
        if (extractedEvidence.length > 0) {
          injectToolEvidenceBlock(messages, userQuery, extractedEvidence)
        }

        // Deep content fetch: for knowledge gaps, the evidence might mention the topic
        // (e.g. title says "زوجة العباس") but the truncated snippet (150 chars) doesn't
        // contain the actual answer (e.g. the wife's name). Fetch the full article content
        // for the most relevant evidence item to give the LLM the complete text.
        if (knowledgeGap) {
          const gapKeywords = ["زوج", "زوجة", "زوجات", "تزوج", "نكح"]
          let fullContentFetched = false

          // Helper: fetch full article by ID and inject into messages
          const fetchAndInjectFullArticle = async (articleId: string, articleName: string, articleUrl: string): Promise<boolean> => {
            try {
              console.log(`[Evidence Guard] Fetching full article content for gap topic, id=${articleId}`)
              const fullArticle = await executeToolByName("get_content_by_id", { id: articleId, source: "articles_latest" })
              if (fullArticle.success && fullArticle.data) {
                const fullText = fullArticle.data.description || fullArticle.data.content || ""
                const fullName = fullArticle.data.name || articleName
                const fullUrl = fullArticle.data.url || articleUrl
                if (fullText.length > 0) {
                  const suppToolId = `deep_fetch_${Date.now()}`
                  messages.push({
                    role: "assistant",
                    content: null,
                    tool_calls: [{ id: suppToolId, type: "function" as const, function: { name: "get_content_by_id", arguments: JSON.stringify({ id: articleId }) } }]
                  })
                  messages.push({
                    role: "tool",
                    tool_call_id: suppToolId,
                    content: JSON.stringify({
                      success: true,
                      data: {
                        name: fullName,
                        description: typeof fullText === "string" ? fullText.substring(0, 2000) : fullText,
                        url: fullUrl
                      }
                    })
                  })
                  messages.push({
                    role: "system",
                    content: `📰 تم جلب النص الكامل للخبر "${fullName}". اقرأ محتواه بعناية واستخلص منه الإجابة عن الجزء المتعلق بالزوجة/الزواج. لا تعتذر عن عدم توفر المعلومة إذا كانت مذكورة في هذا الخبر.`
                  })
                  return true
                }
              }
            } catch (e) {
              console.log(`[Evidence Guard] Full article fetch failed:`, e)
            }
            return false
          }

          // Step 1: Check extracted evidence for gap-relevant articles
          const gapRelevantEvidence = extractedEvidence.filter(e => {
            const titleNorm = normalizeArabicLight(e.source_title)
            const quoteNorm = normalizeArabicLight(e.quote)
            return gapKeywords.some(k => titleNorm.includes(k) || quoteNorm.includes(k))
          })
          if (gapRelevantEvidence.length > 0) {
            const idMatch = gapRelevantEvidence[0].source_url.match(/[?&]id=(\d+)/)
            if (idMatch) {
              fullContentFetched = await fetchAndInjectFullArticle(idMatch[1], gapRelevantEvidence[0].source_title, gapRelevantEvidence[0].source_url)
            }
          }

          // Step 2: Check ALL raw tool result items (not just evidence) for gap-relevant articles
          if (!fullContentFetched) {
            const allToolItems = collectToolResultItems(messages as any[])
            const gapToolItem = allToolItems.find((item: any) => {
              const nameNorm = normalizeArabicLight(item?.name || "")
              return gapKeywords.some(k => nameNorm.includes(k)) && item?.id
            })
            if (gapToolItem) {
              fullContentFetched = await fetchAndInjectFullArticle(
                String(gapToolItem.id),
                gapToolItem.name || "",
                gapToolItem.url || ""
              )
            }
          }

          // Step 3: Targeted supplementary search specifically for the gap topic
          if (!fullContentFetched) {
            const gapSearchQuery = "زوجة أبي الفضل العباس"
            try {
              console.log(`[Evidence Guard] Supplementary targeted search for gap: "${gapSearchQuery}"`)
              const supplementaryResult = await executeToolByName("search_content", { query: gapSearchQuery, source: "auto" })
              // Check for results — even low-score results may have the article we need
              const rawResults = supplementaryResult?.data?.results || supplementaryResult?.data?.projects || supplementaryResult?.data?.items || []
              if (rawResults.length > 0) {
                const gapResult = rawResults.find((p: any) => {
                  const titleNorm = normalizeArabicLight(p.name || "")
                  return gapKeywords.some((k: string) => titleNorm.includes(k))
                }) || rawResults[0] // fallback to first result if none match by title
                if (gapResult?.id) {
                  fullContentFetched = await fetchAndInjectFullArticle(
                    String(gapResult.id),
                    gapResult.name || "",
                    gapResult.url || ""
                  )
                }
              }
            } catch (e) {
              console.log(`[Evidence Guard] Supplementary search failed:`, e)
            }
          }
        }

        // For compound/gap queries, we've combined knowledge + tool results + full article
        // Return evidence so the LLM can synthesize from all sources
        return extractedEvidence

      } else {
        // Simple biography query (not compound, no gap) — suppress tool results.
        // Abbas dataset IS the authoritative source for these facts.
        console.log(`[Evidence Guard] Abbas biography — simple query, suppressing tool results`)
        return knowledgeEvidence.length > 0 ? knowledgeEvidence : []
      }
    }

    // Non-biographical query (shrine activities, expansion, etc.) — inject tool evidence normally
    console.log(`[Evidence Guard] Abbas shrine/activity query — tool-result evidence allowed`)
    injectToolEvidenceBlock(messages, userQuery, extractedEvidence)
    return extractedEvidence
  }

  // Evidence guard: if the question demands hard facts and results lack them
  if (isHardEvidenceSensitive(userQuery)) {
    const allToolContent = messages
      .filter(m => m.role === "tool" || m.role === "system")
      .map(m => typeof m.content === "string" ? m.content : "")
      .join(" ")
    if (!hasStrongAnswerEvidence(allToolContent, userQuery)) {
      messages.push({
        role: "system",
        content: "⚠️ البيانات المسترجعة لا تحتوي على الأرقام أو التواريخ المطلوبة. أجب فقط بما هو موجود في النتائج. لا تذكر أي تاريخ أو عمر أو رقم من معرفتك العامة. إذا لم تجد المعلومة المحددة، قل: 'لم أجد هذه المعلومة في البيانات المتاحة حالياً'."
      })
    }
  }

  if (shouldPreferKnowledgeContext) {
    return knowledgeEvidence.length > 0 ? knowledgeEvidence : []
  }

  injectToolEvidenceBlock(messages, userQuery, extractedEvidence)
  return extractedEvidence
}

/**
 * Try to generate a direct template-based answer from evidence.
 *
 * Returns a string answer only when:
 *  - The query is a specific fact question AND a clear direct answer can be extracted
 *    (e.g., office holder name, yes/no project answer)
 *  - OR the top item has very high confidence (≥80%)
 *
 * For general/complex queries, returns null so the LLM synthesizes
 * a natural, intelligent answer using the system prompt and context.
 */
function tryGenerateDirectAnswer(query: string, evidence: Evidence[]): string | null {
  if (!evidence || evidence.length === 0) return null
  if (isCompoundFactQuery(query)) return null

  const understanding = understandQuery(query)
  if (understanding.operation_intent === "explain") return null

  // Only generate direct answers for very specific patterns where
  // we can confidently extract the exact answer (office holder, yes/no, etc.)
  const isFactIntent = understanding.operation_intent === "fact_question"
  if (isFactIntent && isOfficeHolderQuery(query)) {
    const generatedFact = generateDirectAnswer(query, evidence)
    if (generatedFact && directAnswerSatisfiesSensitiveQuery(query, generatedFact)) {
      return generatedFact.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim()
    }
  }

  // For all other queries, let the LLM synthesize an intelligent answer
  // using the improved system prompt + evidence context
  return null
}

function directAnswerSatisfiesSensitiveQuery(query: string, answer: string): boolean {
  if (!answer) return false

  if (isOfficeHolderQuery(query)) {
    return /(السيد|الشيخ|سماحه|سماحة|العلامه|العلامة)\s+[\u0621-\u064A]{2,}(?:\s+[\u0621-\u064A]{2,}){1,3}/u.test(answer)
  }

  const normAnswer = normalizeArabicLight(answer)
  const specificTokens = extractSpecificQueryTokens(query)
  if (specificTokens.length < 2) return true

  const matched = specificTokens.filter(token => normAnswer.includes(token)).length
  return matched >= Math.min(2, specificTokens.length)
}

/**
 * Detect if the user question is asking for hard-evidence facts
 * (dates, ages, numbers, specific historical facts) that must come from data.
 */
function isHardEvidenceSensitive(text: string): boolean {
  const norm = normalizeArabicLight(text)
  const dateAgePatterns = [
    "متي", "تاريخ استشهاد", "تاريخ ولاده", "تاريخ وفاه",
    "سنه استشهاد", "سنه ولاده", "سنه وفاه",
    "عمر", "كم عمر", "كم كان عمر",
    "في اي سنه", "في اي عام",
    "هجري", "ميلادي",
    "عدد ابناء", "عدد اولاد", "عدد زوجات",
    "متي ولد", "متي استشهد", "متي توفي",
  ]
  return dateAgePatterns.some(p => norm.includes(p))
}

/**
 * Check if the retrieved tool results contain strong evidence
 * (actual dates, numbers, biographical facts) for the query.
 */
function hasStrongAnswerEvidence(toolContent: string, query: string): boolean {
  if (!toolContent || toolContent.length < 30) return false
  const norm = normalizeArabicLight(query)
  // If asking about dates/years, look for year patterns or named events in content
  const asksDate = ["متي", "تاريخ", "سنه", "عام"].some(k => norm.includes(k))
  if (asksDate) {
    const hasYear = /\d{3,4}/.test(toolContent) || /[\u0660-\u0669]{3,4}/.test(toolContent)
    if (hasYear) return true
    // Named historical events count as date evidence (e.g., "يوم الطف" = 10 Muharram 61 AH)
    const eventNames = ["الطف", "كربلاء", "عاشوراء", "محرم", "شعبان"]
    if (eventNames.some(e => toolContent.includes(e))) return true
    // Written-out Arabic numbers count as date evidence (e.g., "ست وعشرين" = 26)
    const writtenNumbers = ["وعشرين", "وثلاثين", "واربعين", "وخمسين", "وستين", "سنه"]
    if (writtenNumbers.some(w => toolContent.includes(w))) return true
    return false
  }
  // If asking about age/count, look for numbers (digits or written-out Arabic)
  const asksNumber = ["عمر", "عدد", "كم"].some(k => norm.includes(k))
  if (asksNumber) {
    const hasNumber = /\d+/.test(toolContent) || /[\u0660-\u0669]+/.test(toolContent)
    if (hasNumber) return true
    // Written-out Arabic numbers (e.g., "أربعا وثلاثين سنة")
    const writtenNums = [
      "وعشرين", "وثلاثين", "واربعين", "وخمسين", "وستين",
      "عشر", "احد", "اثن", "ثلاث", "اربع", "خمس", "ست", "سبع", "ثمان", "تسع",
    ]
    if (writtenNums.some(w => toolContent.includes(w))) return true
    return hasNumber
  }
  // Generic: if content is substantial, it's evidence enough
  return toolContent.length > 100
}

function buildGroundedEvidenceFallback(query: string, evidence: Evidence[]): string | null {
  if (!evidence || evidence.length === 0) return null
  if (!evidenceCoversSpecificTokens(query, evidence)) return null
  if (isOfficeHolderQuery(query) && !evidenceContainsLikelyPersonName(evidence)) return null

  const topConfidence = evidence[0]?.confidence || 0
  const minimumConfidence = isHardEvidenceSensitive(query) ? 35 : 22
  if (topConfidence < minimumConfidence && evidence.length < 2) return null

  return formatGroundedAnswer(query, evidence.slice(0, 3))
}

export async function resolveToolCalls(
  openai: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  maxIterations: number = 3,
  options: { traceId?: string; queryUnderstanding?: QueryUnderstandingResult } = {}
): Promise<{
  resolvedMessages: ChatCompletionMessageParam[]
  needsFinalCall: boolean
  iterations: number
  directAnswer?: string
  fallbackAnswer?: string
  trace?: ResolveTraceSummary
}> {
  let currentMessages = [...messages]
  let iterations = 0
  let toolsWereCalled = false
  let orchestratorBootstrapped = false
  let groundedFallbackAnswer: string | undefined
  const retryCounter = { count: 0 }
  const traceSummary: ResolveTraceSummary = { retry_attempts: 0 }

  // Forced tool intent: deterministic routing for count/metadata/oldest only.
  const userQueryForIntent = getLastUserMessage(messages)
  const queryUnderstanding = options.queryUnderstanding || understandQuery(userQueryForIntent)
  const answerShapeInstruction = buildAnswerShapeInstruction(userQueryForIntent)
  if (answerShapeInstruction) {
    currentMessages.push({ role: "system", content: answerShapeInstruction })
  }
  const compoundCoverageInstruction = buildCompoundCoverageInstruction(userQueryForIntent)
  if (compoundCoverageInstruction) {
    currentMessages.push({ role: "system", content: compoundCoverageInstruction })
  }

  const forcedIntent = detectForcedUtilityIntent(
    userQueryForIntent,
    queryUnderstanding,
    isAbbasBiographyQuery
  )
  if (options.traceId) {
    logChatTrace({
      trace_id: options.traceId,
      stage: "intent_detected",
      normalized_query: normalizeQueryForTrace(userQueryForIntent),
      routed_source: forcedIntent?.args?.source,
      details: {
        forced_tool: forcedIntent?.tool || null
      }
    })
    logChatTrace({
      trace_id: options.traceId,
      stage: "query_understanding",
      normalized_query: queryUnderstanding.normalized_query,
      routed_source: queryUnderstanding.hinted_sources[0],
      details: {
        content_intent: queryUnderstanding.content_intent,
        operation_intent: queryUnderstanding.operation_intent,
        route_confidence: queryUnderstanding.route_confidence,
        extracted_entities: queryUnderstanding.extracted_entities
      }
    })
  }

  if (forcedIntent) {
    console.log(`[Tool Resolution] Forced intent: ${forcedIntent.tool}`, forcedIntent.args)
    if (options.traceId) {
      logChatTrace({
        trace_id: options.traceId,
        stage: "forced_intent_utility",
        normalized_query: normalizeQueryForTrace(userQueryForIntent),
        routed_source: forcedIntent.args?.source,
        details: {
          forced_tool: forcedIntent.tool
        }
      })
    }
    const forcedResult = await executeToolByName(forcedIntent.tool, forcedIntent.args)
    const cleanedForced = cleanResultForGPT(forcedResult)
    const syntheticToolCallId = `forced_${forcedIntent.tool}_${Date.now()}`
    currentMessages.push({
      role: "assistant",
      content: null,
      tool_calls: [{
        id: syntheticToolCallId,
        type: "function",
        function: { name: forcedIntent.tool, arguments: JSON.stringify(forcedIntent.args) }
      }]
    })
    // If forced-intent returned empty results, mark for knowledge override
    const isEmpty = forcedResult.success && isEmptyAPIResponse(forcedResult.data)
    const toolContent = isEmpty
      ? JSON.stringify({ success: false, empty_results: true, message: "لا توجد نتائج من هذا المصدر حالياً" })
      : JSON.stringify(cleanedForced)
    currentMessages.push({
      role: "tool",
      tool_call_id: syntheticToolCallId,
      content: toolContent
    })

    if (forcedIntent.tool === "get_latest_by_source" || forcedIntent.tool === "browse_source_page") {
      const deterministicList = buildDeterministicLatestListAnswer(
        forcedResult,
        String(forcedIntent.args?.source || "")
      )
      if (deterministicList) {
        return {
          resolvedMessages: currentMessages,
          needsFinalCall: false,
          iterations: 0,
          directAnswer: deterministicList,
          trace: {
            ...traceSummary,
            retry_attempts: retryCounter.count,
            routed_source: forcedIntent.args?.source,
            result_counts: getResultCountFromData(forcedResult.data),
            top_score: getTopScoreFromData(forcedResult.data)
          }
        }
      }
    }

    // Augment forced-intent results with deep-text knowledge + evidence guard
    const forcedEvidence = await injectKnowledgeAndGuard(
      currentMessages,
      userQueryForIntent,
      queryUnderstanding
    )

    // If a single high-confidence evidence item exists, return a direct grounded answer
    const forcedDirect = tryGenerateDirectAnswer(userQueryForIntent, forcedEvidence)
    if (forcedDirect) {
      console.log(`[Grounded Answer] Returning direct answer from forced-intent evidence`)
      return {
        resolvedMessages: currentMessages,
        needsFinalCall: false,
        iterations: 0,
        directAnswer: forcedDirect,
        trace: {
          ...traceSummary,
          retry_attempts: retryCounter.count,
          routed_source: forcedIntent.args?.source,
          result_counts: getResultCountFromData(forcedResult.data),
          top_score: getTopScoreFromData(forcedResult.data)
        }
      }
    }

    const forcedFallback = buildGroundedEvidenceFallback(userQueryForIntent, forcedEvidence)

    return {
      resolvedMessages: currentMessages,
      needsFinalCall: true,
      iterations: 0,
      fallbackAnswer: forcedFallback || groundedFallbackAnswer,
      trace: {
        ...traceSummary,
        retry_attempts: retryCounter.count,
        routed_source: forcedIntent.args?.source,
        result_counts: getResultCountFromData(forcedResult.data),
        top_score: getTopScoreFromData(forcedResult.data)
      }
    }
  }

  // Runtime takeover: for general retrieval-style questions,
  // orchestrator is the primary retrieval policy owner before LLM tool selection.
  if (looksLikeSiteContentQuery(userQueryForIntent)) {
    const primaryRetrievalTool = getPrimaryRetrievalToolForQuery(userQueryForIntent, queryUnderstanding)
    const orchestrated = await orchestrateRetrieval(
      primaryRetrievalTool,
      { query: userQueryForIntent, source: "auto" },
      {
        traceId: options.traceId,
        queryUnderstanding
      }
    )

    if (orchestrated) {
      if (options.traceId) {
        logChatTrace({
          trace_id: options.traceId,
          stage: "orchestrator_runtime_takeover",
          normalized_query: normalizeQueryForTrace(userQueryForIntent),
          routed_source: orchestrated.routedSource,
          retry_attempts: Math.max(0, orchestrated.attempts.length - 1),
          result_counts: orchestrated.resultCount,
          top_score: orchestrated.topScore,
          unavailable_reason: orchestrated.exhausted ? orchestrated.unavailableReason : undefined
        })
      }

      retryCounter.count += Math.max(0, orchestrated.attempts.length - 1)
      traceSummary.routed_source = orchestrated.routedSource || traceSummary.routed_source
      traceSummary.result_counts = orchestrated.resultCount
      traceSummary.top_score = orchestrated.topScore
      if (orchestrated.exhausted) {
        traceSummary.unavailable_reason = orchestrated.unavailableReason
      }

      const cleaned = cleanResultForGPT(orchestrated.finalResult)
      const syntheticToolCallId = `bootstrap_${primaryRetrievalTool}_${Date.now()}`
      const routedSourceForSynthetic = orchestrated.routedSource || "auto"

      currentMessages.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: syntheticToolCallId,
          type: "function",
          function: {
            name: primaryRetrievalTool,
            arguments: JSON.stringify({ query: userQueryForIntent, source: routedSourceForSynthetic })
          }
        }]
      })
      currentMessages.push({
        role: "tool",
        tool_call_id: syntheticToolCallId,
        content: JSON.stringify(cleaned)
      })

      const bootstrapEvidence = await injectKnowledgeAndGuard(currentMessages, userQueryForIntent, queryUnderstanding)
      const bootstrapDirect = tryGenerateDirectAnswer(userQueryForIntent, bootstrapEvidence)
      if (bootstrapDirect) {
        console.log(`[Grounded Answer] Returning direct answer from orchestrator bootstrap evidence`)
        return {
          resolvedMessages: currentMessages,
          needsFinalCall: false,
          iterations,
          directAnswer: bootstrapDirect,
          trace: {
            ...traceSummary,
            retry_attempts: retryCounter.count
          }
        }
      }
      groundedFallbackAnswer =
        buildGroundedEvidenceFallback(userQueryForIntent, bootstrapEvidence) ||
        groundedFallbackAnswer
      toolsWereCalled = true
      orchestratorBootstrapped = true
    }
  }

  while (iterations < maxIterations) {
    iterations++
    console.log(`[Tool Resolution] Iteration ${iterations}`)

    const toolsForIteration = orchestratorBootstrapped
      ? getPostBootstrapUtilityTools(tools)
      : tools

    const response = toolsForIteration.length > 0
      ? await openai.chat.completions.create({
          model,
          messages: currentMessages,
          tools: toolsForIteration,
          tool_choice: "auto",
          temperature: 0.2,
          max_tokens: 1200
        })
      : await openai.chat.completions.create({
          model,
          messages: currentMessages,
          temperature: 0.2,
          max_tokens: 1200
        })

    const assistantMessage = response.choices[0].message
    currentMessages.push(assistantMessage)

    // إذا لم يستدعِ أدوات
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      if (toolsWereCalled) {
        // ✅ أدوات استُدعيت سابقاً → حذف الرد غير المتدفق
        // route.ts سيعمل streaming حقيقي من OpenAI
        currentMessages.pop()
        console.log(`[Tool Resolution] Tools done, popped answer for streaming`)

        // Augment with knowledge search + evidence guard
        const loopEvidence = await injectKnowledgeAndGuard(
          currentMessages,
          userQueryForIntent,
          queryUnderstanding
        )

        // If a single high-confidence evidence item exists, return a direct grounded answer
        const loopDirect = tryGenerateDirectAnswer(userQueryForIntent, loopEvidence)
        if (loopDirect) {
          console.log(`[Grounded Answer] Returning direct answer from loop-iteration evidence`)
          return {
            resolvedMessages: currentMessages,
            needsFinalCall: false,
            iterations,
            directAnswer: loopDirect,
            trace: {
              ...traceSummary,
              retry_attempts: retryCounter.count
            }
          }
        }

        const loopFallback =
          buildGroundedEvidenceFallback(userQueryForIntent, loopEvidence) ||
          groundedFallbackAnswer

        return {
          resolvedMessages: currentMessages,
          needsFinalCall: true,
          iterations,
          fallbackAnswer: loopFallback,
          trace: {
            ...traceSummary,
            retry_attempts: retryCounter.count
          }
        }
      }

      // سؤال بسيط بدون أدوات → نرجعه كـ directAnswer
      return {
        resolvedMessages: currentMessages,
        needsFinalCall: false,
        iterations,
        directAnswer: assistantMessage.content || "",
        trace: {
          ...traceSummary,
          retry_attempts: retryCounter.count
        }
      }
    }

    // معالجة tool calls
    toolsWereCalled = true
    console.log(`[Tool Resolution] Processing ${assistantMessage.tool_calls.length} tool call(s)`)
    const toolResponses = await handleToolCalls(assistantMessage.tool_calls, {
      traceId: options.traceId,
      retryCounter,
      traceSummary,
      userQuery: userQueryForIntent,
      queryUnderstanding
    })
    currentMessages.push(...toolResponses)
  }

  // Max iterations reached — tools were processed, need streaming call
  // Final knowledge augmentation + evidence guard
  const finalEvidence = await injectKnowledgeAndGuard(
    currentMessages,
    userQueryForIntent,
    queryUnderstanding
  )

  // If a single high-confidence evidence item exists, return a direct grounded answer
  const finalDirect = tryGenerateDirectAnswer(userQueryForIntent, finalEvidence)
  if (finalDirect) {
    console.log(`[Grounded Answer] Returning direct answer from max-iteration evidence`)
    return {
      resolvedMessages: currentMessages,
      needsFinalCall: false,
      iterations,
      directAnswer: finalDirect,
      trace: {
        ...traceSummary,
        retry_attempts: retryCounter.count
      }
    }
  }

  const finalFallback =
    buildGroundedEvidenceFallback(userQueryForIntent, finalEvidence) ||
    groundedFallbackAnswer

  return {
    resolvedMessages: currentMessages,
    needsFinalCall: true,
    iterations,
    fallbackAnswer: finalFallback,
    trace: {
      ...traceSummary,
      retry_attempts: retryCounter.count,
      unavailable_reason: "no_high_confidence_evidence"
    }
  }
}

/**
 * [Legacy] تدفق كامل بدون streaming — يُستخدم كـ fallback
 */
export async function executeFunctionCallingFlow(
  openai: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  maxIterations: number = 3
): Promise<{
  finalMessage: string
  allMessages: ChatCompletionMessageParam[]
  iterations: number
}> {
  let currentMessages = [...messages]
  let iterations = 0
  let finalResponse = ""

  while (iterations < maxIterations) {
    iterations++

    const response = await openai.chat.completions.create({
      model,
      messages: currentMessages,
      tools,
      tool_choice: "auto",
      temperature: 0.5,
      max_tokens: 1200
    })

    const assistantMessage = response.choices[0].message
    currentMessages.push(assistantMessage)

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      finalResponse = assistantMessage.content || ""
      break
    }

    const toolResponses = await handleToolCalls(assistantMessage.tool_calls)
    currentMessages.push(...toolResponses)
  }

  if (!finalResponse && iterations >= maxIterations) {
    finalResponse = getFallbackResponse("api_error")
  }

  return {
    finalMessage: finalResponse,
    allMessages: currentMessages,
    iterations
  }
}

/**
 * تبسيط: معالجة سريعة لـ Function Call واحد فقط
 * (للحالات البسيطة)
 * 
 * @param openai - عميل OpenAI
 * @param model - نموذج OpenAI
 * @param messages - رسائل المحادثة
 * @param tools - الأدوات المتاحة
 */
export async function executeSimpleFunctionCall(
  openai: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[]
): Promise<string> {
  try {
    // استدعاء أول
    const firstResponse = await openai.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.7
    })

    const firstMessage = firstResponse.choices[0].message

    // إذا لم يكن هناك tool call، نرجع الرد مباشرة
    if (!firstMessage.tool_calls || firstMessage.tool_calls.length === 0) {
      return firstMessage.content || ""
    }

    // تنفيذ tool call
    const toolResponses = await handleToolCalls(firstMessage.tool_calls)

    // استدعاء ثاني مع نتائج الأدوات
    const secondResponse = await openai.chat.completions.create({
      model,
      messages: [
        ...messages,
        firstMessage,
        ...toolResponses
      ],
      temperature: 0.7
    })

    return secondResponse.choices[0].message.content || ""
  } catch (error: any) {
    console.error("[Simple Function Call] Error:", error)
    return getFallbackResponse("api_error")
  }
}
