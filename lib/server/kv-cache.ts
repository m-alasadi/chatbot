/**
 * Shared Cache Adapter — Vercel KV with in-memory fallback
 *
 * Phase B.1 Redesign #1: Replace per-instance module-level cache variables
 * with a shared Vercel KV store so all Edge Function instances share one
 * cache entry. Cold start drops from ~30s (API fetch) to ~50ms (KV read).
 *
 * Uses the official @vercel/kv SDK (kv.get, kv.set, kv.del).
 * When KV_REST_API_URL / KV_REST_API_TOKEN are not set (local dev),
 * falls back to module-level variables (same behaviour as before).
 */

import { kv } from "@vercel/kv"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_KEY = "projects_cache"
const CACHE_TIME_KEY = "projects_cache_time"
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
// ---------------------------------------------------------------------------

let memoryCache: any[] | null = null
let memoryCacheTime: number = 0

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
      const [data, cacheTime] = await Promise.all([
        kv.get<any[]>(CACHE_KEY),
        kv.get<number>(CACHE_TIME_KEY)
      ])

      if (!data || cacheTime == null) return null

      // Double-check age in case KV TTL and timestamp drift apart
      const age = Date.now() - cacheTime
      if (age >= CACHE_DURATION_MS) return null

      if (!Array.isArray(data)) return null

      return data
    } catch (err) {
      console.error("[kv-cache] getCachedProjects KV error, falling back:", err)
      // Fall through to memory fallback
    }
  }

  // Memory fallback
  if (memoryCache && Date.now() - memoryCacheTime < CACHE_DURATION_MS) {
    return memoryCache
  }

  return null
}

/**
 * Store projects in the cache.
 * Writes to both KV (shared, persistent) and memory (L1, same-instance).
 */
export async function setCachedProjects(data: any[]): Promise<void> {
  const now = Date.now()

  // Always update memory (acts as L1 even when KV is available)
  memoryCache = data
  memoryCacheTime = now

  if (isKVConfigured()) {
    try {
      await Promise.all([
        kv.set(CACHE_KEY, data, { ex: CACHE_DURATION_S }),
        kv.set(CACHE_TIME_KEY, now, { ex: CACHE_DURATION_S })
      ])
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
  memoryCache = null
  memoryCacheTime = 0

  if (isKVConfigured()) {
    try {
      await kv.del(CACHE_KEY, CACHE_TIME_KEY)
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
      const cacheTime = await kv.get<number>(CACHE_TIME_KEY)
      if (cacheTime == null) return -1
      return Math.floor((Date.now() - cacheTime) / 1000)
    } catch {
      // Fall through to memory fallback
    }
  }

  // Memory fallback
  if (memoryCacheTime === 0) return -1
  return Math.floor((Date.now() - memoryCacheTime) / 1000)
}
