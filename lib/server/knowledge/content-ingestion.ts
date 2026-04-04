/**
 * Content Ingestion — fetches raw API data, normalizes, chunks,
 * and feeds the knowledge index.
 *
 * Phase 2.1 improvements:
 *  - History deep-ingestion: fetches section content, not just titles
 *  - Progressive page ingestion: metadata-aware, eager recent + lazy backfill
 *  - Per-source ingestion progress tracking
 *  - Bounded parametric history ingestion
 */

import { getSiteAPIConfig, fillEndpointTemplate } from "../site-api-config"
import { sanitizeAPIResponse } from "../data-sanitizer"
import { normalizeRawToContent } from "./content-normalizers"
import { chunkContentBatch } from "./chunker"
import { getKnowledgeIndex } from "./knowledge-index"
import { loadAbbasLocalDataset } from "./abbas-local-loader"
import type { ContentSourceId, IngestionStatus, IngestionProgress } from "./content-types"

// ── Configuration ───────────────────────────────────────────────────

const API_TIMEOUT_MS = 30_000

/** Per-source TTLs — how often to re-ingest (ms) */
const INGESTION_TTL: Record<ContentSourceId, number> = {
  articles_latest:           15 * 60 * 1000,
  videos_latest:             15 * 60 * 1000,
  videos_by_category:        20 * 60 * 1000,
  videos_categories:          6 * 60 * 60 * 1000,
  shrine_history_sections:   12 * 60 * 60 * 1000,
  shrine_history_by_section: 60 * 60 * 1000,
  abbas_history_by_id:       60 * 60 * 1000,
  abbas_local_dataset:       24 * 60 * 60 * 1000,
  lang_words_ar:             24 * 60 * 60 * 1000,
}

/** Sources to ingest on startup (non-parametric) */
const AUTO_INGEST_SOURCES: ContentSourceId[] = [
  "articles_latest",
  "videos_latest",
  "videos_categories",
  "shrine_history_sections",
  "lang_words_ar",
]

/** Eager page cap for initial ingestion */
const EAGER_PAGE_CAP = 10

/** Lazy backfill batch size (pages per request) */
const BACKFILL_BATCH = 5

// ── Ingestion state ─────────────────────────────────────────────────

const ingestionStatus = new Map<ContentSourceId, IngestionStatus>()
const ingestionProgress = new Map<ContentSourceId, IngestionProgress>()

/** Track per-section ingestion for history deep-fetch */
const historySectionIngested = new Map<string, number>() // sectionId → timestamp

let ingestionPromise: Promise<void> | null = null

// ── Raw API fetcher ─────────────────────────────────────────────────

