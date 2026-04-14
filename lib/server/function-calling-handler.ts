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
  extractQueryFromMessage,
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
import {
  isFactQuery,
  isListQuery,
  detectCountSource,
} from "./query-understanding"
import {
  safeExecuteTool,
  isTransientError,
  getSourceFallbackMessage,
} from "./retrieval-orchestrator"

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

/**
 * Detect user intents that require a deterministic tool call
 * instead of letting the model freely choose (possibly wrong) tools.
 */

/**
 * Returns true only when the query is asking about Abbas's personal biography
 * (traits, titles, family, life, martyrdom) — NOT about shrine activities,
 * expansions, renovations, building/construction work, or shrine history.
 *
 * biography_vs_shrine_history fix: extended shrineActivityPatterns to include
 * shrine/mausoleum/history terms so they are not misclassified as biography.
 */
function isAbbasBiographyQuery(text: string): boolean {
  const norm = normalizeArabicLight(text)

  // If the query is about shrine construction/expansion/activities/history → NOT biographical
  const shrineActivityPatterns = [
    "توسعه", "توسعة", "بناء", "ترميم", "انشاء", "إنشاء", "قبه", "قبة",
    "رواق", "صحن", "بلاطه", "بلاطة", "مشروع", "مشاريع", "طابق",
    "تشييد", "اعمار", "اعمال", "عمل", "خدمه", "خدمة",
    "فعاليه", "فعاليات", "نشاط", "انشطه", "برنامج", "مناسبه",
    "زياره", "زيارة", "زائرين", "خبر", "اخبار",
    // Shrine history / location terms — not personal biography
    "ضريح", "مرقد", "حرم", "تاريخ العتبه", "تاريخ الضريح",
    "تاريخ المرقد", "مشاريع العتبه", "توسعه العتبه", "توسعة العتبه",
  ]
  if (shrineActivityPatterns.some(p => norm.includes(p))) return false

  // Biographical signals: personal traits, family, life events
  const biographyPatterns = [
    "لقب", "القاب", "كنيه", "كنية", "صفه", "صفات", "صفة",
    "من هو", "من هي", "ما هو", "ما هي", "سيره", "سيرة", "حياه", "حياة",
    "نشاه", "نشأة", "ولاده", "ولادة", "مولد",
    "ام ", "امه", "أمه", "ابيه", "ابوه", "اخوه", "اخواته", "اخت",
    "زوجه", "زوجة", "زوجات", "زواج", "ولد", "ابناء", "اولاد",
    "اعمام", "عمه", "عمته",
    "استشهاد", "شهاده", "شهادة", "مقتل", "متي استشهد",
    "موقفه", "قمر بني هاشم", "سقايه", "سقاية", "عمر سنه",
    "تعريف", "نبذه", "نبذة",
  ]
  if (biographyPatterns.some(p => norm.includes(p))) return true

  return false
}

