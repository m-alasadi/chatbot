/**
 * Paraphrase Robustness Evaluation
 *
 * Goal: measure how well the regex-based intent layer generalizes
 *       BEYOND its curated phrases. We start from a small set of seed
 *       (question, expected_slot) pairs and programmatically generate
 *       realistic paraphrases (typos, dialect words, filler phrases,
 *       word reordering, prefix variations). Then we run them all
 *       against `detectAbbasRelationSlot` and report which mutation
 *       families fail most.
 *
 * Run: npx tsx tests/paraphrase-robustness-eval.ts
 *
 * Output: a per-mutation-family pass/fail table — points us at the
 *         exact paraphrase patterns that need an LLM fallback or
 *         additional rules.
 */
import { detectAbbasRelationSlot, PersonRelationSlot } from "../lib/ai/paraphrase-intent"

type Seed = { q: string; slot: PersonRelationSlot }

// ── Seeds: canonical phrasings the system already passes ────────────
const SEEDS: Seed[] = [
  { q: "من والد العباس", slot: "father" },
  { q: "ما اسم والد العباس", slot: "father" },
  { q: "من ابو العباس", slot: "father" },
  { q: "من والدة العباس", slot: "mother" },
  { q: "من ام العباس", slot: "mother" },
  { q: "من زوجة العباس", slot: "wife" },
  { q: "كم زوجة للعباس", slot: "wife" },
  { q: "من تزوج العباس", slot: "wife" },
  { q: "من ابناء العباس", slot: "children" },
  { q: "كم ولد للعباس", slot: "children" },
  { q: "من اخوة العباس", slot: "brothers" },
  { q: "من اخوات العباس", slot: "sisters" },
  { q: "من اعمام العباس", slot: "uncles" },
  { q: "ما القاب العباس", slot: "titles" },
  { q: "ما كنية العباس", slot: "kunya" },
  { q: "متى استشهد العباس", slot: "martyrdom" },
  { q: "متى ولد العباس", slot: "birth" },
  { q: "من هو العباس", slot: "definition" },
  { q: "تعريف العباس", slot: "definition" },
  { q: "نبذة عن العباس", slot: "definition" },
]

// ── Mutation families ────────────────────────────────────────────────
// Each mutation is a function: (seed query) -> mutated query
// Bound to a "family" so we can aggregate failures by family.

type Mutation = { family: string; apply: (q: string) => string }

const MUTATIONS: Mutation[] = [
  // 1) Typo: drop a non-edge character
  {
    family: "typo_drop_char",
    apply: q => {
      const tokens = q.split(" ")
      const longest = tokens.reduce((a, b) => (b.length > a.length ? b : a), "")
      if (longest.length < 4) return q
      const idx = Math.floor(longest.length / 2)
      const mutated = longest.slice(0, idx) + longest.slice(idx + 1)
      return q.replace(longest, mutated)
    },
  },
  // 2) Typo: duplicate a character
  {
    family: "typo_double_char",
    apply: q => {
      const tokens = q.split(" ")
      const longest = tokens.reduce((a, b) => (b.length > a.length ? b : a), "")
      if (longest.length < 4) return q
      const idx = Math.floor(longest.length / 2)
      const mutated = longest.slice(0, idx) + longest[idx] + longest.slice(idx)
      return q.replace(longest, mutated)
    },
  },
  // 3) Spelling variant: ة -> ه
  {
    family: "ta_marbuta_to_ha",
    apply: q => q.replace(/ة/g, "ه"),
  },
  // 4) Spelling variant: أ/إ/آ -> ا
  {
    family: "hamza_to_alef",
    apply: q => q.replace(/[أإآ]/g, "ا"),
  },
  // 5) Spelling variant: ى -> ي
  {
    family: "alef_maqsura_to_ya",
    apply: q => q.replace(/ى/g, "ي"),
  },
  // 6) Add common filler words
  {
    family: "filler_min_fadlik",
    apply: q => `${q} من فضلك`,
  },
  {
    family: "filler_law_samaht",
    apply: q => `لو سمحت ${q}`,
  },
  {
    family: "filler_aham_shai",
    apply: q => `بالضبط ${q}`,
  },
  // 7) Dialect: ما -> شنو / ايش / وش
  {
    family: "dialect_shnu",
    apply: q => q.replace(/^ما(?=\s)/, "شنو"),
  },
  {
    family: "dialect_aysh",
    apply: q => q.replace(/^ما(?=\s)/, "ايش"),
  },
  {
    family: "dialect_wesh",
    apply: q => q.replace(/^ما(?=\s)/, "وش"),
  },
  // 8) Dialect: من -> منو
  {
    family: "dialect_minu",
    apply: q => q.replace(/^من(?=\s)/, "منو"),
  },
  // 9) Drop ال prefix from "العباس"
  {
    family: "drop_al_prefix",
    apply: q => q.replace(/العباس/g, "عباس"),
  },
  // 10) Switch to honorific "ابو الفضل"
  {
    family: "honorific_abu_fadl",
    apply: q => q.replace(/العباس/g, "ابو الفضل"),
  },
  // 11) Switch to laqab "قمر بني هاشم"
  {
    family: "laqab_qamar",
    apply: q => q.replace(/العباس/g, "قمر بني هاشم"),
  },
  // 12) Add question mark
  {
    family: "add_question_mark",
    apply: q => `${q}؟`,
  },
  // 13) Add trailing context
  {
    family: "trailing_context",
    apply: q => `${q} عليه السلام`,
  },
  // 14) Word order: move question word to end
  {
    family: "reorder_qword_to_end",
    apply: q => {
      const tokens = q.split(" ")
      if (tokens.length < 3) return q
      if (!/^(من|ما|كم|متى|كيف|اين)$/.test(tokens[0])) return q
      const qword = tokens.shift()!
      return `${tokens.join(" ")} ${qword}`
    },
  },
  // 15) Replace "من هو" / "من هي" with just "من"
  {
    family: "drop_huwa_hiya",
    apply: q => q.replace(/من\s+(?:هو|هي)\s+/g, "من "),
  },
  // 16) Add "اريد ان اعرف" prefix
  {
    family: "intent_uridu_an_aarif",
    apply: q => `اريد ان اعرف ${q}`,
  },
  // 17) Add "اخبرني" prefix
  {
    family: "intent_akhberny",
    apply: q => `اخبرني ${q}`,
  },
  // 18) Compound: typo + filler
  {
    family: "compound_typo_filler",
    apply: q => {
      const tokens = q.split(" ")
      const longest = tokens.reduce((a, b) => (b.length > a.length ? b : a), "")
      let mutated = q
      if (longest.length >= 4) {
        const idx = Math.floor(longest.length / 2)
        const typo = longest.slice(0, idx) + longest.slice(idx + 1)
        mutated = q.replace(longest, typo)
      }
      return `${mutated} من فضلك`
    },
  },
  // 19) Compound: dialect + drop ال
  {
    family: "compound_dialect_no_al",
    apply: q => {
      let mutated = q.replace(/^من(?=\s)/, "منو").replace(/^ما(?=\s)/, "شنو")
      mutated = mutated.replace(/العباس/g, "عباس")
      return mutated
    },
  },
  // 20) Insert "بالضبط" mid-sentence
  {
    family: "midsentence_filler",
    apply: q => {
      const tokens = q.split(" ")
      if (tokens.length < 3) return q
      const mid = Math.floor(tokens.length / 2)
      tokens.splice(mid, 0, "بالضبط")
      return tokens.join(" ")
    },
  },
]

