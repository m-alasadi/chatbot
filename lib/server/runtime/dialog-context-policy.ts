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

function getPreviousUserMessage(messages: ChatCompletionMessageParam[]): string {
  let seenLatestUser = false
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== "user") continue
    if (!seenLatestUser) {
      seenLatestUser = true
      continue
    }
    if (typeof m.content === "string") return m.content
    if (Array.isArray(m.content)) {
      const textPart = m.content.find((p: any) => p.type === "text")
      if (textPart && "text" in textPart) return textPart.text
    }
  }
  return ""
}

function containsArabicPronounFollowUp(norm: string): boolean {
  return includesAny(norm, [
    "ما اسمائهن",
    "ما اسمائهن؟",
    "ما اسمائهم",
    "ما اسماؤهم",
    "ما اسمها",
    "ما اسمه",
    "اسمائهن",
    "اسمائهم",
    "اسماؤهم",
    "اسمها",
    "اسمهم",
    "اسمهن",
    "من هن",
    "من هم",
    "ماذا تقصد",
    "هؤلاء",
    "هذولا",
    "هذولي",
    "هؤلاء المذكورين",
  ])
}

function extractPrimarySubjectFromUserText(text: string): string {
  const raw = String(text || "").trim()
  if (!raw) return ""

  const patterns = [
    /(?:هل\s+)?(?:لديكم|عندكم|عندكم\s+الآن)\s+([\u0621-\u064A\s]{2,40})/u,
    /(?:هل\s+)?(?:يوجد|توجد|تتوفر|متوفر|متوفرة)\s+([\u0621-\u064A\s]{2,40})/u,
    /(?:اريد|أريد|اعطني|أعطني|هات|اعرض|أعرض|حدثني\s+عن|اخبرني\s+عن|أخبرني\s+عن)\s+([\u0621-\u064A\s]{2,40})/u,
  ]

  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (!match) continue
    const phrase = String(match[1] || "")
      .replace(/[؟?!.,،؛:()\[\]{}"']/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    if (phrase) return phrase
  }

  const cleaned = raw
    .replace(/[؟?!.,،؛:()\[\]{}"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  const tokens = cleaned.split(" ").filter(Boolean)
  if (tokens.length <= 1) return cleaned
  return tokens.slice(-2).join(" ")
}

export function getResolvedUserQuery(
  messages: ChatCompletionMessageParam[],
  understanding?: QueryUnderstandingResult
): string {
  const current = getLastUserMessage(messages)
  if (!current) return ""

  const currentNorm = normalizeArabicLight(current)
  const previousUser = getPreviousUserMessage(messages)
  if (!previousUser) return current

  const needsContext =
    requiresPriorConversationContext(current, understanding) ||
    containsArabicPronounFollowUp(currentNorm)

  if (!needsContext) return current

  const priorSubject = extractPrimarySubjectFromUserText(previousUser)
  if (!priorSubject) return current

  const priorSubjectNorm = normalizeArabicLight(priorSubject)
  if (currentNorm.includes(priorSubjectNorm)) return current

  if (includesAny(currentNorm, ["اسم", "اسماء", "ما اسم", "اسمائ", "اسماؤ"])) {
    return `ما أسماء ${priorSubject}`
  }

  if (includesAny(currentNorm, ["امثله", "أمثلة", "مثال", "امثله عن", "اعطني امثله", "أعطني أمثلة"])) {
    return `اعطني أمثلة عن ${priorSubject}`
  }

  return `${current} (${priorSubject})`
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
    "اذا كان نعم",
    "إذا كان نعم",
    "اذا كان الجواب نعم",
    "إذا كان الجواب نعم",
    "اذكر الاسم فقط",
    "أذكر الاسم فقط",
    "اعطني الاسم فقط",
    "أعطني الاسم فقط",
    "الاسم فقط",
    "هذه الجهة",
    "هذه الجهه",
    "وظيفة هذه الجهة",
    "وظيفه هذه الجهه",
    "ما وظيفة هذه الجهة",
    "ما وظيفه هذه الجهه",
    "دور هذه الجهة",
    "دور هذه الجهه",
    "ما دور هذه الجهة",
    "ما دور هذه الجهه",
    "هذه الوظيفة",
    "هذه الوظيفه",
    "هذا المنصب",
    "هذي الجهة",
    "هذي الجهه"
  ])) {
    return true
  }

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
    "ما هي ألقابه",
    "ما هي القابه",
    "ألقابه المشهورة",
    "القابه المشهورة",
    "من هم أبناؤه",
    "من هم ابناؤه",
    "ما اسم زوجته",
    "ما اسم زوجه",
    "كم كانت زوجاته",
    "متى كانت شهادته",
    "تاريخ شهادته",
    "ومن هي",
    "ومن هو",
    "ومتى",
    "واين",
    "وأين",
    "وما",
    "وكم",
    "وكم عمره",
    "وكم كان عمره",
    "وهل",
    "وماذا عن",
    "وماذا",
    "زوجته",
    "زوجاته",
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
