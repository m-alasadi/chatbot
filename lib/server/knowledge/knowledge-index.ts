/**
 * Knowledge Index — in-memory inverted index over ContentChunks.
 *
 * Provides fast lexical retrieval without external dependencies.
 * Architecture is ready for later semantic embeddings bolt-on.
 *
 * Index structure:
 *   term → Set<chunk_id>
 *   chunk_id → ContentChunk
 *
 * Arabic text is fully normalized before indexing / querying.
 */

import type { ContentChunk, ContentSourceId } from "./content-types"

// ── Arabic normalization (shared with the rest of the codebase) ─────

export function normalizeArabic(text: string): string {
  return (text || "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "")   // strip tashkeel
    .replace(/\u0640/g, "")                                   // strip tatweel
    .replace(/[\u0622\u0623\u0625\u0627]/g, "\u0627")        // normalize alef → ا
    .replace(/\u0649/g, "\u064A")                             // ى → ي
    .replace(/\u0629/g, "\u0647")                             // ة → ه
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

export function tokenize(text: string): string[] {
  return normalizeArabic(text)
    .split(/\s+/)
    .filter(w => w.length >= 2)
}

// ── Stop words (common Arabic function words) ───────────────────────
const STOP_WORDS = new Set([
  "في", "من", "الي", "على", "عن", "مع", "هذا", "هذه", "ذلك", "تلك",
  "التي", "الذي", "الذين", "اللذين", "اللتين", "ان", "لا", "ما",
  "هل", "قد", "كان", "يكون", "بين", "حتي", "لان", "اذا", "اذ",
  "او", "ثم", "بل", "لكن", "وهو", "وهي", "كما", "بها", "فيها",
  "منها", "عنها", "لها", "اما",
])

function isStopWord(token: string): boolean {
  return STOP_WORDS.has(token) || token.length < 2
}

// ── Index class ─────────────────────────────────────────────────────

export class KnowledgeIndex {
  /** term → set of chunk_ids */
  private invertedIndex = new Map<string, Set<string>>()

  /** chunk_id → ContentChunk */
  private chunkStore = new Map<string, ContentChunk>()

  /** source → set of chunk_ids (for source-scoped queries) */
  private sourceIndex = new Map<string, Set<string>>()

  /** Track index size for diagnostics */
  get size(): number {
    return this.chunkStore.size
  }

  get termCount(): number {
    return this.invertedIndex.size
  }

  // ── Indexing ────────────────────────────────────────────────────

  /**
   * Add chunks to the index. Safe to call multiple times (idempotent per chunk_id).
   */
  addChunks(chunks: ContentChunk[]): void {
    for (const chunk of chunks) {
      if (this.chunkStore.has(chunk.chunk_id)) continue
      this.chunkStore.set(chunk.chunk_id, chunk)

      // Source index
      if (!this.sourceIndex.has(chunk.source)) {
        this.sourceIndex.set(chunk.source, new Set())
      }
      this.sourceIndex.get(chunk.source)!.add(chunk.chunk_id)

      // Inverted index: index chunk_text + title + section
      const textToIndex = `${chunk.title} ${chunk.section} ${chunk.chunk_text}`
      const tokens = tokenize(textToIndex)
      for (const token of tokens) {
        if (isStopWord(token)) continue
        if (!this.invertedIndex.has(token)) {
          this.invertedIndex.set(token, new Set())
        }
        this.invertedIndex.get(token)!.add(chunk.chunk_id)
      }
    }
  }

  /**
   * Remove all chunks from a given source (for refresh).
   */
  removeSource(source: ContentSourceId): void {
    const ids = this.sourceIndex.get(source)
    if (!ids) return

    for (const id of ids) {
      this.chunkStore.delete(id)
    }

    // Rebuild inverted index (brute but reliable for small-scale)
    this.invertedIndex.clear()
    this.sourceIndex.delete(source)

    for (const [, chunk] of this.chunkStore) {
      const textToIndex = `${chunk.title} ${chunk.section} ${chunk.chunk_text}`
      const tokens = tokenize(textToIndex)
      for (const token of tokens) {
        if (isStopWord(token)) continue
        if (!this.invertedIndex.has(token)) {
          this.invertedIndex.set(token, new Set())
        }
        this.invertedIndex.get(token)!.add(chunk.chunk_id)
      }
    }
  }

  // ── Querying ────────────────────────────────────────────────────

  /**
   * Retrieve chunk_ids matching a query, ranked by term coverage.
   *
   * Returns: array of { chunk_id, score } sorted by score desc.
   */
  query(
    queryText: string,
    options: {
      sources?: ContentSourceId[]
      limit?: number
    } = {}
  ): { chunk_id: string; score: number }[] {
    const tokens = tokenize(queryText).filter(t => !isStopWord(t))
    if (tokens.length === 0) return []

    // Gather candidate chunk_ids with hit counts
    const scores = new Map<string, number>()

    // Source filter (if specified)
    const allowedChunks: Set<string> | null = options.sources
      ? (() => {
          const s = new Set<string>()
          for (const src of options.sources!) {
            const ids = this.sourceIndex.get(src)
            if (ids) ids.forEach(id => s.add(id))
          }
          return s
        })()
      : null

    for (const token of tokens) {
      const chunkIds = this.invertedIndex.get(token)
      if (!chunkIds) continue

      for (const cid of chunkIds) {
        if (allowedChunks && !allowedChunks.has(cid)) continue
        scores.set(cid, (scores.get(cid) || 0) + 1)
      }
    }

    // Sort by hit count descending
    const results = [...scores.entries()]
      .map(([chunk_id, hitCount]) => ({
        chunk_id,
        score: hitCount / tokens.length, // normalized 0-1
      }))
      .sort((a, b) => b.score - a.score)

    const limit = options.limit ?? 20
    return results.slice(0, limit)
  }

  /**
   * Get a chunk by ID.
   */
  getChunk(chunkId: string): ContentChunk | undefined {
    return this.chunkStore.get(chunkId)
  }

  /**
   * Get multiple chunks by IDs.
   */
  getChunks(chunkIds: string[]): ContentChunk[] {
    const out: ContentChunk[] = []
    for (const id of chunkIds) {
      const c = this.chunkStore.get(id)
      if (c) out.push(c)
    }
    return out
  }

  /**
   * Get all sources currently indexed.
   */
  getIndexedSources(): ContentSourceId[] {
    return [...this.sourceIndex.keys()] as ContentSourceId[]
  }

  /**
   * Check if a source has any indexed chunks.
   */
  hasSource(source: ContentSourceId): boolean {
    const ids = this.sourceIndex.get(source)
    return !!ids && ids.size > 0
  }

  /**
   * Get all chunks for a given source.
   */
  getChunksBySource(source: ContentSourceId): ContentChunk[] {
    const ids = this.sourceIndex.get(source)
    if (!ids) return []
    const out: ContentChunk[] = []
    for (const id of ids) {
      const c = this.chunkStore.get(id)
      if (c) out.push(c)
    }
    return out
  }

  /**
   * Get all sibling chunks sharing the same parent_id, ordered by chunk_index.
   * Useful for re-assembling a long document around a single match so the
   * model can see the full passage (e.g. an enumeration that spans chunks).
   */
  getChunksByParent(parentId: string): ContentChunk[] {
    const out: ContentChunk[] = []
    for (const [, chunk] of this.chunkStore) {
      if (chunk.parent_id === parentId) out.push(chunk)
    }
    out.sort((a, b) => (a.chunk_index ?? 0) - (b.chunk_index ?? 0))
    return out
  }

  /**
   * Clear entire index.
   */
  clear(): void {
    this.invertedIndex.clear()
    this.chunkStore.clear()
    this.sourceIndex.clear()
  }
}

// ── Singleton ───────────────────────────────────────────────────────
let _instance: KnowledgeIndex | null = null

export function getKnowledgeIndex(): KnowledgeIndex {
  if (!_instance) _instance = new KnowledgeIndex()
  return _instance
}
