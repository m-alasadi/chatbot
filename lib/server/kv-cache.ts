/**
 * Shared Cache Adapter — Vercel KV with in-memory fallback
 *
 * Phase C.2: Replace per-instance module-level cache variables with a shared
 * Vercel KV store so all Edge Function instances share one cache entry.
 * Cold start drops from ~30s (API fetch) to ~50ms (KV read).
 *
 * Uses the official @vercel/kv SDK (kv.get, kv.set, kv.del).
 * When KV_REST_API_URL / KV_REST_API_TOKEN are not set (local dev),
 * falls back to module-level variables (same behaviour as before).
 *
 * Cache payload is stored in a single KV key as a CachePayload object
 * containing both the data array and the cachedAt timestamp.
 */

import { kv } from "@vercel/kv"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CachePayload<T> {
  data: T
  cachedAt: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_KEY = "projects_cache"
const CACHE_DURATION_MS = 30 * 60 * 1000 // 30 minutes
const CACHE_DURATION_S = CACHE_DURATION_MS / 1000 // 1800 seconds (KV TTL)

// ---------------------------------------------------------------------------
// KV availability check
// ---------------------------------------------------------------------------

function isKVConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}

// ---------------------------------------------------------------------------
// In-memory fallback (used when KV env vars are not set)
// Also acts as L1 same-instance cache when KV is enabled.
// ---------------------------------------------------------------------------

let memoryPayload: CachePayload<any[]> | null = null

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieve cached projects.
 * Returns the project array if the cache is fresh, or null if stale/missing.
 */
export async function getCachedProjects(): Promise<any[] | null> {
  if (isKVConfigured()) {
    try {
      const payload = await kv.get<CachePayload<any[]>>(CACHE_KEY)

      if (!payload || !payload.data || !Array.isArray(payload.data)) return null

      // Double-check age in case KV TTL and timestamp drift apart
      const age = Date.now() - payload.cachedAt
      if (age >= CACHE_DURATION_MS) return null

      return payload.data
    } catch (err) {
      console.error("[kv-cache] getCachedProjects KV error, falling back:", err)
      // Fall through to memory fallback
    }
  }

  // Memory fallback
  if (memoryPayload) {
    const age = Date.now() - memoryPayload.cachedAt
    if (age < CACHE_DURATION_MS) {
      return memoryPayload.data
    }
  }

  return null
}

/**
 * Store projects in the cache.
 * Writes to both KV (shared, persistent) and memory (L1, same-instance).
 */
export async function setCachedProjects(data: any[]): Promise<void> {
  const payload: CachePayload<any[]> = {
    data,
    cachedAt: Date.now()
  }

  // Always update memory (acts as L1 even when KV is available)
  memoryPayload = payload

  if (isKVConfigured()) {
    try {
      await kv.set(CACHE_KEY, payload, { ex: CACHE_DURATION_S })
    } catch (err) {
      console.error("[kv-cache] setCachedProjects KV error:", err)
    }
  }
}

/**
 * Invalidate (delete) the cache. Next call to getCachedProjects() will
 * return null, triggering a fresh API fetch.
 */
export async function invalidateProjectsCache(): Promise<void> {
  // Clear memory
  memoryPayload = null

  if (isKVConfigured()) {
    try {
      await kv.del(CACHE_KEY)
    } catch (err) {
      console.error("[kv-cache] invalidateProjectsCache KV error:", err)
    }
  }
}

/**
 * Return the cache age in seconds, or -1 if no cache exists.
 */
export async function getCacheAge(): Promise<number> {
  if (isKVConfigured()) {
    try {
      const payload = await kv.get<CachePayload<any[]>>(CACHE_KEY)
      if (!payload) return -1
      return Math.floor((Date.now() - payload.cachedAt) / 1000)
    } catch {
      // Fall through to memory fallback
    }
  }

  // Memory fallback
  if (!memoryPayload) return -1
  return Math.floor((Date.now() - memoryPayload.cachedAt) / 1000)
}
