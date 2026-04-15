/**
 * Knowledge Search — high-level retrieval over the chunk index.
 *
 * Provides `searchKnowledgeChunks()` which:
 *  1. Normalizes the Arabic query
 *  2. Queries the inverted index
 *  3. Re-ranks results with multi-signal scoring
 *  4. Builds evidence snippets
 *  5. Returns KnowledgeSearchResponse
 */

import type {
  ContentChunk,
  ContentSourceId,
  ChunkSearchResult,
  KnowledgeSearchResponse,
} from "./content-types"
import { getKnowledgeIndex, normalizeArabic, tokenize } from "./knowledge-index"
import { backfillOlderPages, getBackfillSourcesForQuery } from "./content-ingestion"

// ── Evidence snippet builder ────────────────────────────────────────

function buildEvidenceSnippet(
  chunkText: string,
  queryTokens: string[],
  windowSize = 300
): string {
  const normText = normalizeArabic(chunkText)

  // Find best match position — where the most query tokens cluster
  let bestPos = 0
  let bestCount = 0

  for (let i = 0; i < normText.length - 20; i += 15) {
    const window = normText.substring(i, i + windowSize)
    const count = queryTokens.filter(t => window.includes(t)).length
    if (count > bestCount) {
      bestCount = count
      bestPos = i
    }
  }

  // Extract window from ORIGINAL text (not normalized)
  const start = Math.max(0, bestPos - 20)
  const end = Math.min(chunkText.length, start + windowSize)
  let snippet = chunkText.substring(start, end).trim()

  if (start > 0) snippet = "…" + snippet
  if (end < chunkText.length) snippet = snippet + "…"

  return snippet
}

// ── Re-ranker ───────────────────────────────────────────────────────

interface RankSignals {
  termCoverage: number    // fraction of query tokens found in chunk (from index)
  titleMatch: number      // bonus for title matches
  sectionMatch: number    // bonus for section matches
  exactPhraseMatch: number // bonus for exact query substring
  textDensity: number     // fraction of tokens found in chunk_text specifically
  exactTitleHit: number   // 1 if query is an exact substring of title (or vice-versa)
  familyBoost: number     // boost for history-family chunks on history queries
  typeConstraint: number  // boost when user explicitly requests a content type
}

/** Quick check: does the query look like it's asking about history / biography */
function isHistoryQuery(normQuery: string): boolean {
  const hints = [
    "تاريخ", "عتبه", "عباس", "سدنه", "كلدار", "ضريح", "مرقد",
    "حرم", "صحن", "زياره", "سيره", "حياه", "استشهاد", "نبذه",
    "history", "shrine", "biography",
  ]
  return hints.some(h => normQuery.includes(h))
}

/** Check if query is specifically about Abbas biography / traits / family */
function isAbbasQuery(normQuery: string): boolean {
  const abbasHints = [
    "عباس بن علي", "ابو الفضل", "ابي الفضل", "ابا الفضل",
    "حياه العباس", "سيره العباس", "القاب العباس", "صفات العباس",
    "اخوه العباس", "اخوات العباس", "زواج العباس", "كنيه العباس",
    "نشاه العباس", "استشهاد العباس", "شهاده العباس",
    "قمر بني هاشم", "سقايه العباس", "موقفه في الطف",
    "ام البنين", "اعمام العباس", "ابناء العباس", "اولاد العباس",
    "ولاده العباس", "مولد العباس", "دفن العباس", "قبر العباس",
  ]
  // Direct match on compound phrases
  if (abbasHints.some(h => normQuery.includes(h))) return true
  // Single "عباس" or "ابو الفضل" + biographical keyword
  const hasAbbasName = normQuery.includes("عباس") || normQuery.includes("ابو الفضل") || normQuery.includes("ابي الفضل")
  if (hasAbbasName) {
    const bioHints = [
      "من هو", "نبذه", "حياه", "سيره", "القاب", "صفات", "اخو", "اخوات",
      "زواج", "كنيه", "نشا", "عمر", "استشهد", "شهاد", "ولاد", "مولد",
      "متي", "اين", "دفن", "قبر", "ماذا", "ما هي", "ما هو", "عن",
      "يذكر", "تعريف", "وصف", "اعمام", "ابناء", "اولاد",
    ]
    if (bioHints.some(h => normQuery.includes(h))) return true
    // Standalone Abbas name in a question context (short query) is likely biographical
    if (normQuery.length < 40) return true
  }
  return false
}

/** Check if query is about Friday sermons / وحي الجمعة */
function isFridayQuery(normQuery: string): boolean {
  const hints = [
    "خطبه", "خطب", "جمعه", "صلاه الجمعه", "وحي الجمعه",
    "خطيب", "منبر", "صلاه جمعه", "من وحي", "وحي",
  ]
  return hints.some(h => normQuery.includes(h))
}

