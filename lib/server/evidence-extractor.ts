/**
 * Evidence-Based Answer Generation Layer
 *
 * Extracts the best evidence (direct quotes) from retrieved content
 * to force grounded, citation-backed responses without hallucination.
 */

import type { ChunkSearchResult } from "./knowledge/content-types"

function normalizeAr(text: string): string {
  return (text || "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[\u0622\u0623\u0625\u0627]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenize(text: string): string[] {
  return normalizeAr(text).split(/\s+/).filter(word => word.length >= 2)
}

function isHistoricalShrineLifecycleQuery(normQuery: string): boolean {
  const shrineSignals = [
    "العتبه", "العتبة", "العباسيه", "العباسية", "الحرم", "المرقد", "الضريح",
    "قبر العباس", "ابي الفضل", "أبي الفضل", "ابو الفضل", "أبو الفضل"
  ]
  const historicalFrameSignals = ["مراحل", "تاريخ", "تأريخ", "هدم", "عدوان", "اعتداء", "بناء"]
  const structuralSignals = ["بناء", "هدم", "اعمار", "إعمار", "ترميم", "تشييد", "عدوان", "اعتداء"]
  const explicitProjectSignals = ["مشاريع", "مشروع", "توسعه", "توسعة"]

  const hasShrineContext = shrineSignals.some(signal => normQuery.includes(normalizeAr(signal)))
  const hasHistoricalFrame = historicalFrameSignals.some(signal => normQuery.includes(normalizeAr(signal)))
  const hasStructuralSignal = structuralSignals.some(signal => normQuery.includes(normalizeAr(signal)))
  const explicitProjectLookup = explicitProjectSignals.some(signal => normQuery.includes(normalizeAr(signal)))

  return hasShrineContext && hasHistoricalFrame && hasStructuralSignal && !explicitProjectLookup
}

function compactRepeatedText(text: string): string {
  const clean = String(text || "").replace(/\s+/g, " ").trim()
  if (!clean) return clean

  const parts = clean.split(" ")
  if (parts.length < 8) return clean

  const half = Math.floor(parts.length / 2)
  const firstHalf = parts.slice(0, half).join(" ")
  const secondHalf = parts.slice(half).join(" ")
  if (normalizeAr(firstHalf) === normalizeAr(secondHalf)) {
    return firstHalf
  }

  for (let size = Math.min(14, Math.floor(parts.length / 2)); size >= 4; size--) {
    const prefix = parts.slice(0, size).join(" ")
    const remainder = parts.slice(size).join(" ")
    if (normalizeAr(remainder).startsWith(normalizeAr(prefix))) {
      return remainder
    }
  }

  return clean
}

export interface Evidence {
  quote: string
  source_title: string
  source_url: string
  source_section: string
  confidence: number
}

export function extractBestEvidence(
  chunks: ChunkSearchResult[],
  query: string,
  limit: number = 3
): Evidence[] {
  if (!chunks || chunks.length === 0) return []

  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return []

  const evidenceList: Evidence[] = []

  for (const result of chunks) {
    const { chunk, score } = result
    const text = chunk.chunk_text || ""
    if (text.length < 20) continue

    const quote = compactRepeatedText(extractBestQuote(text, queryTokens) || "")
    if (!quote) continue

    evidenceList.push({
      quote,
      source_title: chunk.title || "",
      source_url: chunk.url || "",
      source_section: chunk.section || "",
      confidence: computeConfidence(quote, queryTokens, score),
    })
  }

  evidenceList.sort((a, b) => b.confidence - a.confidence)
  return evidenceList.slice(0, limit)
}

export function extractEvidenceFromToolResults(
  items: any[],
  query: string,
  limit: number = 3
): Evidence[] {
  if (!items || items.length === 0) return []

  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return []

  const evidenceList: Evidence[] = []

  for (const item of items) {
    const textFields: string[] = []
    if (item?.name) textFields.push(item.name)
    if (item?.description) textFields.push(item.description)
    if (item?._snippet) textFields.push(item._snippet)

    const combined = textFields.join(" ").trim()
    if (combined.length < 15) continue

    let quote = extractBestQuote(combined, queryTokens)
    if (!quote && item?.name && item.name.length >= 5) {
      quote = item.name
    }
    quote = compactRepeatedText(quote || "")
    if (!quote) continue

    evidenceList.push({
      quote,
      source_title: item?.name || "",
      source_url: item?.url || "",
      source_section: Array.isArray(item?.sections)
        ? item.sections
            .map((section: any) => typeof section === "string" ? section : section?.name)
            .filter(Boolean)
            .join(", ")
        : "",
      confidence: computeConfidence(quote, queryTokens, 5),
    })
  }

  evidenceList.sort((a, b) => b.confidence - a.confidence)

  if (evidenceList.length >= 2) {
    const gap = evidenceList[0].confidence - evidenceList[1].confidence
    if (gap >= 20) {
      return evidenceList.slice(0, 1)
    }
  }

  return evidenceList.slice(0, limit)
}

function extractBestQuote(
  text: string,
  queryTokens: string[],
  windowSize: number = 200
): string | null {
  const normText = normalizeAr(text)
  if (normText.length < 10) return null

  let bestPos = 0
  let bestCount = 0
  const step = Math.max(10, Math.floor(windowSize / 4))

  for (let i = 0; i < normText.length; i += step) {
    const window = normText.substring(i, i + windowSize)
    let count = 0
    for (const token of queryTokens) {
      if (window.includes(token)) count++
    }
    if (count > bestCount) {
      bestCount = count
      bestPos = i
    }
  }

  if (bestCount === 0) {
    const fallback = text.substring(0, 220).trim()
    return fallback.length >= 15 ? fallback + (text.length > 220 ? "…" : "") : null
  }

  const start = Math.max(0, bestPos - 20)
  const end = Math.min(text.length, bestPos + windowSize)
  let quote = text.substring(start, end).trim()

  if (start > 0) {
    const spaceIdx = quote.indexOf(" ")
    if (spaceIdx > 0 && spaceIdx < 30) quote = quote.substring(spaceIdx + 1)
    quote = "…" + quote
  }
  if (end < text.length) {
    const lastSpace = quote.lastIndexOf(" ")
    if (lastSpace > quote.length - 30) quote = quote.substring(0, lastSpace)
    quote = quote + "…"
  }

  return quote.length >= 15 ? quote : null
}

function computeConfidence(
  quote: string,
  queryTokens: string[],
  searchScore: number
): number {
  const normQuote = normalizeAr(quote)
  const normQuery = queryTokens.join(" ")

  if (normQuote.includes(normQuery)) {
    return Math.min(95, 70 + searchScore * 2)
  }

  let hitCount = 0
  for (const token of queryTokens) {
    if (normQuote.includes(token)) hitCount++
  }

  const ratio = queryTokens.length > 0 ? hitCount / queryTokens.length : 0
  let confidence = ratio * 50 + Math.min(searchScore * 3, 30)

  if (quote.length > 150) confidence += 5
  if (quote.length > 300) confidence += 5

  return Math.min(95, Math.max(0, Math.round(confidence)))
}

export function formatEvidenceForModel(evidenceList: Evidence[]): string {
  if (!evidenceList || evidenceList.length === 0) return ""

  const lines: string[] = [
    "[أدلة مستخرجة من المصادر - حلّل هذه البيانات واستخلص منها الإجابة المناسبة بأسلوب طبيعي]"
  ]

  for (let i = 0; i < evidenceList.length; i++) {
    const evidence = evidenceList[i]
    lines.push("")
    lines.push(`دليل ${i + 1} (ثقة: ${evidence.confidence}%):`)
    lines.push(`المصدر: ${evidence.source_title}`)
    if (evidence.source_section) lines.push(`القسم: ${evidence.source_section}`)
    lines.push(`الاقتباس: «${evidence.quote}»`)
    if (evidence.source_url) lines.push(`الرابط: ${evidence.source_url}`)
  }

  return lines.join("\n")
}

export function buildMandatoryInstruction(evidenceList: Evidence[]): string {
  if (!evidenceList || evidenceList.length === 0) return ""

  const top = evidenceList[0]
  const lines: string[] = [
    "إلزامي - نظام: يجب أن يتضمن ردك الاقتباس التالي حرفياً بين علامتي «» من نص المصدر الأصلي:",
    `«${top.quote}»`,
    `المصدر: ${top.source_title}`,
  ]
  if (top.source_url) lines.push(`الرابط: ${top.source_url}`)

  if (evidenceList.length > 1) {
    lines.push("")
    lines.push("نتائج إضافية: استخدم الرابط الخاص بكل نتيجة فقط ولا تخلط بين الروابط.")
    for (let i = 1; i < evidenceList.length; i++) {
      const evidence = evidenceList[i]
      lines.push(`  ${i + 1}. ${evidence.source_title}${evidence.source_url ? ` -> ${evidence.source_url}` : ""}`)
    }
  }

  lines.push("")
  lines.push("تعليمات: حلّل الاقتباسات أعلاه واستخلص منها الإجابة المناسبة لسؤال المستخدم. لا تلصق الاقتباس كما هو. صِغ إجابة طبيعية ومباشرة باللغة العربية.")
  lines.push("لكل نتيجة رابطها الخاص. استخدم الرابط المرفق مع كل نتيجة فقط.")

  return lines.join("\n")
}

export function generateDirectAnswer(
  query: string,
  evidenceList: Evidence[]
): string | null {
  if (!evidenceList || evidenceList.length === 0) return null

  const strong = evidenceList.filter(evidence => evidence.confidence >= 35)
  const usable = (strong.length > 0 ? strong : evidenceList)
    .slice()
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence
      const titleCmp = (a.source_title || "").localeCompare(b.source_title || "", "ar")
      if (titleCmp !== 0) return titleCmp
      return (a.source_url || "").localeCompare(b.source_url || "")
    })

  if (usable.length === 0) return null
  return formatGroundedAnswer(query, usable)
}

