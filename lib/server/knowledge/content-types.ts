/**
 * Unified content types for the knowledge layer.
 * All sources normalize into these shapes before chunking/indexing.
 */

// ── Supported source families ───────────────────────────────────────
export type ContentSourceFamily =
  | "news"
  | "video"
  | "history"
  | "abbas"
  | "language"
  | "category"

export type ContentSourceId =
  | "articles_latest"
  | "videos_latest"
  | "videos_by_category"
  | "videos_categories"
  | "shrine_history_sections"
  | "shrine_history_by_section"
  | "abbas_history_by_id"
  | "abbas_local_dataset"
  | "lang_words_ar"

// ── Normalized content item ─────────────────────────────────────────
export interface NormalizedContent {
  id: string
  source: ContentSourceId
  family: ContentSourceFamily
  title: string
  section: string
  url: string
  published_at: string          // ISO date
  summary: string               // short description / first 300 chars
  full_text: string             // richest text available
  metadata: ContentMetadata
}

export interface ContentMetadata {
  image?: string
  category?: string
  address?: string
  original_id?: string | number
  extra?: Record<string, unknown>
}

// ── Chunk ───────────────────────────────────────────────────────────
export interface ContentChunk {
  chunk_id: string              // `${parent_id}__c${chunk_index}`
  parent_id: string             // NormalizedContent.id
  source: ContentSourceId
  family: ContentSourceFamily
  title: string
  url: string
  section: string
  published_at: string
  chunk_text: string
  chunk_index: number
}

// ── Search result ───────────────────────────────────────────────────
export interface ChunkSearchResult {
  chunk: ContentChunk
  score: number
  evidence_snippet: string      // window around best match
}

export interface KnowledgeSearchResponse {
  chunks: ChunkSearchResult[]
  total_hits: number
  query: string
  sources_used: ContentSourceId[]
}

// ── Ingestion status ────────────────────────────────────────────────
export interface IngestionStatus {
  source: ContentSourceId
  items_ingested: number
  chunks_created: number
  last_ingested_at: number      // Date.now()
  error?: string
}

// ── Ingestion progress (for incremental page ingestion) ─────────────
export interface IngestionProgress {
  source: ContentSourceId
  pages_ingested: number        // how many pages have been ingested
  total_pages: number           // last_page from API metadata (0 = unknown)
  last_page_ingested_at: number // Date.now() of last page batch
}