/** Detect explicit content-type constraint from the query.
 *  Returns the preferred ContentSourceFamily, or null. */
function detectTypeConstraint(normQuery: string): import("./content-types").ContentSourceFamily | null {
  const typeMap: [string[], import("./content-types").ContentSourceFamily][] = [
    [["فيديو", "فديو", "مرئي", "مقطع", "يوتيوب"], "video"],
    [["خبر", "مقال", "مقاله", "اخبار"], "news"],
    [["خطبه", "خطب الجمعه", "صلاه الجمعه", "وحي الجمعه", "من وحي", "وحي"], "sermon"],
    [["اصدار", "اصدارات", "كتاب", "كتب", "مطبوع"], "news"],  // publications are articles
  ]
  for (const [hints, family] of typeMap) {
    if (hints.some(h => normQuery.includes(h))) return family
  }
  return null
}

/**
 * Prefix-fuzzy search over Abbas chunks.
 * Bridges Arabic morphological gaps:
 *  - "اخوه" matches "اخوته" (shared prefix "اخو")
 *  - "زواج" matches "الزواج" (prefix "زوا" found as substring)
 *
 * Multi-signal scoring: full-token match > prefix-in-title > prefix-in-text.
 */
function fuzzySearchAbbasChunks(
  query: string,
  queryTokens: string[],
  limit: number = 4
): ChunkSearchResult[] {
  const index = getKnowledgeIndex()
  const abbasChunks = index.getChunksBySource("abbas_local_dataset")
  if (abbasChunks.length === 0) return []

  const MIN_PREFIX_LEN = 3
  // Non-trivial tokens only
  const tokens = queryTokens.filter(t => t.length >= MIN_PREFIX_LEN)
  if (tokens.length === 0) return []

  const prefixes = tokens.map(t => t.substring(0, MIN_PREFIX_LEN))

  const scored: { chunk: ContentChunk; fuzzyScore: number }[] = []

  for (const chunk of abbasChunks) {
    const titleHaystack = normalizeArabic(`${chunk.title} ${chunk.section}`)
    const textHaystack = normalizeArabic(chunk.chunk_text)

    let score = 0
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]
      const pre = prefixes[i]
      // Full token match is strongest signal
      if (titleHaystack.includes(tok))      score += 4.0
      else if (titleHaystack.includes(pre)) score += 2.0
      if (textHaystack.includes(tok))       score += 1.0
      else if (textHaystack.includes(pre))  score += 0.5
    }
    if (score === 0) continue
    scored.push({ chunk, fuzzyScore: score / tokens.length })
  }

  scored.sort((a, b) => b.fuzzyScore - a.fuzzyScore)

  return scored.slice(0, limit).map(({ chunk, fuzzyScore }) => {
    const evidence = buildEvidenceSnippet(chunk.chunk_text, queryTokens)
    const finalScore = fuzzyScore * 2.5 + 5.0 // strong Abbas baseline to compete with reranked results
    return { chunk, score: finalScore, evidence_snippet: evidence }
  })
}

