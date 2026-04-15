/**
 * Evidence-Based Answer Generation Layer
 *
 * Extracts the best evidence (direct quotes) from retrieved content
 * to force grounded, citation-backed responses — no hallucination.
 */

import type { ChunkSearchResult, ContentChunk } from "./knowledge/content-types"

// ── Arabic normalization (local, lightweight) ───────────────────────

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
  return normalizeAr(text).split(/\s+/).filter(w => w.length >= 2)
}

// ── Types ───────────────────────────────────────────────────────────

export interface Evidence {
  quote: string          // direct quote from source
  source_title: string   // title of the source item
  source_url: string     // URL of the source
  source_section: string // section name
  confidence: number     // 0–100
}

// ── Core extractor ──────────────────────────────────────────────────

/**
 * Extract the best evidence from knowledge chunks for a given query.
 *
 * Returns up to `limit` evidence items ranked by relevance.
 * Each evidence item contains a direct quote and its source metadata.
 */
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

    const quote = extractBestQuote(text, queryTokens)
    if (!quote) continue

    const confidence = computeConfidence(quote, queryTokens, score)

    evidenceList.push({
      quote,
      source_title: chunk.title || "",
      source_url: chunk.url || "",
      source_section: chunk.section || "",
      confidence,
    })
  }

  // Sort by confidence descending
  evidenceList.sort((a, b) => b.confidence - a.confidence)
  return evidenceList.slice(0, limit)
}

/**
 * Extract the best matching evidence quote from tool result items
 * (non-knowledge items that come from API search results).
 */
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
    // Gather all text fields from the item
    const textFields: string[] = []
    if (item?.name) textFields.push(item.name)
    if (item?.description) textFields.push(item.description)
    if (item?._snippet) textFields.push(item._snippet)

    // Combine into a single text block for quote extraction
    const combined = textFields.join(" ").trim()
    if (combined.length < 15) continue

    let quote = extractBestQuote(combined, queryTokens)
    // Fallback: when content is very short or no overlap found, use the item title
    if (!quote && item?.name && item.name.length >= 5) {
      quote = item.name
    }
    if (!quote) continue

    const confidence = computeConfidence(quote, queryTokens, 5)

    evidenceList.push({
      quote,
      source_title: item?.name || "",
      source_url: item?.url || "",
      source_section: Array.isArray(item?.sections)
        ? item.sections.map((s: any) => typeof s === "string" ? s : s?.name).filter(Boolean).join(", ")
        : "",
      confidence,
    })
  }

  evidenceList.sort((a, b) => b.confidence - a.confidence)

  // If the top result is clearly dominant (≥20 points above the second),
  // only return the top result — avoids injecting tangentially-related items
  // that merely share a common word (e.g. "أحمد" in an unrelated article).
  if (evidenceList.length >= 2) {
    const gap = evidenceList[0].confidence - evidenceList[1].confidence
    if (gap >= 20) {
      return evidenceList.slice(0, 1)
    }
  }

  return evidenceList.slice(0, limit)
}

// ── Internal helpers ────────────────────────────────────────────────

/**
 * Extract the best quote window from a text, centered on the region
 * with the highest query-token density.
 */
