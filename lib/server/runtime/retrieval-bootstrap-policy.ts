import OpenAI from "openai"
import { type AllowedToolName } from "../site-tools-definitions"
import { type QueryUnderstandingResult } from "../query-understanding"

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

export function looksLikeSiteContentQuery(text: string): boolean {
  if (!text || text.trim().length < 4) return false
  const norm = text.trim().toLowerCase()

  // Skip short greetings / trivial chat.
  const greetings = ["مرحبا", "اهلا", "سلام", "هلا", "hi", "hello", "hey", "شكرا", "thanks"]
  if (greetings.some(g => norm === g || norm === g + "!")) return false

  // Positive signals: keywords that suggest site-content retrieval.
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
    // Long Arabic text without question marks → likely a title paste or direct content query.
    || (text.trim().length >= 25 && !text.includes("?") && !text.includes("\u061F"))
}

/**
 * Choose the primary retrieval tool for orchestrator bootstrap.
 * Project-style requests should use search_projects only for aggregate count intents.
 */
export function getPrimaryRetrievalToolForQuery(
  text: string,
  understanding?: QueryUnderstandingResult
): AllowedToolName {
  const norm = normalizeArabicLight(text)
  const projectSignals = [
    "مشروع", "مشاريع", "المشاريع", "انجاز", "انجازات", "اعمار", "توسعه", "توسعة", "خدمي"
  ]
  const isProjectQuery =
    understanding?.extracted_entities.source_specific.includes("projects_query") ||
    projectSignals.some(signal => norm.includes(signal))
  const asksProjectCount =
    understanding?.operation_intent === "count" ||
    norm.includes(normalizeArabicLight("كم")) ||
    norm.includes(normalizeArabicLight("عدد"))
  const projectDomainIntents = new Set([
    "count",
    "list_items",
    "latest",
    "fact_question",
    "direct_answer",
    "summarize"
  ])
  const isProjectDomainIntent = projectDomainIntents.has(String(understanding?.operation_intent || ""))

  // Project-domain requests should use the project retrieval surface by default.
  if (isProjectQuery && (asksProjectCount || isProjectDomainIntent)) {
    return "search_projects"
  }
  return "search_content"
}

/**
 * After orchestrator bootstrap, keep model tool access limited to
 * deterministic utility/non-retrieval tools to prevent policy re-expansion.
 */
export function getPostBootstrapTools(
  tools: OpenAI.Chat.Completions.ChatCompletionTool[]
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const allowedUtilityTools = new Set([
    "get_source_metadata",
    "browse_source_page",
    "get_latest_by_source",
    "list_source_categories",
    "get_statistics"
  ])

  return tools.filter(tool => {
    if (tool.type !== "function") return true
    const name = tool.function?.name
    return typeof name === "string" && allowedUtilityTools.has(name)
  })
}
