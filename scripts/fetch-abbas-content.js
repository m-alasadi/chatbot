/**
 * Fetch Abbas Page Content — downloads all tabs from the Abbas API
 * and writes a structured local dataset to data/abbas-content.json.
 *
 * Usage:  node scripts/fetch-abbas-content.ts
 *
 * The API endpoint: /alkafeel_back_test/api/v1/abbas-histories/getById/{id}
 * Tab IDs: 1–14 (15+ return empty arrays)
 * Response shape: Array with one object { id, title, caption }
 *   - "caption" holds the full HTML body text
 */

const { writeFileSync, mkdirSync } = require("fs")
const { join } = require("path")

const BASE_URL = "https://alkafeel.net/alkafeel_back_test/api/v1/abbas-histories/getById"
const MAX_TAB_ID = 14
const OUTPUT_DIR = join(__dirname, "..", "data")
const OUTPUT_FILE = join(OUTPUT_DIR, "abbas-content.json")

// ── HTML → clean text ───────────────────────────────────────────────

function stripHtml(html) {
  if (!html) return ""
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim()
}

function summarize(text, maxLen = 300) {
  if (text.length <= maxLen) return text
  return text.substring(0, maxLen).replace(/\s+\S*$/, "") + "…"
}

// ── Dataset record shape ────────────────────────────────────────────

// ── Main ────────────────────────────────────────────────────────────

async function fetchTab(id) {
  const url = `${BASE_URL}/${id}`
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "Accept-Language": "ar" },
    })
    if (!res.ok) {
      console.warn(`  ✗ Tab ${id}: HTTP ${res.status}`)
      return null
    }
    const json = await res.json()
    const arr = Array.isArray(json) ? json : json?.data ? [json.data] : []
    if (arr.length === 0) {
      console.log(`  – Tab ${id}: empty`)
      return null
    }
    const item = arr[0]
    const rawBody = item.caption || item.text || item.description || ""
    const fullText = stripHtml(rawBody)

    if (!fullText) {
      console.warn(`  ✗ Tab ${id} (${item.title}): no text content`)
      return null
    }

    return {
      tab_id: Number(item.id) || id,
      tab_title: (item.title || "").trim(),
      tab_order: id,
      source_url: `https://alkafeel.net/abbas?lang=ar`,
      full_text: fullText,
      summary: summarize(fullText),
      last_verified_at: new Date().toISOString(),
    }
  } catch (e) {
    console.error(`  ✗ Tab ${id}: ${e.message}`)
    return null
  }
}

async function main() {
  console.log(`Fetching Abbas tabs 1–${MAX_TAB_ID}...`)
  const records = []

  for (let id = 1; id <= MAX_TAB_ID; id++) {
    const record = await fetchTab(id)
    if (record) {
      records.push(record)
      console.log(`  ✓ Tab ${id}: "${record.tab_title}" (${record.full_text.length} chars)`)
    }
  }

  if (records.length === 0) {
    console.error("No tabs fetched — aborting.")
    process.exit(1)
  }

  mkdirSync(OUTPUT_DIR, { recursive: true })
  writeFileSync(OUTPUT_FILE, JSON.stringify(records, null, 2), "utf-8")
  console.log(`\n✅ Wrote ${records.length} tabs to ${OUTPUT_FILE}`)
  console.log(`   Total text: ${records.reduce((s, r) => s + r.full_text.length, 0)} chars`)
}

main().catch((e) => {
  console.error("Fatal:", e)
  process.exit(1)
})