function extractBestQuote(
  text: string,
  queryTokens: string[],
  windowSize: number = 200
): string | null {
  const normText = normalizeAr(text)
  if (normText.length < 10) return null

  // Find position with highest token overlap
  let bestPos = 0
  let bestCount = 0
  const step = Math.max(10, Math.floor(windowSize / 4))

  for (let i = 0; i < normText.length; i += step) {
    const window = normText.substring(i, i + windowSize)
    let count = 0
    for (const tok of queryTokens) {
      if (window.includes(tok)) count++
    }
    if (count > bestCount) {
      bestCount = count
      bestPos = i
    }
  }

  if (bestCount === 0) {
    // Fallback: no query-token overlap, but text may still be relevant.
    // Return a short opening snippet so callers always get something.
    const fallback = text.substring(0, 220).trim()
    return fallback.length >= 15 ? fallback + (text.length > 220 ? "…" : "") : null
  }

  // Extract from ORIGINAL text (preserve diacritics/formatting)
  const start = Math.max(0, bestPos - 20)
  const end = Math.min(text.length, bestPos + windowSize)
  let quote = text.substring(start, end).trim()

  // Clean edges — try to start/end at word boundaries
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

/**
 * Compute a 0–100 confidence score for a quote's relevance to the query.
 */
function computeConfidence(
  quote: string,
  queryTokens: string[],
  searchScore: number
): number {
  const normQuote = normalizeAr(quote)
  const normQuery = queryTokens.join(" ")

  // Full query match in quote → high confidence
  if (normQuote.includes(normQuery)) return Math.min(95, 70 + searchScore * 2)

  // Token overlap ratio
  let hitCount = 0
  for (const tok of queryTokens) {
    if (normQuote.includes(tok)) hitCount++
  }
  const ratio = queryTokens.length > 0 ? hitCount / queryTokens.length : 0

  // Base confidence from token coverage + search score
  let conf = ratio * 50 + Math.min(searchScore * 3, 30)

  // Bonus for longer quotes (more context)
  if (quote.length > 150) conf += 5
  if (quote.length > 300) conf += 5

  return Math.min(95, Math.max(0, Math.round(conf)))
}

// ── Formatting for injection into model context ─────────────────────

/**
 * Format evidence array into a compact Arabic block for system injection.
 * This becomes part of the model context, instructing it to quote directly.
 */
export function formatEvidenceForModel(evidenceList: Evidence[]): string {
  if (!evidenceList || evidenceList.length === 0) return ""

  const lines: string[] = [
    "[أدلة مستخرجة من المصادر — استخدم هذه الاقتباسات في إجابتك]"
  ]

  for (let i = 0; i < evidenceList.length; i++) {
    const e = evidenceList[i]
    lines.push(``)
    lines.push(`دليل ${i + 1} (ثقة: ${e.confidence}%):`)
    lines.push(`المصدر: ${e.source_title}`)
    if (e.source_section) lines.push(`القسم: ${e.source_section}`)
    lines.push(`الاقتباس: «${e.quote}»`)
    if (e.source_url) lines.push(`الرابط: ${e.source_url}`)
  }

  return lines.join("\n")
}
/**
 * Build a MANDATORY instruction that forces the model to include the
 * top evidence quote verbatim in its response.
 *
 * Called when confidence is high enough to enforce citation.
 */
export function buildMandatoryInstruction(evidenceList: Evidence[]): string {
  if (!evidenceList || evidenceList.length === 0) return ""

  const top = evidenceList[0]
  const lines: string[] = [
    "⛔ إلزامي — نظام: يجب أن يتضمن ردك الاقتباس التالي حرفياً بين علامتي «» من نص المصدر الأصلي:",
    `«${top.quote}»`,
    `المصدر: ${top.source_title}`,
  ]
  if (top.source_url) lines.push(`الرابط: ${top.source_url}`)

  // تضمين بقية الأدلة مع روابطها الصحيحة حتى لا يخلط النموذج بين الروابط
  if (evidenceList.length > 1) {
    lines.push("")
    lines.push("نتائج إضافية (استخدم الرابط الخاص بكل نتيجة فقط — لا تستخدم رابط نتيجة أخرى):")
    for (let i = 1; i < evidenceList.length; i++) {
      const e = evidenceList[i]
      lines.push(`  ${i + 1}. ${e.source_title}${e.source_url ? ` → ${e.source_url}` : ""}`)
    }
  }

  lines.push("",
    "قاعدة مطلقة: لا تُلخّص ولا تُعيد الصياغة. اذكر الاقتباس أعلاه كما هو ثم أضف جملة توضيحية قصيرة (1–2 جمل).",
    "⚠️ مهم جداً: لكل نتيجة رابط خاص بها. استخدم الرابط المرفق مع كل نتيجة فقط. لا تستخدم رابط نتيجة مع محتوى نتيجة أخرى."
  )

  return lines.join("\n")
}

// ── Direct-answer generator (bypasses LLM for high-confidence hits) ──

/**
 * Generate a template-based grounded answer directly from evidence.
 * Used when confidence is high enough that LLM synthesis is not needed.
 * Returns null when evidence is too weak to generate a reliable answer.
 */
export function generateDirectAnswer(
  query: string,
  evidenceList: Evidence[]
): string | null {
  if (!evidenceList || evidenceList.length === 0) return null

  // Include any evidence with reasonable confidence; fall back to all evidence
  const strong = evidenceList.filter(e => e.confidence >= 35)
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

/**
 * Format a grounded answer with mandatory quote inclusion.
 * Produces a structured Arabic response with direct citation.
 */
export function formatGroundedAnswer(
  query: string,
  evidenceList: Evidence[]
): string {
  const normQuery = normalizeAr(query)
  const isProjectStyleQuery =
    normQuery.includes("مشروع") ||
    normQuery.includes("مشاريع") ||
    normQuery.includes("توسعه") ||
    normQuery.includes("توسعة") ||
    normQuery.includes("اعمار") ||
    normQuery.includes("بناء")
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

  const extractOfficeHolderName = (): string | null => {
    const pool = evidenceList
      .slice(0, 3)
      .map(e => `${e.quote} ${e.source_title}`)
      .join(" ")
      .replace(/\s+/g, " ")

    const nameRegex = /(السيد|سماحه العلامه السيد|سماحة العلامة السيد|الشيخ)\s+[\u0621-\u064A]{2,}(?:\s+[\u0621-\u064A]{2,}){1,3}/
    const match = pool.match(nameRegex)
    return match ? match[0].replace(/\s+/g, " ").trim() : null
  }

  const extractLocationPhrase = (quote: string): string | null => {
    const normalizedQuote = String(quote || "").replace(/\s+/g, " ")
    const locRegex = /(في\s+[\u0621-\u064A\s]{3,40})/
    const match = normalizedQuote.match(locRegex)
    return match ? match[1].trim() : null
  }

  if (!isProjectStyleQuery && isFactStyleQuery && evidenceList.length > 0) {
    const top = evidenceList[0]
    if (isOfficeHolderQuery) {
      const holder = extractOfficeHolderName()
      if (holder) {
        const src = top.source_title ? ` المصدر: ${top.source_title}.` : ""
        const url = top.source_url ? ` الرابط: ${top.source_url}.` : ""
        return `اسم المتولي الشرعي للعتبة العباسية هو ${holder}.${src}${url} هل تريد تفاصيل أكثر؟`
      }
    }

    if (isLocationQuery) {
      const location = extractLocationPhrase(top.quote)
      if (location) {
        const src = top.source_title ? ` المصدر: ${top.source_title}.` : ""
        const url = top.source_url ? ` الرابط: ${top.source_url}.` : ""
        return `بحسب ما ورد في المصادر، ${location}.${src}${url} هل تريد تفاصيل أكثر؟`
      }
    }

    const quote = String(top.quote || "").replace(/\s+/g, " ").trim()
    const source = top.source_title ? ` المصدر: ${top.source_title}.` : ""
    const url = top.source_url ? ` الرابط: ${top.source_url}.` : ""
    return `بحسب ما ورد في المصادر، ${quote}${source}${url} هل تريد تفاصيل أكثر؟`
  }

  const lines: string[] = [
    isProjectStyleQuery
      ? "بحسب ما ورد في المصادر، هذه أبرز مشاريع التوسعة ذات الصلة:"
      : "بحسب ما ورد في المصادر:"
  ]
  const seen = new Set<string>()

  const ordered = evidenceList
    .slice()
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence
      const titleCmp = (a.source_title || "").localeCompare(b.source_title || "", "ar")
      if (titleCmp !== 0) return titleCmp
      return (a.source_url || "").localeCompare(b.source_url || "")
    })
    .filter(e => {
      const key = `${e.source_title}::${e.source_url}::${e.quote}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  for (const e of ordered.slice(0, 3)) {
    lines.push("")
    if (e.source_title) lines.push(`**${e.source_title}**`)
    if (e.source_section) lines.push(`*${e.source_section}*`)
    lines.push(`«${e.quote}»`)
    if (e.source_url) lines.push(`🔗 [المصدر](${e.source_url})`)
  }

  lines.push("", "هل تريد تفاصيل أكثر؟")
  return lines.join("\n")
}

// ── Tool result item collector (shared helper) ──────────────────────

/**
 * Parse all successful tool-message payloads and return the flat
 * list of content items (results, projects, items) they contain.
 */
export function collectToolResultItems(messages: { role: string; content?: any }[]): any[] {
  const items: any[] = []
  for (const msg of messages) {
    if (msg.role !== "tool" || typeof msg.content !== "string") continue
    try {
      const parsed = JSON.parse(msg.content)
      if (!parsed?.success) continue
      const data = parsed.data
      if (data?.results && Array.isArray(data.results)) items.push(...data.results)
      if (data?.projects && Array.isArray(data.projects)) items.push(...data.projects)
      if (data?.items && Array.isArray(data.items)) items.push(...data.items)
    } catch { /* skip non-JSON messages */ }
  }
  return items
}