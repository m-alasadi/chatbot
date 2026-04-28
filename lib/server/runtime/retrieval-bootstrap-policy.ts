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
  const greetings = ["Ù…Ø±Ø­Ø¨Ø§", "Ø§Ù‡Ù„Ø§", "Ø³Ù„Ø§Ù…", "Ù‡Ù„Ø§", "hi", "hello", "hey", "Ø´ÙƒØ±Ø§", "thanks"]
  if (greetings.some(g => norm === g || norm === g + "!")) return false

  // Positive signals: keywords that suggest site-content retrieval.
  const contentSignals = [
    "Ø®Ø¨Ø±", "Ø§Ø®Ø¨Ø§Ø±", "Ù…Ù‚Ø§Ù„", "Ù…Ù‚Ø§Ù„Ø§Øª", "ÙÙŠØ¯ÙŠÙˆ", "ÙØ¯ÙŠÙˆ", "ØªØ§Ø±ÙŠØ®",
    "Ø§Ù„Ø¹ØªØ¨Ù‡", "Ø§Ù„Ø¹Ø¨Ø§Ø³", "Ø§Ù„ÙƒÙÙŠÙ„", "Ø¹ØªØ¨Ù‡", "Ø¹Ø¨Ø§Ø³",
    "Ù‚Ø§Ù…ÙˆØ³", "ØªØ±Ø¬Ù…", "ÙƒÙ„Ù…", "Ù…ØµØ·Ù„Ø­",
    "Ø§Ù‚Ø³Ø§Ù…", "ØªØµÙ†ÙŠÙ", "ÙØ¦",
    "Ø§Ø­Ø¯Ø«", "Ø§Ø®Ø±", "Ø¬Ø¯ÙŠØ¯",
    "Ø§Ø¨Ø­Ø«", "Ø¨Ø­Ø«", "Ø§Ø±ÙŠØ¯", "Ø§Ø¹Ø±Ù", "Ø¹Ø§ÙŠØ²",
    "Ù…Ø§Ù‡Ùˆ", "Ù…Ø§Ù‡ÙŠ", "Ù…Ø§ Ù‡Ùˆ", "Ù…Ø§ Ù‡ÙŠ", "Ù…Ø§Ø°Ø§",
    "Ø´Ù†Ùˆ", "Ø´Ù†Ù‡Ùˆ", "Ø´ÙƒØ¯",
    "Ø²ÙŠØ§Ø±", "Ø­Ø±Ù…", "ØµØ­Ù†", "Ø¶Ø±ÙŠØ­", "Ù…Ø±Ù‚Ø¯",
    "Ù…Ø´Ø±ÙˆØ¹", "Ù…Ø´Ø§Ø±ÙŠØ¹", "Ø§Ù„Ù…Ø´Ø§Ø±ÙŠØ¹",
    "Ø®Ø·Ø¨Ù‡", "Ø®Ø·Ø¨", "Ø¬Ù…Ø¹Ù‡", "ÙˆØ­ÙŠ", "Ø®Ø·ÙŠØ¨", "Ù…Ù†Ø¨Ø±"
  ]

  return contentSignals.some(signal => norm.includes(signal))
    || (text.trim().length >= 25 && !text.includes("?") && !text.includes("\u061F"))
}

/**
 * Choose the primary retrieval tool for orchestrator bootstrap.
 * Aggregate project requests use `search_projects`, but singular factual
 * questions should stay on the broader content surface because many project
 * mentions live inside articles and videos rather than the canonical project API.
 */
export function getPrimaryRetrievalToolForQuery(
  text: string,
  understanding?: QueryUnderstandingResult
): AllowedToolName {
  const norm = normalizeArabicLight(text)
  const projectSignals = [
    "Ù…Ø´Ø±ÙˆØ¹", "Ù…Ø´Ø§Ø±ÙŠØ¹", "Ø§Ù„Ù…Ø´Ø§Ø±ÙŠØ¹", "Ø§Ù†Ø¬Ø§Ø²", "Ø§Ù†Ø¬Ø§Ø²Ø§Øª", "Ø§Ø¹Ù…Ø§Ø±", "ØªÙˆØ³Ø¹Ù‡", "ØªÙˆØ³Ø¹Ø©", "Ø®Ø¯Ù…ÙŠ"
  ]
  const isProjectQuery =
    understanding?.extracted_entities.source_specific.includes("projects_query") ||
    projectSignals.some(signal => norm.includes(signal))
  const asksProjectCount =
    understanding?.operation_intent === "count" ||
    norm.includes(normalizeArabicLight("ÙƒÙ…")) ||
    norm.includes(normalizeArabicLight("Ø¹Ø¯Ø¯"))
  const aggregateProjectIntents = new Set([
    "count",
    "list_items",
    "latest",
    "summarize"
  ])
  const singularProjectLookupSignals = [
    "Ù‡Ù„",
    "ÙŠÙˆØ¬Ø¯",
    "Ù…Ø§ Ù‡Ùˆ",
    "Ù…Ø§ Ù‡ÙŠ",
    "Ø¯Ø¬Ø§Ø¬",
    "Ø¯ÙˆØ§Ø¬Ù†",
    "Ù„Ø­ÙˆÙ…",
    "Ø§Ù„Ù„Ø­ÙˆÙ…",
    "ØºØ°Ø§Ø¦ÙŠ",
    "Ø§Ù†ØªØ§Ø¬",
    "Ø¥Ù†ØªØ§Ø¬",
    "Ø²Ø±Ø§Ø¹ÙŠ",
    "ØªØ±Ø¨ÙŠØ©"
  ]
  const isAggregateProjectIntent = aggregateProjectIntents.has(String(understanding?.operation_intent || ""))
  const isSingularProjectLookup =
    understanding?.operation_intent === "fact_question" ||
    understanding?.operation_intent === "direct_answer" ||
    singularProjectLookupSignals.some(signal => norm.includes(normalizeArabicLight(signal)))

  if (isProjectQuery && (asksProjectCount || isAggregateProjectIntent) && !isSingularProjectLookup) {
    return "search_projects"
  }

  if (isProjectQuery && isSingularProjectLookup) {
    return "search_content"
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