function rerank(
  chunk: ContentChunk,
  queryTokens: string[],
  rawQuery: string,
  indexScore: number
): number {
  const signals: RankSignals = {
    termCoverage: indexScore, // already 0–1 from index
    titleMatch: 0,
    sectionMatch: 0,
    exactPhraseMatch: 0,
    textDensity: 0,
    exactTitleHit: 0,
    familyBoost: 0,
    typeConstraint: 0,
  }

  const normTitle = normalizeArabic(chunk.title)
  const normSection = normalizeArabic(chunk.section)
  const normText = normalizeArabic(chunk.chunk_text)
  const normQuery = normalizeArabic(rawQuery)

  // Title match: how many query tokens appear in title
  const titleHits = queryTokens.filter(t => normTitle.includes(t)).length
  signals.titleMatch = queryTokens.length > 0 ? titleHits / queryTokens.length : 0

  // Exact title hit: query is a substring of the title, or title in query
  if (normQuery.length >= 3 && (normTitle.includes(normQuery) || normQuery.includes(normTitle))) {
    signals.exactTitleHit = 1
  }

  // Section match
  const sectionHits = queryTokens.filter(t => normSection.includes(t)).length
  signals.sectionMatch = queryTokens.length > 0 ? sectionHits / queryTokens.length : 0

  // Exact phrase match: full normalized query appears as substring
  if (normQuery.length > 4 && normText.includes(normQuery)) {
    signals.exactPhraseMatch = 1
  } else if (queryTokens.length >= 2) {
    // Partial phrase: count how many consecutive bigrams match in body text
    let bigramHits = 0
    for (let i = 0; i < queryTokens.length - 1; i++) {
      const bigram = queryTokens[i] + " " + queryTokens[i + 1]
      if (normText.includes(bigram)) bigramHits++
    }
    if (bigramHits > 0) {
      signals.exactPhraseMatch = Math.min(1, bigramHits / (queryTokens.length - 1)) * 0.6
    }
  }

  // Text density: token hits in chunk_text specifically
  const textHits = queryTokens.filter(t => normText.includes(t)).length
  signals.textDensity = queryTokens.length > 0 ? textHits / queryTokens.length : 0

  // Family boost: history/abbas chunks get a boost on relevant queries
  if (isHistoryQuery(normQuery) && chunk.family === "history") {
    signals.familyBoost = 1
  }
  // Strong boost for Abbas local dataset on Abbas-specific queries
  if (isAbbasQuery(normQuery) && chunk.family === "abbas") {
    signals.familyBoost = 2.5
  }
  // Penalize generic news/video results on clear Abbas biographical queries
  // to prevent shrine-activity news from outranking real Abbas biography content
  if (isAbbasQuery(normQuery) && (chunk.family === "news" || chunk.family === "video")) {
    signals.familyBoost = -0.8
  }
  // Boost sermon-family chunks on Friday sermon queries
  if (isFridayQuery(normQuery) && chunk.family === "sermon") {
    signals.familyBoost = 2.0
  }
  // Penalize generic news/video results on clear Friday sermon queries
  if (isFridayQuery(normQuery) && (chunk.family === "news" || chunk.family === "video")) {
    signals.familyBoost = -0.6
  }

  // Type constraint: explicit content-type preference from query
  const preferredType = detectTypeConstraint(normQuery)
  if (preferredType && chunk.family === preferredType) {
    signals.typeConstraint = 1
  }

  // Weighted combination
  const score =
    signals.termCoverage * 3.0 +
    signals.titleMatch * 4.0 +
    signals.sectionMatch * 2.0 +
    signals.exactPhraseMatch * 5.0 +
    signals.textDensity * 2.5 +
    signals.exactTitleHit * 3.5 +
    signals.familyBoost * 2.0 +
    signals.typeConstraint * 3.0

  return score
}

// ── Public API ──────────────────────────────────────────────────────

export interface KnowledgeSearchOptions {
  sources?: ContentSourceId[]
  limit?: number            // max results (default 8)
  minScore?: number         // minimum reranked score (default 1.0)
}

/**
 * Search the knowledge index for chunks matching a user query.
 *
 * @returns KnowledgeSearchResponse with ranked chunks + evidence snippets
 */
export function searchKnowledgeChunks(
  query: string,
  options: KnowledgeSearchOptions = {}
): KnowledgeSearchResponse {
  const limit = options.limit ?? 8
  const minScore = options.minScore ?? 1.0
  const index = getKnowledgeIndex()

  if (index.size === 0) {
    return { chunks: [], total_hits: 0, query, sources_used: [] }
  }

  const queryTokens = tokenize(query).filter(t => t.length >= 2)
  if (queryTokens.length === 0) {
    return { chunks: [], total_hits: 0, query, sources_used: [] }
  }

  // Phase 1: inverted-index retrieval (fast, broad recall)
  const candidates = index.query(query, {
    sources: options.sources,
    limit: limit * 4, // fetch more candidates for reranking
  })

  // Phase 2: rerank with multi-signal scoring
  const scored: ChunkSearchResult[] = []

  for (const { chunk_id, score: rawScore } of candidates) {
    const chunk = index.getChunk(chunk_id)
    if (!chunk) continue

    const finalScore = rerank(chunk, queryTokens, query, rawScore)
    if (finalScore < minScore) continue

    const evidence = buildEvidenceSnippet(chunk.chunk_text, queryTokens)

    scored.push({
      chunk,
      score: finalScore,
      evidence_snippet: evidence,
    })
  }

  // Sort by final score descending, with recency tiebreaker
  scored.sort((a, b) => {
    const scoreDiff = b.score - a.score
    if (Math.abs(scoreDiff) > 0.5) return scoreDiff
    // Tiebreaker: newer content first
    return (b.chunk.published_at || "").localeCompare(a.chunk.published_at || "")
  })

  // Deduplicate: keep best chunk per parent_id
  // Allow more chunks from Abbas dataset on Abbas queries (biographical content is long)
  const normQueryForDedup = normalizeArabic(query)
  const isAbbasQ = isAbbasQuery(normQueryForDedup)
  const deduped: ChunkSearchResult[] = []
  for (const r of scored) {
    const maxPerParent = (isAbbasQ && r.chunk.family === "abbas") ? 4 : 2
    const parentCount = deduped.filter(d => d.chunk.parent_id === r.chunk.parent_id).length
    if (parentCount >= maxPerParent) continue
    deduped.push(r)
    if (deduped.length >= limit) break
  }

  // Collect sources used
  const sourcesUsed = [...new Set(deduped.map(r => r.chunk.source))]

  return {
    chunks: deduped,
    total_hits: scored.length,
    query,
    sources_used: sourcesUsed,
  }
}

