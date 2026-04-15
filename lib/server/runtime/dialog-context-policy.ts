import { ChatCompletionMessageParam } from "openai/resources/chat/completions"
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

export function getLastUserMessage(messages: ChatCompletionMessageParam[]): string {
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

export function hasPriorAssistantContext(messages: ChatCompletionMessageParam[]): boolean {
  return messages.some(m => m.role === "assistant")
}

export function getLastAssistantText(messages: ChatCompletionMessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== "assistant") continue
    if (typeof m.content === "string") return m.content
    if (Array.isArray(m.content)) {
      const contentParts = m.content as any[]
      const textPart = contentParts.find((p: any) => p?.type === "text")
      if (textPart && "text" in textPart) return textPart.text
    }
  }
  return ""
}

export function extractFirstListedTitle(text: string): string {
  const raw = String(text || "")
  const m = raw.match(/(?:^|\n)\s*1\.\s*(.+)/)
  if (!m) return ""
  return String(m[1] || "").replace(/\s+/g, " ").trim()
}

export function isContextualFollowUpQuery(
  text: string,
  understanding?: QueryUnderstandingResult
): boolean {
  const norm = normalizeArabicLight(text)
  const operation = understanding?.operation_intent
  const refersToPriorResult = [
    "اول نتيجه", "أول نتيجة", "النتيجه التي ذكرتها", "الخبر الذي ذكرته", "التي ذكرتها", "الذي ذكرته",
    "هذا الخبر", "هذه النتيجه", "هذا العنصر", "فصل لي", "زيدني",
    "لخصه", "لخصها", "اشرحه", "اشرحها", "ما موضوعه", "ما موضوعها", "وضح لي هذا الخبر"
  ].some(p => norm.includes(normalizeArabicLight(p)))

  const isFollowUpOperation =
    operation === "summarize" ||
    operation === "explain" ||
    operation === "direct_answer" ||
    norm.includes(normalizeArabicLight("لخص")) ||
    norm.includes(normalizeArabicLight("اشرح"))
  return isFollowUpOperation && refersToPriorResult
}
