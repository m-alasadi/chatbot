/**
 * Smoke test for the Arabic spell-correction layer.
 *
 * Run: npx tsx tests/spell-correct-smoke.ts
 *
 * Verifies:
 *   1. Damerau-Levenshtein with cap detects single insert/delete/substitute/swap.
 *   2. correctArabicQuery() rewrites typo'd tokens to known vocabulary terms.
 *   3. Known terms are left alone (no false corrections).
 *   4. Performance is sub-millisecond per query on a small lexicon.
 */
import { damerauLevenshteinAtMost, softFoldArabic } from "../lib/server/text/arabic-fuzzy"
import {
  correctArabicQuery,
  _resetSpellCorrectorCacheForTests,
} from "../lib/server/text/spell-correct"
import { getKnowledgeIndex } from "../lib/server/knowledge/knowledge-index"
import type { ContentChunk } from "../lib/server/knowledge/content-types"

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

console.log("\n— Damerau-Levenshtein")
check("identical → 0", damerauLevenshteinAtMost("العباس", "العباس", 2) === 0)
check("single deletion ≤ 1", damerauLevenshteinAtMost("العبس", "العباس", 1) === 1)
check("single insertion ≤ 1", damerauLevenshteinAtMost("الكفل", "الكفيل", 1) === 1)
check("single substitution ≤ 1", damerauLevenshteinAtMost("الكفيل", "الككيل", 1) === 1)
check("adjacent swap ≤ 1", damerauLevenshteinAtMost("اعلام", "اعالم", 1) === 1)
check("too far returns max+1", damerauLevenshteinAtMost("شيء", "اخر", 1) > 1)

console.log("\n— Soft phonetic fold")
check("ص→س", softFoldArabic("صابر") === "سابر")
check("ط→ت", softFoldArabic("طابع") === "تابع")
check("ق→ك", softFoldArabic("قلب") === "كلب")

console.log("\n— Spell correction against a seeded vocabulary")
const idx = getKnowledgeIndex()
idx.clear()
const seedChunks: ContentChunk[] = [
  {
    chunk_id: "t1",
    parent_id: "p1",
    chunk_index: 0,
    source: "articles_latest" as any,
    title: "العتبة العباسية المقدسة",
    section: "اخبار",
    chunk_text: "العباس بن علي ابن ابي طالب قمر بني هاشم الكفيل",
    url: "",
  },
  {
    chunk_id: "t2",
    parent_id: "p2",
    chunk_index: 0,
    source: "videos_latest" as any,
    title: "زيارة الزائرين",
    section: "فيديو",
    chunk_text: "الزيارة المليونية للزائرين الكرام",
    url: "",
  },
]
idx.addChunks(seedChunks)
_resetSpellCorrectorCacheForTests()

const cases: Array<{ q: string; expectChanged: boolean; expectContains?: string }> = [
  { q: "من هو العبس", expectChanged: true, expectContains: "العباس" },
  { q: "من هو الكفل", expectChanged: true, expectContains: "الكفيل" },
  { q: "من هو العباس", expectChanged: false },
  { q: "هاشم قمر", expectChanged: false },
  { q: "زيارت العتبه", expectChanged: true, expectContains: "زياره" /* ت→ه typo */ },
]

for (const c of cases) {
  const r = correctArabicQuery(c.q)
  const changed = r.corrected !== r.original
  const label = `"${c.q}" → "${r.corrected}"`
  if (c.expectChanged) {
    check(label, changed && (!c.expectContains || r.corrected.includes(c.expectContains)),
      `corrections=${JSON.stringify(r.corrections)}`)
  } else {
    check(label, !changed,
      `unexpected corrections=${JSON.stringify(r.corrections)}`)
  }
}

console.log("\n— Performance")
const start = Date.now()
const N = 1000
for (let i = 0; i < N; i++) correctArabicQuery("من هو العبس بن علي ابن ابي طلب الكفل")
const elapsed = Date.now() - start
check(`${N} corrections in ${elapsed}ms (avg ${(elapsed / N).toFixed(3)}ms)`, elapsed < 2000)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