async function fetchRaw(endpoint: string): Promise<any | null> {
  try {
    const config = getSiteAPIConfig()
    const normalizedBase = config.baseUrl.replace(/\/+$/, "")
    const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`

    let url: string
    if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
      url = endpoint
    } else if (normalizedEndpoint.startsWith("/alkafeel_back_test/")) {
      const baseOrigin = new URL(normalizedBase).origin
      url = `${baseOrigin}${normalizedEndpoint}`
    } else {
      url = `${normalizedBase}${normalizedEndpoint}`
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS)

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Language": config.acceptLanguage,
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    if (!response.ok) return null

    const data = await response.json()
    return sanitizeAPIResponse(data)
  } catch (e) {
    console.warn(`[Knowledge Ingestion] Fetch failed for ${endpoint}:`, (e as Error).message)
    return null
  }
}

/** Extract raw array from API response */
function extractRawArray(source: ContentSourceId, rawData: any): any[] {
  if (!rawData) return []
  if (source === "lang_words_ar") return [rawData]
  if (Array.isArray(rawData)) return rawData
  if (Array.isArray(rawData?.data)) return rawData.data
  return []
}

/** Extract pagination metadata from API response ({last_page, per_page, current_page}) */
function extractPaginationMeta(rawData: any): { lastPage: number; perPage: number } {
  if (!rawData || typeof rawData !== "object") return { lastPage: 0, perPage: 16 }
  const lastPage = Number(rawData.last_page) || 0
  const perPage = Number(rawData.per_page) || 16
  return { lastPage, perPage }
}

// ── Per-source ingestion ────────────────────────────────────────────

async function ingestSourcePages(
  source: ContentSourceId,
  resolvedEndpoint: string,
  maxPages: number
): Promise<{ items: any[]; meta: { lastPage: number; perPage: number } }> {
  // Fetch page 1 (always)
  const rawData = await fetchRaw(resolvedEndpoint)
  let allRawItems = extractRawArray(source, rawData)
  const meta = extractPaginationMeta(rawData)

  // Determine effective last page
  const effectiveMax = meta.lastPage > 0 ? Math.min(maxPages, meta.lastPage) : maxPages

  // Fetch remaining pages
  for (let page = 2; page <= effectiveMax; page++) {
    const pagedEndpoint = resolvedEndpoint.replace(/([?&])page=\d+/, `$1page=${page}`)
    if (pagedEndpoint === resolvedEndpoint) break
    const pageData = await fetchRaw(pagedEndpoint)
    const pageItems = extractRawArray(source, pageData)
    if (pageItems.length === 0) break
    allRawItems = allRawItems.concat(pageItems)
  }

  return { items: allRawItems, meta }
}

async function ingestSource(
  source: ContentSourceId,
  params: { category_id?: string; section_id?: string; id?: string } = {}
): Promise<IngestionStatus> {
  const config = getSiteAPIConfig()
  const endpoint = config.sourceEndpoints[source]
  if (!endpoint) {
    return { source, items_ingested: 0, chunks_created: 0, last_ingested_at: Date.now(), error: "No endpoint" }
  }

  let resolvedEndpoint: string
  try {
    if (source === "videos_by_category" && params.category_id) {
      resolvedEndpoint = fillEndpointTemplate(endpoint, { catId: params.category_id })
    } else if (source === "shrine_history_by_section" && params.section_id) {
      resolvedEndpoint = fillEndpointTemplate(endpoint, { secId: params.section_id })
    } else if (source === "abbas_history_by_id" && params.id) {
      resolvedEndpoint = fillEndpointTemplate(endpoint, { id: params.id })
    } else {
      resolvedEndpoint = endpoint
    }
  } catch {
    return { source, items_ingested: 0, chunks_created: 0, last_ingested_at: Date.now(), error: "Template error" }
  }

  // Paginated sources use progressive ingestion
  const isPaginated = ["articles_latest", "videos_latest", "videos_by_category"].includes(source)
  let allRawItems: any[]
  let meta = { lastPage: 0, perPage: 16 }

  if (isPaginated) {
    const progress = ingestionProgress.get(source)
    const eagerness = (!progress || progress.pages_ingested < EAGER_PAGE_CAP)
      ? EAGER_PAGE_CAP
      : EAGER_PAGE_CAP // On re-ingest, still fetch the eager window for freshness
    const result = await ingestSourcePages(source, resolvedEndpoint, eagerness)
    allRawItems = result.items
    meta = result.meta

    // Update progress
    ingestionProgress.set(source, {
      source,
      pages_ingested: Math.min(eagerness, meta.lastPage || eagerness),
      total_pages: meta.lastPage,
      last_page_ingested_at: Date.now(),
    })
  } else {
    const rawData = await fetchRaw(resolvedEndpoint)
    allRawItems = extractRawArray(source, rawData)
  }

  if (allRawItems.length === 0 && source !== "lang_words_ar") {
    return { source, items_ingested: 0, chunks_created: 0, last_ingested_at: Date.now(), error: "No data" }
  }

  // Normalize → Chunk → Index
  const index = getKnowledgeIndex()
  index.removeSource(source)

  const normalized = normalizeRawToContent(source, source === "lang_words_ar" ? allRawItems[0] : allRawItems)
  const chunks = chunkContentBatch(normalized)
  index.addChunks(chunks)

  const status: IngestionStatus = {
    source,
    items_ingested: normalized.length,
    chunks_created: chunks.length,
    last_ingested_at: Date.now(),
  }
  ingestionStatus.set(source, status)
  console.log(`[Knowledge Ingestion] ${source}: ${normalized.length} items → ${chunks.length} chunks`)
  return status
}

// ── History deep-ingestion ──────────────────────────────────────────

/**
 * After ingesting shrine_history_sections (which gives us section titles/ids),
 * automatically fetch the actual content for each section via shrine_history_by_section.
 */
async function ingestHistorySectionContent(): Promise<void> {
  const index = getKnowledgeIndex()
  const config = getSiteAPIConfig()
  const sectionEndpoint = config.sourceEndpoints["shrine_history_by_section"]
  if (!sectionEndpoint) return

  // Find all ingested history section IDs from the index
  const sectionChunks = index.getChunksBySource("shrine_history_sections")
  const sectionIds = new Set<string>()
  for (const chunk of sectionChunks) {
    // Extract original_id from chunk parent_id: "shrine_history_sections::5" → "5"
    const parts = chunk.parent_id.split("::")
    if (parts.length === 2 && parts[1]) sectionIds.add(parts[1])
  }

  if (sectionIds.size === 0) {
    console.log(`[Knowledge Ingestion] No section IDs found in ${sectionChunks.length} chunk(s)`)
    return
  }

  console.log(`[Knowledge Ingestion] Deep-fetching ${sectionIds.size} history section(s): ${[...sectionIds].join(", ")}`)

  const now = Date.now()
  const sectionTTL = INGESTION_TTL["shrine_history_by_section"]
  let ingested = 0

  for (const secId of sectionIds) {
    // Skip if recently ingested
    const lastTime = historySectionIngested.get(secId)
    if (lastTime && now - lastTime < sectionTTL) continue

    try {
      const resolved = fillEndpointTemplate(sectionEndpoint, { secId })
      const rawData = await fetchRaw(resolved)
      const rawItems = extractRawArray("shrine_history_by_section", rawData)

      if (rawItems.length > 0) {
        const normalized = normalizeRawToContent("shrine_history_by_section", rawItems)
        const chunks = chunkContentBatch(normalized)
        index.addChunks(chunks) // addChunks is idempotent — won't duplicate
        ingested += normalized.length
      }
      historySectionIngested.set(secId, now)
    } catch (e) {
      console.warn(`[Knowledge Ingestion] History section ${secId} failed:`, (e as Error).message)
    }
  }

  if (ingested > 0) {
    console.log(`[Knowledge Ingestion] History deep-fetch: ${ingested} items from ${sectionIds.size} sections`)
  }
}

// ── Abbas local dataset ingestion ───────────────────────────────────

/**
 * Ingest Abbas content from the local pre-fetched dataset (data/abbas-content.json).
 * Fast, disk-only, no network calls. Skipped gracefully if file is missing.
 */
async function ingestAbbasLocalDataset(): Promise<void> {
  const source = "abbas_local_dataset" as ContentSourceId
  const status = ingestionStatus.get(source)
  if (status && Date.now() - status.last_ingested_at < INGESTION_TTL[source]) return

  const items = loadAbbasLocalDataset()
  if (items.length === 0) return

  const index = getKnowledgeIndex()
  index.removeSource(source)

  const chunks = chunkContentBatch(items)
  index.addChunks(chunks)

  ingestionStatus.set(source, {
    source,
    items_ingested: items.length,
    chunks_created: chunks.length,
    last_ingested_at: Date.now(),
  })
  console.log(`[Knowledge Ingestion] Abbas local dataset: ${items.length} tabs → ${chunks.length} chunks`)
}

// ── Lazy backfill for older pages ───────────────────────────────────

/**
 * Fetch additional older pages for a paginated source.
 * Called on-demand when deep retrieval needs broader coverage.
 */
export async function backfillOlderPages(source: ContentSourceId): Promise<number> {
  const progress = ingestionProgress.get(source)
  if (!progress || progress.total_pages <= 0) return 0
  if (progress.pages_ingested >= progress.total_pages) return 0

  const config = getSiteAPIConfig()
  const endpoint = config.sourceEndpoints[source]
  if (!endpoint) return 0

  const startPage = progress.pages_ingested + 1
  const endPage = Math.min(startPage + BACKFILL_BATCH - 1, progress.total_pages)

  const index = getKnowledgeIndex()
  let totalNew = 0

  for (let page = startPage; page <= endPage; page++) {
    const pagedEndpoint = endpoint.replace(/([?&])page=\d+/, `$1page=${page}`)
    if (pagedEndpoint === endpoint) break
    const rawData = await fetchRaw(pagedEndpoint)
    const rawItems = extractRawArray(source, rawData)
    if (rawItems.length === 0) break

    const normalized = normalizeRawToContent(source, rawItems)
    const chunks = chunkContentBatch(normalized)
    index.addChunks(chunks)
    totalNew += normalized.length
  }

  // Update progress
  ingestionProgress.set(source, {
    ...progress,
    pages_ingested: endPage,
    last_page_ingested_at: Date.now(),
  })

  if (totalNew > 0) {
    console.log(`[Knowledge Ingestion] Backfill ${source}: pages ${startPage}–${endPage} → ${totalNew} items`)
  }
  return totalNew
}

// ── Public API ──────────────────────────────────────────────────────

function isStale(source: ContentSourceId): boolean {
  const status = ingestionStatus.get(source)
  if (!status) return true
  return Date.now() - status.last_ingested_at > INGESTION_TTL[source]
}

/**
 * Ensure the knowledge index is populated.
 * Ingests stale auto-sources + history section deep-content.
 */
export async function ensureKnowledgeReady(): Promise<void> {
  const staleSources = AUTO_INGEST_SOURCES.filter(s => isStale(s))
  const needsHistoryDeep = !historySectionIngested.size ||
    [...historySectionIngested.values()].some(t => Date.now() - t > INGESTION_TTL["shrine_history_by_section"])

  const needsAbbasLocal = isStale("abbas_local_dataset" as ContentSourceId)

  if (staleSources.length === 0 && !needsHistoryDeep && !needsAbbasLocal) return

  if (ingestionPromise) {
    await ingestionPromise
    return
  }

  ingestionPromise = (async () => {
    try {
      if (staleSources.length > 0) {
        console.log(`[Knowledge Ingestion] Ingesting ${staleSources.length} stale source(s): ${staleSources.join(", ")}`)
        await Promise.all(staleSources.map(s => ingestSource(s)))
      }

      // After sections are ingested, deep-fetch their content
      if (staleSources.includes("shrine_history_sections") || needsHistoryDeep) {
        await ingestHistorySectionContent()
      }

      // Ingest Abbas local dataset from disk (fast, no network)
      if (needsAbbasLocal) {
        await ingestAbbasLocalDataset()
      }
    } catch (e) {
      console.error("[Knowledge Ingestion] Error during ingestion:", e)
    } finally {
      ingestionPromise = null
    }
  })()

  await ingestionPromise
}

/**
 * Ingest a parametric source on demand.
 */
export async function ingestParametricSource(
  source: ContentSourceId,
  params: { category_id?: string; section_id?: string; id?: string }
): Promise<IngestionStatus> {
  return ingestSource(source, params)
}

/**
 * Get current ingestion status for all sources.
 */
export function getIngestionStatuses(): IngestionStatus[] {
  return [...ingestionStatus.values()]
}

/**
 * Get ingestion progress for paginated sources.
 */
export function getIngestionProgress(source: ContentSourceId): IngestionProgress | undefined {
  return ingestionProgress.get(source)
}

/**
 * Check whether a paginated source still has un-ingested older pages.
 */
export function hasBackfillRoom(source: ContentSourceId): boolean {
  const progress = ingestionProgress.get(source)
  if (!progress || progress.total_pages <= 0) return false
  return progress.pages_ingested < progress.total_pages
}

/**
 * Deterministic selection of which paginated sources to backfill for a query.
 * Rules:
 *  - Always include articles_latest if it has room
 *  - Include videos_latest only for non-history queries with room
 *  - Never include category/index/parametric sources
 */
export function getBackfillSourcesForQuery(query: string): ContentSourceId[] {
  const norm = (query || "").replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[\u0622\u0623\u0625\u0627]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .toLowerCase().trim()

  const sources: ContentSourceId[] = []

  // Articles are the most likely source of buried older content
  if (hasBackfillRoom("articles_latest")) {
    sources.push("articles_latest")
  }

  // Videos — include unless query is clearly historical/biographical only
  const historyOnly = ["تاريخ", "سدنه", "كلدار", "سيره", "نبذه"].some(h => norm.includes(h))
  if (!historyOnly && hasBackfillRoom("videos_latest")) {
    sources.push("videos_latest")
  }

  return sources
}
