/**
 * Abbas Local Dataset Loader — reads the pre-fetched Abbas content
 * from data/abbas-content.json and normalizes it into NormalizedContent
 * for ingestion into the knowledge layer.
 *
 * Uses static JSON import (Edge-runtime compatible — no fs needed).
 */

import type { NormalizedContent, ContentSourceFamily } from "./content-types"

// Static import — bundled at build time, no fs needed
let abbasData: AbbasTabRecord[] = []
try {
  abbasData = require("../../../data/abbas-content.json")
} catch {
  // Dataset file not present — will be handled gracefully in loader
}

// ── Dataset record shape (mirrors fetch script output) ──────────────

interface AbbasTabRecord {
  tab_id: number
  tab_title: string
  tab_order: number
  source_url: string
  full_text: string
  summary: string
  last_verified_at: string
}

// ── Loader ──────────────────────────────────────────────────────────

const SITE_DOMAIN = () =>
  (process.env.SITE_DOMAIN || "https://alkafeel.net").replace(/\/+$/, "")

/** Map tab titles to enriched keywords for better index matching */
const TAB_KEYWORDS: Record<number, string> = {
  1:  "مقدمة العباس أبو الفضل قمر بني هاشم",
  2:  "العباس بن علي حياته سيرته نبذة تعريف",
  3:  "نشأة العباس تربيته ولادته مولده",
  4:  "كنية العباس أبو الفضل ألقابه",
  5:  "صفات العباس جماله شجاعته عمر العباس يوم مقتله أربعا وثلاثين سنة عمره عند الاستشهاد",
  6:  "أخوات العباس",
  7:  "أخوته إخوة العباس أخواته",
  8:  "أعمام العباس",
  9:  "زواج العباس ولادة أبناء أم البنين",
  10: "العباس في نظر الأئمة مكانته",
  11: "سقاية العباس الماء العطش",
  12: "موقفه في الطف كربلاء معركة استشهاد",
  13: "موقفه قبل الطف",
  14: "شهادة استشهاد العباس مقتله يوم عاشوراء كربلاء متى استشهد",
}

/**
 * Load and normalize Abbas local dataset.
 * Returns empty array (with a log) if the data is missing or invalid.
 */
export function loadAbbasLocalDataset(): NormalizedContent[] {
  if (!Array.isArray(abbasData) || abbasData.length === 0) {
    console.log("[Abbas Local] Dataset not available — skipping Abbas local ingestion")
    return []
  }

  const domain = SITE_DOMAIN()
  const normalized: NormalizedContent[] = abbasData
    .filter(r => r.full_text && r.full_text.length > 0)
    .map(r => {
      // Prepend keywords to full_text so they get indexed
      const keywords = TAB_KEYWORDS[r.tab_id] || ""
      const enrichedText = keywords
        ? `${keywords}\n${r.full_text}`
        : r.full_text

      return {
        id: `abbas_local_dataset::tab_${r.tab_id}`,
        source: "abbas_local_dataset" as any,
        family: "abbas" as ContentSourceFamily,
        title: r.tab_title,
        section: "العباس بن علي",
        url: `${domain}/abbas?lang=ar`,
        published_at: r.last_verified_at || new Date().toISOString(),
        summary: r.summary,
        full_text: enrichedText,
        metadata: {
          original_id: r.tab_id,
          extra: { tab_order: r.tab_order, keywords },
        },
      }
    })

  console.log(`[Abbas Local] Loaded ${normalized.length} tabs (${normalized.reduce((s, n) => s + n.full_text.length, 0)} chars)`)
  return normalized
}