function detectForcedToolIntent(userText: string): { tool: AllowedToolName; args: Record<string, any> } | null {
  const norm = normalizeArabicLight(userText)

  const newsHints = ["اخبار", "خبر", "مقال", "مقالات"]
  const videoHints = ["فيديو", "فديو", "فيديوهات", "مقاطع", "مرئي"]
  const wahyFridayHints = ["وحي الجمعه", "من وحي", "وحي"]
  const sermonHints = ["خطبه", "خطب", "جمعه", "خطيب", "منبر", "صلاه الجمعه", "صلاه جمعه"]
  const isNews = newsHints.some(h => norm.includes(h))
  const isVideo = videoHints.some(h => norm.includes(h))
  const isWahyFriday = wahyFridayHints.some(h => norm.includes(h))
  const isSermon = sermonHints.some(h => norm.includes(h))

  // 1. Source-specific count → get_source_metadata
  // But NOT for biographical queries like "عدد ألقاب العباس" — those go to knowledge layer
  // fact_vs_list_intent fix: use query-understanding to detect count/fact queries broadly,
  // then route to the correct metadata source including history and language.
  const countKeywords = ["عدد", "كم", "اجمالي", "كلي", "مجموع"]
  if (countKeywords.some(k => norm.includes(k)) && !isAbbasBiographyQuery(userText)) {
    if (isWahyFriday) return { tool: "get_source_metadata" as AllowedToolName, args: { source: "wahy_friday" } }
    if (isSermon) return { tool: "get_source_metadata" as AllowedToolName, args: { source: "friday_sermons" } }
    if (isNews && !isVideo) return { tool: "get_source_metadata" as AllowedToolName, args: { source: "articles_latest" } }
    if (isVideo && !isNews) return { tool: "get_source_metadata" as AllowedToolName, args: { source: "videos_latest" } }
    // fact_vs_list_intent: handle count queries for history and language sources
    const countSource = detectCountSource(userText)
    if (countSource === "shrine_history_sections") {
      return { tool: "get_source_metadata" as AllowedToolName, args: { source: "shrine_history_sections" } }
    }
    if (countSource === "lang_words_ar") {
      return { tool: "get_source_metadata" as AllowedToolName, args: { source: "lang_words_ar" } }
    }
  }

  // 1b. Existence / fact check ("هل يوجد …") → use search_content to verify existence
  // fact_vs_list_intent fix: route existence queries to search rather than list endpoints.
  if (isFactQuery(userText) && !isListQuery(userText) && !countKeywords.some(k => norm.includes(k))) {
    // For existence queries we still want real data, but from search not listing
    return { tool: "search_content" as AllowedToolName, args: { query: userText, source: "auto" } }
  }

  // 2. Metadata / descriptive info → get_source_metadata
  const metaKeywords = ["معلومات وصفيه", "وصفي", "ميتاداتا"]
  if (metaKeywords.some(k => norm.includes(k))) {
    if (isNews || (!isVideo && norm.includes("مصدر"))) return { tool: "get_source_metadata" as AllowedToolName, args: { source: "articles_latest" } }
    if (isVideo) return { tool: "get_source_metadata" as AllowedToolName, args: { source: "videos_latest" } }
  }

  // 3. Oldest / first → browse_source_page with order=oldest
  const oldestKeywords = ["اول", "اقدم", "oldest", "first"]
  if (oldestKeywords.some(k => norm.includes(k))) {
    if (isWahyFriday) return { tool: "browse_source_page" as AllowedToolName, args: { source: "wahy_friday", page: 1, order: "oldest" } }
    if (isSermon) return { tool: "browse_source_page" as AllowedToolName, args: { source: "friday_sermons", page: 1, order: "oldest" } }
    if (isVideo && !isNews) return { tool: "browse_source_page" as AllowedToolName, args: { source: "videos_latest", page: 1, order: "oldest" } }
    if (isNews || norm.includes("نشر") || norm.includes("موقع")) {
      return { tool: "browse_source_page" as AllowedToolName, args: { source: "articles_latest", page: 1, order: "oldest" } }
    }
  }

  // 4. Abbas biography → force search_content with source=auto to trigger knowledge layer
  const abbasHints = ["العباس", "ابو الفضل", "ابا الفضل", "ابوالفضل", "ابي الفضل", "قمر بني هاشم"]
  const bioHints = [
    "نبذه", "حياه", "سيره", "من هو", "من هي", "تعريف", "استشهد", "استشهاد",
    "القاب", "صفات", "اخو", "اخوات", "زواج", "كنيه", "نشا", "ولاد", "مولد",
    "عمر", "متي", "اين", "دفن", "قبر", "ماذا", "ما هو", "ما هي", "يذكر", "عن",
    "اعمام", "ابناء", "اولاد", "موقف",
  ]
  if (abbasHints.some(h => norm.includes(h)) && bioHints.some(h => norm.includes(h))) {
    return { tool: "search_content" as AllowedToolName, args: { query: userText, source: "auto" } }
  }
  // Even standalone Abbas queries in short form should go through knowledge layer
  if (abbasHints.some(h => norm.includes(h)) && norm.length < 40) {
    return { tool: "search_content" as AllowedToolName, args: { query: userText, source: "auto" } }
  }

  // 5. Friday sermons — route to correct source family
  // wahy_vs_friday_sermon fix: explicitly check wahy before sermon so that
  // "من وحي الجمعة" (wahy) is not confused with "خطبة الجمعة" (sermon).
  const wahyHints2 = ["وحي الجمعه", "من وحي", "وحي"]
  const sermonHints2 = ["خطبه", "خطب", "خطيب", "منبر", "صلاه الجمعه", "صلاه جمعه"]
  // "جمعه" alone maps to sermon by default (Friday prayer/sermon context).
  // It only maps to wahy when "وحي" is also present (wahy takes priority).
  const isWahy2 = wahyHints2.some(h => norm.includes(h))
  const isSermon2 = sermonHints2.some(h => norm.includes(h)) ||
    (norm.includes("جمعه") && !isWahy2)
  const isLatestIntent = ["احدث", "اخر", "جديد", "اخير"].some(h => norm.includes(h))
  if (isWahy2) {
    if (isLatestIntent) {
      return { tool: "get_latest_by_source" as AllowedToolName, args: { source: "wahy_friday", limit: 5 } }
    }
    return { tool: "search_content" as AllowedToolName, args: { query: userText, source: "wahy_friday" } }
  }
  if (isSermon2) {
    if (isLatestIntent) {
      return { tool: "get_latest_by_source" as AllowedToolName, args: { source: "friday_sermons", limit: 5 } }
    }
    return { tool: "search_content" as AllowedToolName, args: { query: userText, source: "friday_sermons" } }
  }

  // 6. Fallback: any non-trivial query that hasn't matched above
  // → force search_content so the LLM always has real data before answering.
  // This catches bare names ("السيد أحمد الصافي"), topics, etc.
  // Skip only very short single-word greetings.
  const isGreeting = ["مرحبا", "اهلا", "هلا", "السلام", "شكرا", "شكر"].some(g => norm === g || norm === g + "ً")
  if (!isGreeting && norm.length >= 4) {
    return { tool: "search_content" as AllowedToolName, args: { query: userText, source: "auto" } }
  }

  return null
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
        query: data.query,
        source_used: data.source_used ? friendlySourceName(data.source_used) : undefined,
        candidate_sources: data.candidate_sources,
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
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall
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

  // تنفيذ الأداة
  const result: APICallResult = await executeToolByName(
    toolName as AllowedToolName,
    args
  )

  // ✅ Phase 3: معالجة النتائج الفارغة مع اقتراحات ذكية
  if (result.success && isEmptyAPIResponse(result.data)) {
    console.log(`[Function Call] Empty results detected, generating suggestions`)
    
    // استخرج query من المعاملات
    const query = args.query || args.searchTerm || args.keyword || ""
    const category = args.category || undefined
    
    // توليد الاقتراحات الذكية
    const suggestionsResponse = generateNoResultsSuggestions(query, {
      searchedCategory: category,
      attemptedAction: toolName
    })
    
    // إرجاع النتيجة مع الاقتراحات
    return {
      tool_call_id: toolCallId,
      role: "tool",
      content: JSON.stringify({
        success: false,
        empty_results: true,
        message: suggestionsResponse.message,
        suggestions: suggestionsResponse.suggestions,
        context: suggestionsResponse.context,
        original_query: query
      })
    }
  }

  // معالجة الأخطاء مع اقتراحات
  if (!result.success) {
    console.error(`[Function Call] API Error:`, result.error)
    
    const errorSuggestions = generateAPIErrorSuggestions()
    
    return {
      tool_call_id: toolCallId,
      role: "tool",
      content: JSON.stringify({
        success: false,
        error: result.error,
        message: errorSuggestions.message,
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
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
): Promise<ChatCompletionMessageParam[]> {
  const toolResponses: ChatCompletionMessageParam[] = []

  // معالجة كل أداة
  for (const toolCall of toolCalls) {
    const response = await processToolCall(toolCall)
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

/** Extract the last user message text from a messages array */
function getLastUserMessage(messages: ChatCompletionMessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "user") {
      if (typeof m.content === "string") return m.content
      if (Array.isArray(m.content)) {
        const textPart = m.content.find((p: any) => p.type === "text")
        if (textPart && "text" in textPart) return textPart.text
      }
    }
  }
  return ""
}

/** Detect whether a user message is asking about site content (news, videos, history, etc.) */
function looksLikeSiteContentQuery(text: string): boolean {
  if (!text || text.trim().length < 4) return false
  const norm = text.trim().toLowerCase()

  // Skip short greetings / trivial chat
  const greetings = ["مرحبا", "اهلا", "سلام", "هلا", "hi", "hello", "hey", "شكرا", "thanks"]
  if (greetings.some(g => norm === g || norm === g + "!")) return false

  // Positive signals: keywords that suggest site-content retrieval
  const contentSignals = [
    "خبر", "اخبار", "مقال", "مقالات", "فيديو", "فديو", "تاريخ",
    "العتبه", "العباس", "الكفيل", "عتبه", "عباس",
    "قاموس", "ترجم", "كلم", "مصطلح",
    "اقسام", "تصنيف", "فئ",
    "احدث", "اخر", "جديد",
    "ابحث", "بحث", "اريد", "اعرف", "عايز",
    "ماهو", "ماهي", "ما هو", "ما هي", "ماذا",
    "شنو", "شنهو", "شكد",
    "زيار", "حرم", "صحن", "ضريح", "مرقد",
    "مشروع", "مشاريع", "المشاريع",
    "خطبه", "خطب", "جمعه", "وحي", "خطيب", "منبر"
  ]

  return contentSignals.some(signal => norm.includes(signal))
    // Long Arabic text without question marks → likely a title paste or direct content query
    || (text.trim().length >= 25 && !text.includes("?") && !text.includes("\u061F"))
}

// ── Knowledge layer helpers ─────────────────────────────────────────

/**
 * Determine whether the user query benefits from the knowledge layer
 * (full-text deep search). Skip for trivial / deterministic queries
 * like counts, metadata, categories, latest/oldest listings.
 */
function shouldUseKnowledgeLayer(text: string): boolean {
  const norm = normalizeArabicLight(text)

  // Abbas biographical queries always use the knowledge layer —
  // even when "عدد/كم" is present (e.g. "عدد ألقاب أبو الفضل" is biographical, not a count of API items)
  if (isAbbasBiographyQuery(text)) return true

  // Skip: counts, metadata, category listing, latest/oldest
  const skipPatterns = [
    "عدد", "كم", "اجمالي", "كلي", "مجموع",        // counts
    "ميتاداتا", "وصفي", "معلومات وصفيه",            // metadata
    "اقسام الفيديو", "تصنيفات", "فئات",             // category listing
    "احدث خبر", "اخر خبر", "اخر فيديو",             // latest
    "اول خبر", "اقدم خبر", "اول فيديو",             // oldest
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
async function getKnowledgeContext(query: string): Promise<{ context: string; topScore: number } | null> {
  try {
    await ensureKnowledgeReady()
    const response = await searchKnowledgeWithBackfill(query, { limit: 4, minScore: 1.5 })
    if (response.chunks.length === 0) {
      console.log(`[Knowledge] No chunks for: "${query}"${response.backfilled ? " (after backfill)" : ""}`)
      return null
    }
    const topScore = response.chunks[0].score
    console.log(`[Knowledge] Found ${response.chunks.length} chunks (scores: ${response.chunks.map(c => c.score.toFixed(1)).join(",")})${response.backfilled ? " [backfilled]" : ""}` )
    return { context: formatKnowledgeResults(response.chunks), topScore }
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
function injectToolResultEvidence(
  messages: ChatCompletionMessageParam[],
  userQuery: string
): Evidence[] {
  const allItems = collectToolResultItems(messages as any[])
  if (allItems.length === 0) return []

  const evidence = extractEvidenceFromToolResults(allItems, userQuery, 3)
  if (evidence.length === 0) return []

  const topConfidence = evidence[0]?.confidence ?? 0
  console.log(`[Evidence] ${evidence.length} items, top confidence: ${topConfidence}%`)

  // High confidence (≥40%) → mandatory quote instruction, forces model to cite
  // Low confidence → soft suggestion only
  const block = topConfidence >= 40
    ? buildMandatoryInstruction(evidence)
    : formatEvidenceForModel(evidence)

  if (block) {
    messages.push({ role: "system", content: block })
  }

  return evidence
}

/**
 * Inject knowledge context + evidence guard into the message array.
 * Returns the extracted tool-result evidence list for use by the caller.
 */
async function injectKnowledgeAndGuard(
  messages: ChatCompletionMessageParam[],
  userQuery: string
): Promise<Evidence[]> {
  // Only use knowledge layer for qualifying queries
  let abbasKnowledgeInjected = false
  if (shouldUseKnowledgeLayer(userQuery)) {
    const kResult = await getKnowledgeContext(userQuery)
    if (kResult) {
      const { context: kCtx, topScore } = kResult
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
      } else {
        // Normal injection: add as supplementary system context
        messages.push({ role: "system", content: kCtx })
      }
    }
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
      // Check if the knowledge context actually covers the specific sub-topic asked about.
      // If the context doesn't mention the key concept (e.g. wives, children), allow
      // the LLM to answer from general knowledge rather than saying "not found".
      const norm = normalizeArabicLight(userQuery)
      const kCtxNorm = normalizeArabicLight(
        messages.filter(m => m.role === "system").map(m => typeof m.content === "string" ? m.content : "").join(" ")
      )
      // Topics the local knowledge base is known to NOT cover for Abbas himself
      const wivesQuery = ["زوج", "زوجة", "زوجات", "نكاح", "تزوج"].some(t => norm.includes(t))
      const contextMentionsAbbasWives = kCtxNorm.includes("تزوج العباس") || kCtxNorm.includes("زوجة العباس") || kCtxNorm.includes("زوجات العباس")
      const knowledgeGap = wivesQuery && !contextMentionsAbbasWives

      if (knowledgeGap) {
        // Knowledge base doesn't cover this topic — let LLM use general historical knowledge
        console.log(`[Evidence Guard] Abbas biography — knowledge gap detected, permitting general knowledge`)
        messages.push({
          role: "system",
          content: "ℹ️ السياق المعرفي المحلي لا يتضمن معلومات عن هذا الجانب تحديداً. أجب من معرفتك التاريخية الموثوقة عن الإمام أبي الفضل العباس (عليه السلام). تجاهل نتائج الأدوات المرتبطة بأخبار الضريح — هي غير ذات صلة."
        })
        return []
      }

      console.log(`[Evidence Guard] Abbas biography query — suppressing tool-result evidence`)
      messages.push({
        role: "system",
        content: "📚 تعليمات: أجب عن هذا السؤال البيوغرافي من المعلومات الواردة في [سياق معرفي إضافي من النصوص الكاملة] أعلاه. تجاهل نتائج الأدوات المرتبطة بأخبار الضريح أو الأنشطة — هي غير ذات صلة بهذا السؤال."
      })
      return []
    }
    // Non-biographical query (shrine activities, expansion, etc.) — inject tool evidence normally
    console.log(`[Evidence Guard] Abbas shrine/activity query — tool-result evidence allowed`)
    const ev = injectToolResultEvidence(messages, userQuery)
    return ev
  }

  // Extract evidence from tool results for grounded quoting
  const extractedEvidence = injectToolResultEvidence(messages, userQuery)

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

  return extractedEvidence
}

/**
 * Try to generate a direct template-based answer from evidence.
 *
 * Returns a string answer only when:
 *  - There is exactly 1 top-confidence evidence item (≥75%) → specific article lookup
 *  - OR the top item has ≥85% confidence regardless of count
 *
 * This bypasses the final LLM streaming call for focused single-result queries.
 * For general multi-result searches (confidence < 75%), returns null so the LLM
 * synthesises the answer with the mandatory-quote instruction already injected.
 */
function tryGenerateDirectAnswer(query: string, evidence: Evidence[]): string | null {
  if (!evidence || evidence.length === 0) return null

  const top = evidence[0]
  // Single high-confidence match (title-query hit on a specific article)
  const isSingleHighConf = evidence.length === 1 && top.confidence >= 40
  // Or high confidence regardless of count
  const isExtremeConf = top.confidence >= 55

  if (!isSingleHighConf && !isExtremeConf) return null

  return generateDirectAnswer(query, evidence)
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

export async function resolveToolCalls(
  openai: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  maxIterations: number = 3
): Promise<{
  resolvedMessages: ChatCompletionMessageParam[]
  needsFinalCall: boolean
  iterations: number
  directAnswer?: string
}> {
  let currentMessages = [...messages]
  let iterations = 0
  let toolsWereCalled = false
  let retrievalForced = false

  // Forced tool intent: deterministic routing for count/metadata/oldest/biography queries
  const userQueryForIntent = getLastUserMessage(messages)
  const forcedIntent = detectForcedToolIntent(userQueryForIntent)
  if (forcedIntent) {
    console.log(`[Tool Resolution] Forced intent: ${forcedIntent.tool}`, forcedIntent.args)

    // biography_vs_shrine_history fix: wrap entire forced-intent execution in try/catch
    // so that any unexpected error (knowledge layer, evidence extractor, etc.) is caught
    // and converted to a graceful directAnswer instead of propagating as HTTP 500.
    try {
      // wahy_vs_friday_sermon fix: use safeExecuteTool (never throws) and detect
      // transient errors early to avoid the 30 s × 2 retry cascade.
      const forcedResult = await safeExecuteTool(forcedIntent.tool, forcedIntent.args)

      // If the API timed-out or had a connectivity failure, return a user-friendly
      // message immediately — do NOT fall through to the full LLM pipeline which
      // would add another 30–60 s to the round-trip.
      if (isTransientError(forcedResult)) {
        const source = forcedIntent.args?.source as string | undefined
        const fallback = getSourceFallbackMessage(source)
        console.warn(`[Tool Resolution] Transient error for "${forcedIntent.tool}" (${source}) — returning fallback message`)
        return {
          resolvedMessages: currentMessages,
          needsFinalCall: false,
          iterations: 0,
          directAnswer: fallback,
        }
      }

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

      // Augment forced-intent results with deep-text knowledge + evidence guard
      const forcedEvidence = await injectKnowledgeAndGuard(currentMessages, userQueryForIntent)

      // If a single high-confidence evidence item exists, return a direct grounded answer
      const forcedDirect = tryGenerateDirectAnswer(userQueryForIntent, forcedEvidence)
      if (forcedDirect) {
        console.log(`[Grounded Answer] Returning direct answer from forced-intent evidence`)
        return {
          resolvedMessages: currentMessages,
          needsFinalCall: false,
          iterations: 0,
          directAnswer: forcedDirect
        }
      }

      return {
        resolvedMessages: currentMessages,
        needsFinalCall: true,
        iterations: 0
      }
    } catch (forcedErr: any) {
      // biography_vs_shrine_history fix: catch any unexpected exception in the forced path
      // (e.g. from knowledge layer or evidence extractor) and return a graceful fallback.
      console.error(`[Tool Resolution] Unexpected error in forced-intent path for "${forcedIntent.tool}":`, forcedErr?.message || forcedErr)
      const source = forcedIntent.args?.source as string | undefined
      const fallback = getSourceFallbackMessage(source)
      return {
        resolvedMessages: currentMessages,
        needsFinalCall: false,
        iterations: 0,
        directAnswer: fallback,
      }
    }
  }

  while (iterations < maxIterations) {
    iterations++
    console.log(`[Tool Resolution] Iteration ${iterations}`)

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

    // إذا لم يستدعِ أدوات
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      if (toolsWereCalled) {
        // ✅ أدوات استُدعيت سابقاً → حذف الرد غير المتدفق
        // route.ts سيعمل streaming حقيقي من OpenAI
        currentMessages.pop()
        console.log(`[Tool Resolution] Tools done, popped answer for streaming`)

        // Augment with knowledge search + evidence guard
        const loopEvidence = await injectKnowledgeAndGuard(currentMessages, userQueryForIntent)

        // If a single high-confidence evidence item exists, return a direct grounded answer
        const loopDirect = tryGenerateDirectAnswer(userQueryForIntent, loopEvidence)
        if (loopDirect) {
          console.log(`[Grounded Answer] Returning direct answer from loop-iteration evidence`)
          return {
            resolvedMessages: currentMessages,
            needsFinalCall: false,
            iterations,
            directAnswer: loopDirect
          }
        }

        return {
          resolvedMessages: currentMessages,
          needsFinalCall: true,
          iterations
        }
      }

      // ✅ Retrieval-first safety: if no tools were called yet and the user
      // is asking about site content, force one search_content call
      const userQuery = getLastUserMessage(messages)
      if (!retrievalForced && looksLikeSiteContentQuery(userQuery)) {
        retrievalForced = true
        console.log(`[Tool Resolution] Forcing retrieval for site-content query`)

        // Remove the direct answer so we can retry with tool results
        currentMessages.pop()

        // Build a synthetic search_content tool call result
        const forcedResult = await executeToolByName("search_content" as AllowedToolName, {
          query: userQuery,
          source: "auto"
        })

        const cleanedForced = cleanResultForGPT(forcedResult)

        // Inject as if assistant called search_content and got a result
        const syntheticToolCallId = `forced_search_${Date.now()}`
        currentMessages.push({
          role: "assistant",
          content: null,
          tool_calls: [{
            id: syntheticToolCallId,
            type: "function",
            function: { name: "search_content", arguments: JSON.stringify({ query: userQuery, source: "auto" }) }
          }]
        })
        currentMessages.push({
          role: "tool",
          tool_call_id: syntheticToolCallId,
          content: JSON.stringify(cleanedForced)
        })

        // Also inject deep-text knowledge + evidence guard
        await injectKnowledgeAndGuard(currentMessages, userQuery)

        toolsWereCalled = true
        // Continue the loop — OpenAI will now see the search results
        continue
      }

      // سؤال بسيط بدون أدوات → نرجعه كـ directAnswer
      return {
        resolvedMessages: currentMessages,
        needsFinalCall: false,
        iterations,
        directAnswer: assistantMessage.content || ""
      }
    }

    // معالجة tool calls
    toolsWereCalled = true
    console.log(`[Tool Resolution] Processing ${assistantMessage.tool_calls.length} tool call(s)`)
    const toolResponses = await handleToolCalls(assistantMessage.tool_calls)
    currentMessages.push(...toolResponses)
  }

  // Max iterations reached — tools were processed, need streaming call
  // Final knowledge augmentation + evidence guard
  const finalEvidence = await injectKnowledgeAndGuard(currentMessages, userQueryForIntent)

  // If a single high-confidence evidence item exists, return a direct grounded answer
  const finalDirect = tryGenerateDirectAnswer(userQueryForIntent, finalEvidence)
  if (finalDirect) {
    console.log(`[Grounded Answer] Returning direct answer from max-iteration evidence`)
    return {
      resolvedMessages: currentMessages,
      needsFinalCall: false,
      iterations,
      directAnswer: finalDirect
    }
  }

  return {
    resolvedMessages: currentMessages,
    needsFinalCall: true,
    iterations
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
