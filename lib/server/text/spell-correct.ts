/**
 * Lexicon-based Arabic spell-correction.
 *
 * Goal: catch obvious typos in user queries BEFORE the retrieval pipeline
 * spends seconds chasing 0-result paths across multiple sources.
 *
 * Approach (deliberately simple, no external dependencies):
 *   1. Build a vocabulary from the in-memory KnowledgeIndex once
 *      (titles, sections, body terms across all sources).
 *   2. Bucket terms by length for cheap candidate filtering — for a
 *      query token of length L we only consider vocab terms of
 *      length L-2 .. L+2.
 *   3. For each query token of length ≥ 4 that does NOT appear in the
 *      vocabulary, find the closest known term within a tight
 *      Damerau-Levenshtein cap (1 for short, 2 for long). Tie-break by
 *      term frequency (more frequent → more likely intended).
 *
 * The corrected query is returned alongside the original; we never
 * mutate stored content. Replacements are also reported so callers can
 * surface a "هل تقصد …؟" hint and so we can log them for evaluation.
 */

import { getKnowledgeIndex } from "../knowledge/knowledge-index"
import {
  damerauLevenshteinAtMost,
  maxEditsForLength,
  softFoldArabic,
} from "./arabic-fuzzy"

/** Same normalization the index uses (kept inline to avoid an import cycle). */
function normalizeArabic(text: string): string {
  return (text || "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[\u0622\u0623\u0625\u0627]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

export interface SpellCorrection {
  from: string
  to: string
  distance: number
}

export interface CorrectedQuery {
  original: string
  corrected: string
  corrections: SpellCorrection[]
}

/**
 * Tokens we never attempt to correct. They are either function words
 * (already too short to safely fuzzy-match) or domain-specific names that
 * may legitimately not appear in the vocabulary.
 */
const PROTECTED_TOKENS = new Set<string>([
  "الله", "محمد", "علي", "حسين", "حسن", "زينب", "فاطمه",
  "العباس", "كربلاء", "النجف",
])

/**
 * Strip common Arabic prefixes (و، ف، ال، لل، بال، كال…) for vocabulary
 * lookup purposes. Returns the stripped form and the prefix that was
 * removed (so the corrected token can be re-prefixed).
 */
function splitArabicPrefix(token: string): { prefix: string; stem: string } {
  if (token.length < 5) return { prefix: "", stem: token }
  // Order matters: longer prefixes first
  const prefixes = ["وال", "فال", "بال", "كال", "لل", "ال", "و", "ف", "ب", "ل", "ك"]
  for (const p of prefixes) {
    if (token.startsWith(p) && token.length - p.length >= 3) {
      return { prefix: p, stem: token.slice(p.length) }
    }
  }
  return { prefix: "", stem: token }
}

// ── Vocabulary cache ────────────────────────────────────────────────

interface VocabBucket {
  /** terms grouped by length: bucketsByLen[L] = list of terms of length L */
  buckets: Map<number, string[]>
  /** soft-folded view for second-pass matching: foldedToOriginal[fold] = best original */
  folded: Map<string, string>
  /** total term count when this snapshot was built */
  size: number
}

let _vocab: VocabBucket | null = null
let _vocabBuiltAtSize = -1

function buildVocab(): VocabBucket {
  const idx = getKnowledgeIndex()
  const buckets = new Map<number, string[]>()
  const folded = new Map<string, string>()

  for (const term of idx.getVocabulary()) {
    if (term.length < 3) continue
    const list = buckets.get(term.length) ?? []
    list.push(term)
    buckets.set(term.length, list)

    const fold = softFoldArabic(term)
    if (fold !== term && !folded.has(fold)) folded.set(fold, term)
  }
  return { buckets, folded, size: idx.size }
}

function getVocab(): VocabBucket {
  const idx = getKnowledgeIndex()
  // Rebuild only when the index size has changed (cheap pointer check).
  if (!_vocab || idx.size !== _vocabBuiltAtSize) {
    _vocab = buildVocab()
    _vocabBuiltAtSize = idx.size
  }
  return _vocab
}

/** True if the (already-normalized) token exists verbatim in the vocabulary. */
function isKnownTerm(token: string, vocab: VocabBucket): boolean {
  const list = vocab.buckets.get(token.length)
  if (!list) return false
  // Linear scan is acceptable: per-length buckets are typically a few thousand
  // entries and we only call this once per query token.
  return list.indexOf(token) !== -1
}

interface Candidate {
  term: string
  distance: number
  frequency: number
}

/**
 * Find the best correction for a single token. Returns null if no
 * candidate is within the allowed edit distance, or if the token is
 * already known / too short / protected.
 */
function correctToken(
  rawToken: string,
  vocab: VocabBucket,
  idx = getKnowledgeIndex()
): Candidate | null {
  if (rawToken.length < 4) return null
  if (PROTECTED_TOKENS.has(rawToken)) return null

  const { prefix, stem } = splitArabicPrefix(rawToken)
  if (PROTECTED_TOKENS.has(stem)) return null

  // Already in vocabulary (either with or without prefix) → no correction.
  if (isKnownTerm(rawToken, vocab)) return null
  if (prefix && isKnownTerm(stem, vocab)) return null

  // Try soft-fold match first (cheap, catches س↔ص, ت↔ط, etc.).
  // Try the full token AND the stem (if a prefix was split off).
  const foldedFull = softFoldArabic(rawToken)
  const foldHitFull = vocab.folded.get(foldedFull)
  if (foldHitFull && foldHitFull !== rawToken) {
    return {
      term: foldHitFull,
      distance: 1,
      frequency: idx.getTermFrequency(foldHitFull),
    }
  }
  if (prefix && stem.length >= 3) {
    const foldedStem = softFoldArabic(stem)
    const foldHitStem = vocab.folded.get(foldedStem)
    if (foldHitStem && foldHitStem !== stem) {
      return {
        term: prefix + foldHitStem,
        distance: 1,
        frequency: idx.getTermFrequency(foldHitStem),
      }
    }
  }

  // Damerau-Levenshtein scan: try the full token first (most reliable),
  // then fall back to the stripped stem so prefixed forms can rescue
  // stems that are too short for the cap on their own.
  const tryScan = (target: string, prefixForOutput: string): Candidate | null => {
    const cap = maxEditsForLength(target.length)
    if (cap === 0) return null
    let best: Candidate | null = null
    for (let len = target.length - cap; len <= target.length + cap; len++) {
      const list = vocab.buckets.get(len)
      if (!list) continue
      for (const cand of list) {
        const d = damerauLevenshteinAtMost(target, cand, cap)
        if (d > cap) continue
        const freq = idx.getTermFrequency(cand)
        if (
          !best ||
          d < best.distance ||
          (d === best.distance && freq > best.frequency)
        ) {
          best = { term: prefixForOutput + cand, distance: d, frequency: freq }
        }
      }
    }
    return best
  }

  return tryScan(rawToken, "") ?? (prefix ? tryScan(stem, prefix) : null)
}

/**
 * Correct typos in a query using the in-memory knowledge vocabulary.
 *
 * Safe to call even when the index is empty — returns the original
 * query unchanged with no corrections.
 *
 * Performance: O(Q × V/buckets) per query, ~sub-millisecond for normal
 * Arabic queries (a handful of tokens, ~50–200 candidates per length
 * bucket on the current dataset).
 */
export function correctArabicQuery(query: string): CorrectedQuery {
  const original = String(query || "")
  if (!original.trim()) {
    return { original, corrected: original, corrections: [] }
  }

  const vocab = getVocab()
  if (vocab.size === 0) {
    return { original, corrected: original, corrections: [] }
  }

  const corrections: SpellCorrection[] = []
  const rebuilt = original.replace(/[\u0621-\u064A]+/g, (rawWord) => {
    const norm = normalizeArabic(rawWord)
    if (norm.length < 4) return rawWord
    const candidate = correctToken(norm, vocab)
    if (!candidate) return rawWord
    if (candidate.term === norm) return rawWord
    corrections.push({ from: rawWord, to: candidate.term, distance: candidate.distance })
    return candidate.term
  })

  return {
    original,
    corrected: corrections.length === 0 ? original : rebuilt,
    corrections,
  }
}

/**
 * Test-only: clear the vocabulary cache so the next call rebuilds it.
 */
export function _resetSpellCorrectorCacheForTests(): void {
  _vocab = null
  _vocabBuiltAtSize = -1
}
