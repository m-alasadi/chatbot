/**
 * Chunker — splits NormalizedContent into ContentChunks
 * for full-text retrieval.
 *
 * Strategy:
 *  - Short content (≤ CHUNK_SIZE) → single chunk = full_text
 *  - Long content → paragraph-aware splitting
 *  - Each chunk carries parent metadata for grounding
 */

import type { NormalizedContent, ContentChunk } from "./content-types"

// ── Configuration ───────────────────────────────────────────────────

/** Target chunk size in characters (not tokens). ~600 chars ≈ 150 Arabic tokens */
const CHUNK_TARGET = 600

/** Minimum chunk size — avoid tiny fragments */
const CHUNK_MIN = 120

/** Overlap between consecutive chunks for context continuity */
const CHUNK_OVERLAP = 80

// ── Public API ──────────────────────────────────────────────────────

/**
 * Chunk a single NormalizedContent item into one or more ContentChunks.
 * Short items produce exactly one chunk. Long items produce multiple
 * paragraph-aware chunks with overlap.
 */
export function chunkContent(item: NormalizedContent): ContentChunk[] {
  const text = (item.full_text || item.summary || "").trim()
  if (!text) return []

  // Short content — single chunk wrapping the full text
  if (text.length <= CHUNK_TARGET + CHUNK_OVERLAP) {
    return [makeChunk(item, text, 0)]
  }

  // Long content — paragraph-aware splitting
  return splitIntoParagraphChunks(item, text)
}

/**
 * Chunk an array of NormalizedContent items.
 */
export function chunkContentBatch(items: NormalizedContent[]): ContentChunk[] {
  const out: ContentChunk[] = []
  for (const item of items) {
    out.push(...chunkContent(item))
  }
  return out
}

// ── Internal helpers ────────────────────────────────────────────────

function makeChunk(
  parent: NormalizedContent,
  text: string,
  index: number
): ContentChunk {
  return {
    chunk_id: `${parent.id}__c${index}`,
    parent_id: parent.id,
    source: parent.source,
    family: parent.family,
    title: parent.title,
    url: parent.url,
    section: parent.section,
    published_at: parent.published_at,
    chunk_text: text,
    chunk_index: index,
  }
}

/**
 * Split long text into paragraph-aware chunks.
 * 1. Split by paragraph boundary (\n\n or \n)
 * 2. Greedily merge consecutive paragraphs into chunks
 *    until CHUNK_TARGET reached
 * 3. Add CHUNK_OVERLAP from previous chunk to maintain continuity
 */
function splitIntoParagraphChunks(
  parent: NormalizedContent,
  text: string
): ContentChunk[] {
  // Split into paragraphs / sentences
  const paragraphs = text
    .split(/\n{2,}/)
    .flatMap(p => {
      // If a single paragraph is huge, break it further at sentence boundaries
      if (p.length > CHUNK_TARGET) {
        return splitAtSentences(p)
      }
      return [p.trim()]
    })
    .filter(p => p.length > 0)

  if (paragraphs.length === 0) return []

  const chunks: ContentChunk[] = []
  let buffer = ""
  let chunkIndex = 0
  let prevTail = "" // overlap text from previous chunk

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]

    if (buffer.length === 0 && prevTail) {
      // Start new chunk with overlap from previous
      buffer = prevTail
    }

    const combined = buffer ? `${buffer}\n${para}` : para

    if (combined.length >= CHUNK_TARGET && buffer.length >= CHUNK_MIN) {
      // Flush current buffer as a chunk
      chunks.push(makeChunk(parent, buffer.trim(), chunkIndex++))
      prevTail = extractOverlap(buffer)
      buffer = prevTail ? `${prevTail}\n${para}` : para
    } else {
      buffer = combined
    }
  }

  // Flush remaining buffer
  const remaining = buffer.trim()
  if (remaining.length >= CHUNK_MIN) {
    chunks.push(makeChunk(parent, remaining, chunkIndex))
  } else if (remaining.length > 0 && chunks.length > 0) {
    // Too small — append to last chunk to avoid broken fragments
    const last = chunks[chunks.length - 1]
    last.chunk_text = `${last.chunk_text}\n${remaining}`
  } else if (remaining.length > 0) {
    // Only chunk in the output — keep it regardless of size
    chunks.push(makeChunk(parent, remaining, chunkIndex))
  }

  return chunks
}

/** Split a long paragraph into sentences (Arabic period/full-stop aware) */
function splitAtSentences(text: string): string[] {
  // Arabic sentence terminators: period, question mark, exclamation, semicolons
  const sentences = text.split(/(?<=[.。؟?!!\u061F\u061B])\s+/)
  if (sentences.length <= 1) {
    // Second attempt: split at Arabic comma (،) or regular comma
    const commaSplit = text.split(/(?<=[،,])\s+/)
    if (commaSplit.length > 1) {
      return mergeTinySentences(commaSplit)
    }
    // Last resort: fixed-length windows at word boundaries
    return splitAtFixedLength(text, CHUNK_TARGET)
  }

  return mergeTinySentences(sentences)
}

/** Merge tiny fragments into chunks respecting CHUNK_TARGET and CHUNK_MIN */
function mergeTinySentences(sentences: string[]): string[] {
  const merged: string[] = []
  let buf = ""
  for (const s of sentences) {
    if (buf.length + s.length + 1 > CHUNK_TARGET && buf.length >= CHUNK_MIN) {
      merged.push(buf.trim())
      buf = s
    } else {
      buf = buf ? `${buf} ${s}` : s
    }
  }
  if (buf.trim()) merged.push(buf.trim())
  return merged
}

/** Last-resort: split at fixed character positions */
function splitAtFixedLength(text: string, size: number): string[] {
  const parts: string[] = []
  let start = 0
  while (start < text.length) {
    let end = start + size
    if (end < text.length) {
      // Try to break at a space
      const spaceIdx = text.lastIndexOf(" ", end)
      if (spaceIdx > start + CHUNK_MIN) end = spaceIdx
    }
    parts.push(text.substring(start, end).trim())
    start = end
  }
  return parts.filter(p => p.length > 0)
}

/** Extract last N characters from a chunk for overlap */
function extractOverlap(text: string): string {
  if (text.length <= CHUNK_OVERLAP) return text
  const tail = text.substring(text.length - CHUNK_OVERLAP)
  // Try to start at a word boundary
  const spaceIdx = tail.indexOf(" ")
  return spaceIdx > 0 ? tail.substring(spaceIdx + 1) : tail
}
