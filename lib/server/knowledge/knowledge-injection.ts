/**
 * Knowledge Injection Pipeline
 *
 * Injects deep-text knowledge context and evidence guards into the
 * message array before the final LLM call.
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions"
import { executeToolByName } from "../site-api-service"
import { ensureKnowledgeReady } from "./content-ingestion"
import { searchKnowledgeWithBackfill } from "./knowledge-search"
import {
  extractBestEvidence,
  extractEvidenceFromToolResults,
  formatEvidenceForModel,
  buildMandatoryInstruction,
  generateDirectAnswer,
  formatGroundedAnswer,
  collectToolResultItems,
  type Evidence,
} from "../evidence-extractor"
import {
  normalizeArabicLight,
  isAbbasBiographyQuery,
  isOfficeHolderQuery,
  isKnowledgePriorityQuery,
  shouldUseKnowledgeLayer,
  isHardEvidenceSensitive,
  hasStrongAnswerEvidence,
  evidenceCoversSpecificTokens,
  evidenceContainsLikelyPersonName,
  isCompoundFactQuery,
  splitCompoundFactQuery,
  extractCompoundQueryAnchor,
  enrichCompoundQueryPart,
  extractSpecificQueryTokens,
} from "../../ai/intent-detector"
import { understandQuery, type QueryUnderstandingResult } from "../query-understanding"

// ── Knowledge context formatting ────────────────────────────────────

function formatKnowledgeResults(
  chunks: { chunk: { title: string; section: string; url: string; chunk_text: string; source?: string }; evidence_snippet: string; score: number }[]
): string {
  if (!chunks || chunks.length === 0) return ""

  const evidence = extractBestEvidence(chunks as any, "", 3)
  const evidenceBlock = formatEvidenceForModel(evidence)

  const lines: string[] = ["[سياق معرفي إضافي من النصوص الكاملة]"]
  for (const r of chunks) {
    const isAbbas = r.chunk.source === "abbas_local_dataset"
    const maxSnippet = isAbbas ? 550 : 400
    const snippet = isAbbas
      ? r.chunk.chunk_text.substring(0, maxSnippet)
      : (r.evidence_snippet || r.chunk.chunk_text.substring(0, maxSnippet))
    lines.push(`• ${r.chunk.title}${r.chunk.section ? ` — ${r.chunk.section}` : ""}`)
    lines.push(`  ${snippet}`)
    if (r.chunk.url) lines.push(`  ${r.chunk.url}`)
  }

  if (evidenceBlock) {
    lines.push("")
    lines.push(evidenceBlock)
  }

  return lines.join("\n")
}

// ── Knowledge context retrieval ─────────────────────────────────────

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
      ? compoundParts.map(part => ({ label: part, searchQuery: enrichCompoundQueryPart(part, compoundAnchor) }))
      : [{ label: query, searchQuery: query }]

    await ensureKnowledgeReady()

    const contexts: string[] = []
    const evidencePool: Evidence[] = []
    let topScore = 0

    for (const plan of searchPlans) {
      const response = await searchKnowledgeWithBackfill(plan.searchQuery, {
        limit: isAbbasAttributeQuery ? 6 : 4,
        minScore: isAbbasAttributeQuery ? 0.6 : 1.5,
      })
      if (response.chunks.length === 0) continue

      topScore = Math.max(topScore, response.chunks[0].score)
      evidencePool.push(...extractBestEvidence(response.chunks as any, plan.searchQuery, searchPlans.length > 1 ? 2 : 3))
      const formatted = formatKnowledgeResults(response.chunks)
      contexts.push(searchPlans.length > 1 ? `[جزء مطلوب: ${plan.label}]\n${formatted}` : formatted)
    }

    if (contexts.length === 0 && searchPlans.length > 1) {
      const fallback = await searchKnowledgeWithBackfill(query, {
        limit: isAbbasAttributeQuery ? 6 : 4,
        minScore: isAbbasAttributeQuery ? 0.6 : 1.5,
      })
      if (fallback.chunks.length > 0) {
        topScore = Math.max(topScore, fallback.chunks[0].score)
        evidencePool.push(...extractBestEvidence(fallback.chunks as any, query, 3))
        contexts.push(formatKnowledgeResults(fallback.chunks))
      }
    }

    if (contexts.length === 0) {
      console.log(`[Knowledge] No chunks for: "${query}"`)
      return null
    }

    const uniqueEvidence = evidencePool
      .filter(item => item?.quote)
      .filter((item, i, arr) =>
        arr.findIndex(o => o.quote === item.quote && o.source_title === item.source_title) === i
      )
      .sort((a, b) => b.confidence - a.confidence)

    return { context: contexts.join("\n\n"), topScore, evidence: uniqueEvidence.slice(0, 4) }
  } catch (e) {
    console.warn("[Knowledge] Search failed:", (e as Error).message)
    return null
  }
}

// ── Evidence extraction helpers ─────────────────────────────────────

function extractToolResultEvidence(messages: ChatCompletionMessageParam[], userQuery: string): Evidence[] {
  const allItems = collectToolResultItems(messages as any[])
  if (allItems.length === 0) return []
  const limit = isOfficeHolderQuery(userQuery) ? 5 : isCompoundFactQuery(userQuery) ? 5 : 3
  return extractEvidenceFromToolResults(allItems, userQuery, limit)
}

function injectToolEvidenceBlock(messages: ChatCompletionMessageParam[], userQuery: string, evidence: Evidence[]): void {
  if (evidence.length === 0) return

  const topConfidence = evidence[0]?.confidence ?? 0
  console.log(`[Evidence] ${evidence.length} items, top confidence: ${topConfidence}%`)

  const block = isCompoundFactQuery(userQuery)
    ? formatEvidenceForModel(evidence)
    : topConfidence >= 40
      ? buildMandatoryInstruction(evidence)
      : formatEvidenceForModel(evidence)

  if (block) {
    messages.push({ role: "system", content: block })
  }
}

// ── Deep-fetch helper for knowledge gaps ────────────────────────────

async function fetchAndInjectFullArticle(
  messages: ChatCompletionMessageParam[],
  articleId: string,
  articleName: string,
  articleUrl: string
): Promise<boolean> {
  try {
    console.log(`[Evidence Guard] Fetching full article id=${articleId}`)
    const fullArticle = await executeToolByName("get_content_by_id", { id: articleId, source: "articles_latest" })
    if (!fullArticle.success || !fullArticle.data) return false

    const fullText = fullArticle.data.description || fullArticle.data.content || ""
    if (!fullText) return false

    const suppToolId = `deep_fetch_${Date.now()}`
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: [{ id: suppToolId, type: "function" as const, function: { name: "get_content_by_id", arguments: JSON.stringify({ id: articleId }) } }],
    })
    messages.push({
      role: "tool",
      tool_call_id: suppToolId,
      content: JSON.stringify({
        success: true,
        data: {
          name: fullArticle.data.name || articleName,
          description: typeof fullText === "string" ? fullText.substring(0, 2000) : fullText,
          url: fullArticle.data.url || articleUrl,
        },
      }),
    })
    messages.push({
      role: "system",
      content: `📰 تم جلب النص الكامل للخبر "${fullArticle.data.name || articleName}". اقرأ محتواه بعناية واستخلص منه الإجابة عن الجزء المتعلق بالزوجة/الزواج. لا تعتذر عن عدم توفر المعلومة إذا كانت مذكورة في هذا الخبر.`,
    })
    return true
  } catch (e) {
    console.log(`[Evidence Guard] Full article fetch failed:`, e)
    return false
  }
}

async function resolveKnowledgeGap(
  messages: ChatCompletionMessageParam[],
  extractedEvidence: Evidence[],
  gapKeywords: string[]
): Promise<void> {
  // Step 1: check extracted evidence for gap-relevant articles
  const gapEvidence = extractedEvidence.find(e =>
    gapKeywords.some(k => normalizeArabicLight(e.source_title).includes(k) || normalizeArabicLight(e.quote).includes(k))
  )
  if (gapEvidence) {
    const idMatch = gapEvidence.source_url.match(/[?&]id=(\d+)/)
    if (idMatch && await fetchAndInjectFullArticle(messages, idMatch[1], gapEvidence.source_title, gapEvidence.source_url)) return
  }

  // Step 2: check all raw tool result items
  const allToolItems = collectToolResultItems(messages as any[])
  const gapItem = allToolItems.find((item: any) =>
    gapKeywords.some(k => normalizeArabicLight(item?.name || "").includes(k)) && item?.id
  )
  if (gapItem && await fetchAndInjectFullArticle(messages, String(gapItem.id), gapItem.name || "", gapItem.url || "")) return

  // Step 3: targeted supplementary search
  try {
    const gapSearchQuery = "زوجة أبي الفضل العباس"
    console.log(`[Evidence Guard] Supplementary search for gap: "${gapSearchQuery}"`)
    const supplementary = await executeToolByName("search_content", { query: gapSearchQuery, source: "auto" })
    const rawResults = supplementary?.data?.results || supplementary?.data?.projects || supplementary?.data?.items || []
    if (rawResults.length > 0) {
      const match = rawResults.find((p: any) => gapKeywords.some((k: string) => normalizeArabicLight(p.name || "").includes(k))) || rawResults[0]
      if (match?.id) {
        await fetchAndInjectFullArticle(messages, String(match.id), match.name || "", match.url || "")
      }
    }
  } catch (e) {
    console.log(`[Evidence Guard] Supplementary search failed:`, e)
  }
}

// ── Main pipeline ───────────────────────────────────────────────────

export async function injectKnowledgeAndGuard(
  messages: ChatCompletionMessageParam[],
  userQuery: string,
  understanding?: QueryUnderstandingResult
): Promise<Evidence[]> {
  let extractedEvidence = extractToolResultEvidence(messages, userQuery)
  const topEvidenceConfidence = extractedEvidence[0]?.confidence ?? 0
  const knowledgePriority = isKnowledgePriorityQuery(userQuery, understanding)
  const hasKnowledgeContextAlready = messages.some(
    m => m.role === "system" && typeof m.content === "string" && m.content.includes("[سياق معرفي إضافي من النصوص الكاملة]")
  )

  let abbasKnowledgeInjected = false
  let knowledgeInjected = false
  let knowledgeEvidence: Evidence[] = []
  let knowledgeTopScore = 0

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

      if ((kCtx.includes("العباس بن علي") || kCtx.includes("alkafeel.net/abbas")) && topScore >= 7.0) {
        abbasKnowledgeInjected = true
      }

      const emptyToolIdx = messages.findIndex(
        m => m.role === "tool" && typeof m.content === "string" && m.content.includes('"empty_results":true')
      )
      if (emptyToolIdx >= 0) {
        console.log(`[Knowledge] Tool returned empty — overriding with knowledge context`)
        ;(messages[emptyToolIdx] as any).content =
          JSON.stringify({ success: true, data: { source_used: "النصوص الكاملة للموقع", note: "النتائج التالية من البحث في النصوص الكاملة المفهرسة" } }) + "\n\n" + kCtx
        messages.push({ role: "system", content: "استخدم السياق المعرفي المستخرج من النصوص الكاملة للإجابة مباشرة إذا كان مرتبطًا بالسؤال. لا تقل إن المعلومات غير متاحة ما دام هذا السياق يحتوي على شواهد ذات صلة." })
      } else {
        messages.push({ role: "system", content: kCtx })
      }
    } else {
      const norm = normalizeArabicLight(userQuery)
      if (
        isAbbasBiographyQuery(userQuery) &&
        ["ابناء", "أبناء", "زوجات", "القاب", "كنيه", "كنية"].some(t => norm.includes(normalizeArabicLight(t)))
      ) {
        messages.push({
          role: "system",
          content: "ℹ️ لم تتوفر مطابقة كافية من الفهرس المحلي لهذا التفصيل. إن كان السؤال عن السمات الشخصية لأبي الفضل العباس (عليه السلام) مثل الأبناء أو الألقاب، يمكنك الإجابة من المعرفة التاريخية الموثوقة بصياغة مباشرة ومختصرة، ولا تنتقل إلى أخبار مشاريع العتبة.",
        })
      }
    }
  }

  const weakToolEntityCoverage = extractedEvidence.length > 0 && !evidenceCoversSpecificTokens(userQuery, extractedEvidence)
  const officeHolderWithoutName = isOfficeHolderQuery(userQuery) && extractedEvidence.length > 0 && !evidenceContainsLikelyPersonName(extractedEvidence)
  const shouldPreferKnowledgeContext =
    knowledgeInjected &&
    knowledgePriority &&
    (weakToolEntityCoverage || officeHolderWithoutName || extractedEvidence.length === 0 || topEvidenceConfidence < 70) &&
    knowledgeTopScore >= 4.5

  if (shouldPreferKnowledgeContext) {
    messages.push({
      role: "system",
      content: "📚 استخدم [سياق معرفي إضافي من النصوص الكاملة] كمصدر أول لهذا السؤال التاريخي/الاسمي. إذا كانت نتائج الأدوات مجرد تطابقات لفظية عامة أو أخبار غير مباشرة، فلا تبنِ الإجابة عليها.",
    })
  }

  if (abbasKnowledgeInjected && isAbbasBiographyQuery(userQuery)) {
    const norm = normalizeArabicLight(userQuery)
    const kCtxNorm = normalizeArabicLight(
      messages.filter(m => m.role === "system").map(m => typeof m.content === "string" ? m.content : "").join(" ")
    )
    const isCompound = isCompoundFactQuery(userQuery)
    const wivesQuery = ["زوج", "زوجة", "زوجات", "نكاح", "تزوج"].some(t => norm.includes(t))
    const knowledgeGap = wivesQuery && !kCtxNorm.includes("تزوج العباس") && !kCtxNorm.includes("زوجة العباس")

    if (isCompound || knowledgeGap) {
      console.log(`[Evidence Guard] Abbas biography — compound/gap query, combining sources`)
      if (extractedEvidence.length > 0) injectToolEvidenceBlock(messages, userQuery, extractedEvidence)
      if (knowledgeGap) {
        await resolveKnowledgeGap(messages, extractedEvidence, ["زوج", "زوجة", "زوجات", "تزوج", "نكح"])
      }
      return extractedEvidence
    }

    console.log(`[Evidence Guard] Abbas biography — simple query, suppressing tool results`)
    return knowledgeEvidence.length > 0 ? knowledgeEvidence : []
  }

  if (abbasKnowledgeInjected) {
    console.log(`[Evidence Guard] Abbas shrine/activity query — tool-result evidence allowed`)
    injectToolEvidenceBlock(messages, userQuery, extractedEvidence)
    return extractedEvidence
  }

  if (isHardEvidenceSensitive(userQuery)) {
    const allToolContent = messages
      .filter(m => m.role === "tool" || m.role === "system")
      .map(m => typeof m.content === "string" ? m.content : "")
      .join(" ")
    if (!hasStrongAnswerEvidence(allToolContent, userQuery)) {
      messages.push({
        role: "system",
        content: "⚠️ البيانات المسترجعة لا تحتوي على الأرقام أو التواريخ المطلوبة. أجب فقط بما هو موجود في النتائج. لا تذكر أي تاريخ أو عمر أو رقم من معرفتك العامة. إذا لم تجد المعلومة المحددة، قل: 'لم أجد هذه المعلومة في البيانات المتاحة حالياً'.",
      })
    }
  }

  if (shouldPreferKnowledgeContext) {
    return knowledgeEvidence.length > 0 ? knowledgeEvidence : []
  }

  injectToolEvidenceBlock(messages, userQuery, extractedEvidence)
  return extractedEvidence
}

// ── Direct answer generation ────────────────────────────────────────

function directAnswerSatisfiesSensitiveQuery(query: string, answer: string): boolean {
  if (!answer) return false
  if (isOfficeHolderQuery(query)) {
    return /(السيد|الشيخ|سماحه|سماحة|العلامه|العلامة)\s+[\u0621-\u064A]{2,}(?:\s+[\u0621-\u064A]{2,}){1,3}/u.test(answer)
  }
  const normAnswer = normalizeArabicLight(answer)
  const tokens = extractSpecificQueryTokens(query)
  if (tokens.length < 2) return true
  return tokens.filter(t => normAnswer.includes(t)).length >= Math.min(2, tokens.length)
}

export function tryGenerateDirectAnswer(query: string, evidence: Evidence[]): string | null {
  if (!evidence || evidence.length === 0) return null
  if (isCompoundFactQuery(query)) return null

  const understanding = understandQuery(query)
  if (understanding.operation_intent === "explain") return null

  if (understanding.operation_intent === "fact_question" && isOfficeHolderQuery(query)) {
    const generated = generateDirectAnswer(query, evidence)
    if (generated && directAnswerSatisfiesSensitiveQuery(query, generated)) {
      return generated.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim()
    }
  }

  return null
}

export function buildGroundedEvidenceFallback(query: string, evidence: Evidence[]): string | null {
  if (!evidence || evidence.length === 0) return null
  if (!evidenceCoversSpecificTokens(query, evidence)) return null
  if (isOfficeHolderQuery(query) && !evidenceContainsLikelyPersonName(evidence)) return null

  const topConfidence = evidence[0]?.confidence || 0
  const minimumConfidence = isHardEvidenceSensitive(query) ? 35 : 22
  if (topConfidence < minimumConfidence && evidence.length < 2) return null

  return formatGroundedAnswer(query, evidence.slice(0, 3))
}
