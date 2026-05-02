/**
 * Abbas Local Dataset Loader — DISABLED.
 *
 * The local pre-fetched Abbas dataset (data/abbas-content.json) was
 * removed because its content drifted from the live source on
 * alkafeel.net (e.g. tribal nisba differences). Relying on a stale
 * snapshot caused the assistant to quote outdated wording.
 *
 * This loader is intentionally a no-op so the rest of the knowledge
 * pipeline continues to work without any local Abbas snapshot. All
 * Abbas content must come from live retrieval (browse_source_page /
 * search_content / get_content_by_id) instead.
 */

import type { NormalizedContent } from "./content-types"

export function loadAbbasLocalDataset(): NormalizedContent[] {
  return []
}
