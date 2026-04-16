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

function includesAny(norm: string, values: string[]): boolean {
  return values.some(value => norm.includes(normalizeArabicLight(value)))
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
  const refersToPriorResult = includesAny(norm, [
    "اول نتيجة",
    "أول نتيجة",
    "النتيجة التي ذكرتها",
    "الخبر الذي ذكرته",
    "التي ذكرتها",
    "الذي ذكرته",
    "هذا الخبر",
    "هذه النتيجة",
    "هذا العنصر",
    "فصل لي",
    "زيدني",
    "لخصه",
    "لخصها",
    "اشرحه",
    "اشرحها",
    "ما موضوعه",
    "ما موضوعها",
    "وضح لي هذا الخبر"
  ])

  const isFollowUpOperation =
    operation === "summarize" ||
    operation === "explain" ||
    operation === "direct_answer" ||
    norm.includes(normalizeArabicLight("لخص")) ||
    norm.includes(normalizeArabicLight("اشرح"))

  return isFollowUpOperation && refersToPriorResult
}

export function requiresPriorConversationContext(
  text: string,
  understanding?: QueryUnderstandingResult
): boolean {
  if (isContextualFollowUpQuery(text, understanding)) return true

  const norm = normalizeArabicLight(text)

  if (includesAny(norm, [
    "اعطني المصادر",
    "أعطني المصادر",
    "اعطني المصدر",
    "أعطني المصدر",
    "هات المصادر",
    "هات المصدر",
    "ما المصادر",
    "وين المصادر",
    "اعطني الروابط",
    "أعطني الروابط",
    "هات الروابط",
    "الرابط",
    "الروابط",
    "المصدر",
    "المصادر"
  ])) {
    return true
  }

  return includesAny(norm, [
    "ومن هي",
    "ومن هو",
    "ومتى",
    "واين",
    "وأين",
    "وما",
    "وكم",
    "وهل",
    "وماذا عن",
    "وماذا",
    "زوجته",
    "زوجها",
    "اولاده",
    "أولاده",
    "ابناؤه",
    "أبناؤه",
    "القابه",
    "ألقابه",
    "كنيته",
    "مولده",
    "وفاته",
    "عمره",
    "مكانه",
    "اسمه",
    "اسمها",
    "رابطه",
    "مصدره",
    "مصادره",
    "تفاصيله",
    "تفاصيلها"
  ])
}