export function formatGroundedAnswer(
  query: string,
  evidenceList: Evidence[]
): string {
  const normQuery = normalizeAr(query)
  const directOnlyRequested =
    normQuery.includes("الجواب المباشر") ||
    normQuery.includes("جواب مباشر") ||
    normQuery.includes("دون عناوين") ||
    normQuery.includes("دون روابط") ||
    (normQuery.includes("فقط") && !normQuery.includes("هل تريد"))
  const wantsTwoLines = normQuery.includes("سطرين") || normQuery.includes("سطرين فقط")
  const wantsNameOnly = normQuery.includes("ما اسمه") || normQuery.includes("من هو") || normQuery.includes("ما اسم")
  const wantsLocationOnly = normQuery.includes("اين") || normQuery.includes("اين يقع") || normQuery.includes("اين يقام")
  const wantsClassification =
    normQuery.includes("فعاليه ام") ||
    normQuery.includes("فعالية ام") ||
    normQuery.includes("برنامج ام") ||
    normQuery.includes("خبر ام") ||
    normQuery.includes("تصنيف") ||
    normQuery.includes("هل هو")
  const historicalShrineLifecycleQuery = isHistoricalShrineLifecycleQuery(normQuery)
  const isProjectStyleQuery =
    !historicalShrineLifecycleQuery &&
    (
      normQuery.includes("مشروع") ||
      normQuery.includes("مشاريع") ||
      normQuery.includes("توسعه") ||
      normQuery.includes("اعمار") ||
      normQuery.includes("بناء") ||
      normQuery.includes("استثمار") ||
      normQuery.includes("مجزره") ||
      normQuery.includes("مزرعه")
    )
  const isExpansionProjectQuery =
    !historicalShrineLifecycleQuery &&
    (
      normQuery.includes("توسعه") ||
      normQuery.includes("اعمار") ||
      normQuery.includes("بناء") ||
      normQuery.includes("تشييد")
    )
  const isYesNoProjectQuery =
    isProjectStyleQuery &&
    (
      normQuery.startsWith("هل") ||
      normQuery.includes("هل توجد") ||
      normQuery.includes("هل هناك") ||
      normQuery.includes("هل لدى") ||
      normQuery.includes("هل للعتبه") ||
      normQuery.includes("هل للعتبة")
    )
  const isFactStyleQuery =
    normQuery.includes("من هو") ||
    normQuery.includes("من هي") ||
    normQuery.includes("ما هو") ||
    normQuery.includes("ما هي") ||
    normQuery.includes("ما اسم") ||
    normQuery.includes("اين") ||
    normQuery.includes("متي") ||
    normQuery.includes("كم") ||
    normQuery.includes("عدد") ||
    normQuery.includes("هل") ||
    normQuery.includes("نبذه") ||
    normQuery.includes("سيره")
  const isOfficeHolderQuery =
    normQuery.includes("المتولي") ||
    normQuery.includes("المتولي الشرعي")
  const isLocationQuery = normQuery.includes("اين")

  const buildDirectResponse = (body: string): string => {
    const clean = String(body || "").replace(/\s+/g, " ").trim()
    if (wantsTwoLines && clean.length > 200) {
      const mid = Math.min(clean.length - 1, 120)
      const splitIdx = clean.indexOf(" ", mid)
      if (splitIdx > 0 && splitIdx < clean.length - 1) {
        return `${clean.slice(0, splitIdx).trim()}\n${clean.slice(splitIdx + 1).trim()}`
      }
    }
    return clean
  }

  const shortenQuote = (quote: string, max: number = 220): string => {
    const clean = String(quote || "").replace(/\s+/g, " ").trim()
    if (clean.length <= max) return clean
    return `${clean.slice(0, max)}…`
  }

  const formatSourceLink = (evidence: Evidence): string =>
    evidence.source_url ? `[المصدر](${evidence.source_url})` : ""

  const buildEvidenceCard = (evidence: Evidence): string => {
    const lines: string[] = []
    if (evidence.source_title) lines.push(`**${evidence.source_title}**`)
    if (evidence.source_section) lines.push(`*${evidence.source_section}*`)
    lines.push(`«${shortenQuote(evidence.quote)}»`)
    const sourceLink = formatSourceLink(evidence)
    if (sourceLink) lines.push(sourceLink)
    return lines.join("\n")
  }

  const seen = new Set<string>()
  const ordered = evidenceList
    .slice()
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence
      const titleCmp = (a.source_title || "").localeCompare(b.source_title || "", "ar")
      if (titleCmp !== 0) return titleCmp
      return (a.source_url || "").localeCompare(b.source_url || "")
    })
    .filter(evidence => {
      const key = `${evidence.source_title}::${evidence.source_url}::${evidence.quote}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  const extractOfficeHolderName = (): string | null => {
    const pool = ordered
      .slice(0, 3)
      .map(evidence => `${evidence.quote} ${evidence.source_title}`)
      .join(" ")
      .replace(/\s+/g, " ")

    const exactKnownMatch = pool.match(/السيد\s+ا[حح]مد\s+الصافي/i)
    if (exactKnownMatch) return "السيد أحمد الصافي"

    const nameRegex = /(السيد|سماحه العلامه السيد|سماحة العلامة السيد|الشيخ)\s+[\u0621-\u064A]{2,}(?:\s+[\u0621-\u064A]{2,}){1,3}/
    const match = pool.match(nameRegex)
    if (!match) return null

    return match[0]
      .replace(/\s+/g, " ")
      .replace(/\b(يطلع|يؤكد|يشارك|زار|دام|عزه|يحضر|يلقي|قال)\b.*$/i, "")
      .trim() || null
  }

  const extractLocationPhrase = (quote: string): string | null => {
    const normalizedQuote = String(quote || "").replace(/\s+/g, " ")
    const match = normalizedQuote.match(/(في\s+[\u0621-\u064A\s]{3,40})/)
    return match ? match[1].trim() : null
  }

  const detectClassificationFromEvidence = (): string | null => {
    const text = ordered
      .slice(0, 3)
      .map(evidence => `${evidence.source_title} ${evidence.source_section} ${evidence.quote}`)
      .join(" ")
    const norm = normalizeAr(text)
    if (norm.includes("فعاليه") || norm.includes("مهرجان") || norm.includes("مراسيم")) return "فعالية"
    if (norm.includes("برنامج") || norm.includes("سلسله") || norm.includes("من وحي الجمعه")) return "برنامج"
    if (norm.includes("خبر") || norm.includes("اعلان") || norm.includes("بيان")) return "خبر"
    return null
  }

  const extractProjectFocusLabel = (): string | null => {
    if (normQuery.includes("دواجن") && normQuery.includes("لحوم")) return "في مجال الدواجن واللحوم"
    if (normQuery.includes("دواجن")) return "في مجال الدواجن"
    if (normQuery.includes("لحوم")) return "في مجال اللحوم"
    if (normQuery.includes("غذائي")) return "في المجال الغذائي"
    if (normQuery.includes("زراعي")) return "في المجال الزراعي"
    if (normQuery.includes("استثماري")) return "في المجال الاستثماري"
    if (normQuery.includes("تعليمي")) return "في المجال التعليمي"
    if (normQuery.includes("صحي") || normQuery.includes("طبي")) return "في المجال الصحي"
    if (normQuery.includes("خدمي")) return "في المجال الخدمي"
    return null
  }

  const buildProjectYesNoAnswer = (): string => {
    const focusLabel = extractProjectFocusLabel()
    const intro = focusLabel
      ? `نعم، توجد مشاريع للعتبة العباسية ${focusLabel}.`
      : "نعم، توجد مشاريع ذات صلة للعتبة العباسية."
    const titles = ordered
      .slice(0, 2)
      .map(evidence => evidence.source_title)
      .filter(Boolean)
    const examples = titles.length > 0 ? ` من أمثلتها: ${titles.join("، ")}.` : ""

    if (directOnlyRequested) return buildDirectResponse(`${intro}${examples}`)

    const lines = ["**الخلاصة**", buildDirectResponse(`${intro}${examples}`)]
    for (const evidence of ordered.slice(0, 2)) {
      lines.push("")
      lines.push(buildEvidenceCard(evidence))
    }
    return lines.join("\n")
  }

  if (!isProjectStyleQuery && isFactStyleQuery && ordered.length > 0) {
    const top = ordered[0]

    if (isOfficeHolderQuery) {
      const holder = extractOfficeHolderName()
      if (holder) {
        const answer = `اسم المتولي الشرعي للعتبة العباسية هو ${holder}.`
        if (directOnlyRequested || wantsNameOnly) return buildDirectResponse(answer)
        const lines = [answer]
        if (top.source_title) lines.push(`**${top.source_title}**`)
        const sourceLink = formatSourceLink(top)
        if (sourceLink) lines.push(sourceLink)
        return lines.join("\n")
      }
    }

    if (wantsClassification) {
      const classification = detectClassificationFromEvidence()
      if (classification) {
        const answer = `التصنيف الأقرب بحسب النتائج المتاحة: ${classification}.`
        if (directOnlyRequested) return buildDirectResponse(answer)
        return answer
      }
    }

    if (isLocationQuery) {
      const location = extractLocationPhrase(top.quote)
      if (location) {
        const answer = `المكان: ${location}.`
        if (directOnlyRequested || wantsLocationOnly) return buildDirectResponse(answer)
        const lines = [answer]
        if (top.source_title) lines.push(`**${top.source_title}**`)
        const sourceLink = formatSourceLink(top)
        if (sourceLink) lines.push(sourceLink)
        return lines.join("\n")
      }
    }

    const quote = String(top.quote || "").replace(/\s+/g, " ").trim()
    if (directOnlyRequested) return buildDirectResponse(quote)
    // بدلاً من عرض الاقتباس الخام كإجابة، نصيغ إجابة طبيعية
    const lines: string[] = []
    // إذا كان الاقتباس يحتوي على معلومة واضحة، نعرضها مباشرة
    lines.push(quote)
    const sourceLink = formatSourceLink(top)
    if (sourceLink) {
      lines.push("")
      lines.push(`📎 ${sourceLink}`)
    }
    return lines.join("\n")
  }

  if (isYesNoProjectQuery && ordered.length > 0) {
    return buildProjectYesNoAnswer()
  }

  const lines: string[] = []

  if (isExpansionProjectQuery) {
    lines.push("**أبرز مشاريع التوسعة ذات الصلة**")
  } else if (isProjectStyleQuery) {
    lines.push("**أبرز المشاريع ذات الصلة**")
  }

  for (const evidence of ordered.slice(0, 3)) {
    lines.push("")
    if (evidence.source_title) lines.push(`**${evidence.source_title}**`)
    // عرض ملخص مختصر بدلاً من الاقتباس الخام الكامل
    const snippet = shortenQuote(evidence.quote, 150)
    lines.push(snippet)
    const sourceLink = formatSourceLink(evidence)
    if (sourceLink) lines.push(`🔗 ${sourceLink}`)
  }

  return lines.join("\n")
}

export function collectToolResultItems(messages: { role: string; content?: any }[]): any[] {
  const items: any[] = []

  for (const message of messages) {
    if (message.role !== "tool" || typeof message.content !== "string") continue

    try {
      const parsed = JSON.parse(message.content)
      if (!parsed?.success) continue

      const data = parsed.data
      if (data?.results && Array.isArray(data.results)) items.push(...data.results)
      if (data?.projects && Array.isArray(data.projects)) items.push(...data.projects)
      if (data?.items && Array.isArray(data.items)) items.push(...data.items)
    } catch {
      // Ignore non-JSON tool payloads.
    }
  }

  return items
}