// ── Run ─────────────────────────────────────────────────────────────
type Result = {
  family: string
  seed: string
  mutated: string
  expected: PersonRelationSlot
  got: PersonRelationSlot | null
  pass: boolean
}

const results: Result[] = []

for (const seed of SEEDS) {
  // baseline
  const baseGot = detectAbbasRelationSlot(seed.q)
  results.push({
    family: "baseline",
    seed: seed.q,
    mutated: seed.q,
    expected: seed.slot,
    got: baseGot,
    pass: baseGot === seed.slot,
  })
  // mutations
  for (const m of MUTATIONS) {
    const mutated = m.apply(seed.q)
    if (mutated === seed.q) continue // mutation didn't apply
    const got = detectAbbasRelationSlot(mutated)
    results.push({
      family: m.family,
      seed: seed.q,
      mutated,
      expected: seed.slot,
      got,
      pass: got === seed.slot,
    })
  }
}

// ── Aggregate ───────────────────────────────────────────────────────
const byFamily = new Map<string, { pass: number; fail: number; failures: Result[] }>()
for (const r of results) {
  const e = byFamily.get(r.family) ?? { pass: 0, fail: 0, failures: [] }
  if (r.pass) e.pass++
  else {
    e.fail++
    e.failures.push(r)
  }
  byFamily.set(r.family, e)
}

const totalPass = results.filter(r => r.pass).length
const totalFail = results.length - totalPass
const overallRate = ((totalPass / results.length) * 100).toFixed(1)

console.log("\n=== PARAPHRASE ROBUSTNESS REPORT ===\n")
console.log(`Total cases: ${results.length}`)
console.log(`Pass: ${totalPass}`)
console.log(`Fail: ${totalFail}`)
console.log(`Overall pass rate: ${overallRate}%\n`)

console.log("Per-family pass rate (lowest first):")
const sortedFamilies = [...byFamily.entries()].sort((a, b) => {
  const ra = a[1].pass / (a[1].pass + a[1].fail)
  const rb = b[1].pass / (b[1].pass + b[1].fail)
  return ra - rb
})

for (const [family, stats] of sortedFamilies) {
  const total = stats.pass + stats.fail
  const rate = ((stats.pass / total) * 100).toFixed(0).padStart(3)
  const bar = "█".repeat(Math.round((stats.pass / total) * 20)).padEnd(20, "·")
  console.log(`  ${rate}% ${bar}  ${family.padEnd(30)} (${stats.pass}/${total})`)
}

console.log("\n=== TOP FAILURE EXAMPLES (first 25) ===\n")
const allFailures = results.filter(r => !r.pass).slice(0, 25)
for (const f of allFailures) {
  console.log(`  [${f.family}] expect=${f.expected} got=${f.got}`)
  console.log(`    seed:    "${f.seed}"`)
  console.log(`    mutated: "${f.mutated}"`)
}

console.log("\n=== INTERPRETATION ===")
console.log("Families with <80% pass rate are paraphrase patterns the regex layer")
console.log("misses. These are the natural targets for an LLM fallback or rule")
console.log("expansion. Families at 100% are already robust.\n")

// Exit non-zero if overall robustness below 70%
const overall = totalPass / results.length
process.exit(overall >= 0.7 ? 0 : 1)