// ── Backfill-aware search ───────────────────────────────────────────

/** Thresholds for deciding if initial results are "weak" */
const WEAK_MIN_CHUNKS = 2
const WEAK_TOP_SCORE = 4.0

function isWeakResult(response: KnowledgeSearchResponse): boolean {
  if (response.chunks.length === 0) return true
  if (response.chunks.length < WEAK_MIN_CHUNKS) return true
  if (response.chunks[0].score < WEAK_TOP_SCORE) return true
  return false
}

/**
 * Search with Abbas source preference and optional lazy-backfill retry.
 *
 * Flow:
 *  1. Run initial searchKnowledgeChunks
 *  1b. If Abbas query and initial results lack Abbas data, merge Abbas-scoped search
 *  2. If results are weak, pick backfill sources for the query
 *  3. Backfill one batch per source (bounded)
 *  4. Retry searchKnowledgeChunks once
 *  5. Return whichever result set is better
 */
export async function searchKnowledgeWithBackfill(
  query: string,
  options: KnowledgeSearchOptions = {}
): Promise<KnowledgeSearchResponse & { backfilled: boolean }> {
  // Phase 1: initial search
  let initial = searchKnowledgeChunks(query, options)
  console.log(`[Knowledge] Initial search: ${initial.chunks.length} chunks (top=${initial.chunks[0]?.score.toFixed(1) ?? "–"})`)

  // Phase 1b: Abbas query enrichment — fuzzy prefix search over Abbas chunks.
  // Bridges Arabic morphological gaps (e.g., "اخوه" ↔ "اخوته", "زواج" ↔ "الزواج").
  const normQ = normalizeArabic(query)
  if (isAbbasQuery(normQ)) {
    const queryTokens = tokenize(query).filter(t => t.length >= 2)
    const limit = options.limit ?? 8
    const abbasResults = fuzzySearchAbbasChunks(query, queryTokens, limit)
    if (abbasResults.length > 0) {
      console.log(`[Knowledge] Abbas enrichment (fuzzy): +${abbasResults.length} Abbas chunks`)
      // Score-based merge: combine, deduplicate, sort by score, keep best
      const allResults = [...abbasResults, ...initial.chunks]
      const seenIds = new Set<string>()
      const deduped = allResults.filter(c => {
        if (seenIds.has(c.chunk.chunk_id)) return false
        seenIds.add(c.chunk.chunk_id)
        return true
      })
      deduped.sort((a, b) => b.score - a.score)
      const merged = deduped.slice(0, limit)
      initial = {
        ...initial,
        chunks: merged,
        total_hits: initial.total_hits + abbasResults.length,
        sources_used: [...new Set([...initial.sources_used, "abbas_local_dataset" as ContentSourceId])],
      }
    }
  }

  if (!isWeakResult(initial)) {
    return { ...initial, backfilled: false }
  }

  // Phase 2: find backfill candidates
  const sources = getBackfillSourcesForQuery(query)
  if (sources.length === 0) {
    console.log(`[Knowledge] Weak results but no backfill sources available`)
    return { ...initial, backfilled: false }
  }

  // Phase 3: backfill one batch per source (incremental, stop early once strong)
  console.log(`[Knowledge] Weak results — backfilling: ${sources.join(", ")}`)
  let totalNew = 0
  let best = initial
  for (const src of sources) {
    const newItems = await backfillOlderPages(src)
    totalNew += newItems

    if (newItems <= 0) continue

    const retry = searchKnowledgeChunks(query, options)
    console.log(`[Knowledge] Backfill checkpoint (${src}): ${retry.chunks.length} chunks (top=${retry.chunks[0]?.score.toFixed(1) ?? "–"}) [+${newItems}]`)

    if (
      retry.chunks.length > best.chunks.length ||
      (retry.chunks[0]?.score ?? 0) > (best.chunks[0]?.score ?? 0)
    ) {
      best = retry
    }

    if (!isWeakResult(retry)) {
      return { ...retry, backfilled: true }
    }
  }

  if (totalNew === 0) {
    console.log(`[Knowledge] Backfill produced 0 new items`)
    return { ...initial, backfilled: true }
  }

  console.log(`[Knowledge] After backfill: ${best.chunks.length} chunks (top=${best.chunks[0]?.score.toFixed(1) ?? "–"}) [+${totalNew} items]`)
  return { ...best, backfilled: true }
}
