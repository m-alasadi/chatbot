/**
 * System-wide Paraphrase Robustness Evaluation
 *
 * Covers every public intent/understanding entry-point in the system:
 *   1. Person relation slots          (paraphrase-intent.detectAbbasRelationSlot)
 *   2. Abbas biography query          (intent-detector.isAbbasBiographyQuery)
 *   3. Office holder query            (intent-detector.isOfficeHolderQuery)
 *   4. Knowledge-layer routing        (intent-detector.shouldUseKnowledgeLayer)
 *   5. Hard-evidence sensitivity      (intent-detector.isHardEvidenceSensitive)
 *   6. Compound fact query            (intent-detector.isCompoundFactQuery)
 *   7. Content intent                 (query-understanding.understandQuery.content_intent)
 *   8. Operation intent               (query-understanding.understandQuery.operation_intent)
 *   9. Institutional relation         (deriveRetrievalCapabilitySignals.institutional_relation)
 *  10. Small-talk / out-of-scope      (query-scope-policy.isSmallTalk / isOutOfScope)
 *
 * For each suite we generate paraphrase mutations and report pass-rates
 * per (suite × mutation-family). This pinpoints exactly which combination
 * of layer + paraphrase pattern the regex stack fails on.
 *
 * Run: npx tsx tests/system-robustness-eval.ts
 *      npx tsx tests/system-robustness-eval.ts --json   (machine-readable)
 *      npx tsx tests/system-robustness-eval.ts --suite=person_relation
 */

import {
  detectAbbasRelationSlot,
  type PersonRelationSlot,
} from "../lib/ai/paraphrase-intent"
import {
  isAbbasBiographyQuery,
  isOfficeHolderQuery,
  isHardEvidenceSensitive,
  isCompoundFactQuery,
  shouldUseKnowledgeLayer,
} from "../lib/ai/intent-detector"
import {
  understandQuery,
  deriveRetrievalCapabilitySignals,
} from "../lib/server/query-understanding"
import { isSmallTalkQuery, isOutOfScopeQuery } from "../lib/server/runtime/query-scope-policy"

// ── Mutation library (reused across suites) ─────────────────────────

type Mutation = { family: string; apply: (q: string) => string }

function longest(q: string): string {
  return q.split(" ").reduce((a, b) => (b.length > a.length ? b : a), "")
}

const MUTATIONS: Mutation[] = [
  // Spelling / orthography
  { family: "ta_marbuta_to_ha", apply: q => q.replace(/ة/g, "ه") },
  { family: "hamza_to_alef",    apply: q => q.replace(/[أإآ]/g, "ا") },
  { family: "alef_maqsura_to_ya", apply: q => q.replace(/ى/g, "ي") },
  // Typos
  {
    family: "typo_drop_char",
    apply: q => {
      const w = longest(q); if (w.length < 4) return q
      const i = Math.floor(w.length / 2)
      return q.replace(w, w.slice(0, i) + w.slice(i + 1))
    },
  },
  {
    family: "typo_double_char",
    apply: q => {
      const w = longest(q); if (w.length < 4) return q
      const i = Math.floor(w.length / 2)
      return q.replace(w, w.slice(0, i) + w[i] + w.slice(i))
    },
  },
  {
    family: "typo_swap_adjacent",
    apply: q => {
      const w = longest(q); if (w.length < 4) return q
      const i = Math.floor(w.length / 2)
      return q.replace(w, w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2))
    },
  },
  // Filler / politeness
  { family: "filler_min_fadlik", apply: q => `${q} من فضلك` },
  { family: "filler_law_samaht", apply: q => `لو سمحت ${q}` },
  { family: "filler_arjok",      apply: q => `ارجوك ${q}` },
  // Dialect
  { family: "dialect_shnu", apply: q => q.replace(/(^|\s)ما(\s)/, "$1شنو$2") },
  { family: "dialect_aysh", apply: q => q.replace(/(^|\s)ما(\s)/, "$1ايش$2") },
  { family: "dialect_minu", apply: q => q.replace(/(^|\s)من(\s)/, "$1منو$2") },
  { family: "dialect_yamta", apply: q => q.replace(/(^|\s)متى(\s)/, "$1يمتى$2") },
  // Definite article
  { family: "drop_al_prefix", apply: q => q.replace(/العباس/g, "عباس") },
  // Honorifics / aliases
  { family: "honorific_abu_fadl", apply: q => q.replace(/العباس/g, "ابو الفضل") },
  { family: "laqab_qamar",        apply: q => q.replace(/العباس/g, "قمر بني هاشم") },
  // Punctuation
  { family: "add_question_mark", apply: q => `${q}؟` },
  { family: "add_period",        apply: q => `${q}.` },
  { family: "trailing_context",  apply: q => `${q} عليه السلام` },
  // Reorder
  {
    family: "reorder_qword_to_end",
    apply: q => {
      const t = q.split(" "); if (t.length < 3) return q
      if (!/^(من|ما|كم|متى|كيف|اين|هل)$/.test(t[0])) return q
      return `${t.slice(1).join(" ")} ${t[0]}`
    },
  },
  // Drop "هو/هي"
  { family: "drop_huwa_hiya", apply: q => q.replace(/(من|ما)\s+(هو|هي)\s+/g, "$1 ") },
  // Conversational lead-in
  { family: "lead_uridu",   apply: q => `اريد ان اعرف ${q}` },
  { family: "lead_akhberny", apply: q => `اخبرني ${q}` },
  { family: "lead_aslon",   apply: q => `اصلا ${q}` },
  // Mid-sentence filler
  {
    family: "midsentence_filler",
    apply: q => {
      const t = q.split(" "); if (t.length < 3) return q
      t.splice(Math.floor(t.length / 2), 0, "بالضبط")
      return t.join(" ")
    },
  },
  // Compound mutations
  {
    family: "compound_typo_filler",
    apply: q => {
      const w = longest(q); let m = q
      if (w.length >= 4) {
        const i = Math.floor(w.length / 2)
        m = q.replace(w, w.slice(0, i) + w.slice(i + 1))
      }
      return `${m} من فضلك`
    },
  },
  {
    family: "compound_dialect_no_al",
    apply: q => q
      .replace(/(^|\s)من(\s)/, "$1منو$2")
      .replace(/(^|\s)ما(\s)/, "$1شنو$2")
      .replace(/العباس/g, "عباس"),
  },
]

// ── Suite definitions ───────────────────────────────────────────────

interface Suite<E> {
  name: string
  /** human-readable description */
  description: string
  /** detector under test — returns the value we compare against `expected` */
  run: (q: string) => E | Promise<E>
  /** seeds: phrasings that the system is *supposed* to handle correctly */
  seeds: { q: string; expected: E }[]
  /** equality (defaults to ===) */
  eq?: (got: E, expected: E) => boolean
}

// 1) Person relation slot
const personRelationSuite: Suite<PersonRelationSlot | null> = {
  name: "person_relation",
  description: "Abbas family slot detection",
  run: q => detectAbbasRelationSlot(q),
  seeds: [
    { q: "من والد العباس",   expected: "father" },
    { q: "ما اسم والد العباس", expected: "father" },
    { q: "من ابو العباس",    expected: "father" },
    { q: "من والدة العباس",  expected: "mother" },
    { q: "من ام العباس",     expected: "mother" },
    { q: "من زوجة العباس",   expected: "wife" },
    { q: "من تزوج العباس",   expected: "wife" },
    { q: "من ابناء العباس",  expected: "children" },
    { q: "كم ولد للعباس",    expected: "children" },
    { q: "من اخوة العباس",   expected: "brothers" },
    { q: "من اخوات العباس",  expected: "sisters" },
    { q: "من اعمام العباس",  expected: "uncles" },
    { q: "ما القاب العباس",  expected: "titles" },
    { q: "ما كنية العباس",   expected: "kunya" },
    { q: "متى استشهد العباس", expected: "martyrdom" },
    { q: "متى ولد العباس",   expected: "birth" },
    { q: "من هو العباس",     expected: "definition" },
    { q: "تعريف العباس",     expected: "definition" },
    { q: "نبذة عن العباس",   expected: "definition" },
  ],
}

// 2) Abbas biography vs shrine activity
const biographySuite: Suite<boolean> = {
  name: "abbas_biography",
  description: "Personal biography vs shrine activity disambiguation",
  run: q => isAbbasBiographyQuery(q),
  seeds: [
    { q: "من هو العباس بن علي",       expected: true },
    { q: "ما هي القاب العباس",         expected: true },
    { q: "متى استشهد العباس",          expected: true },
    { q: "ما اسم والدة العباس",        expected: true },
    { q: "حياة ابي الفضل العباس",       expected: true },
    { q: "ما هي مشاريع العتبة العباسية", expected: false },
    { q: "اخبار العتبة العباسية اليوم",  expected: false },
    { q: "زيارة الحرم العباسي المقدس",   expected: false },
    { q: "بناء قبة العتبة العباسية",     expected: false },
  ],
}

// 3) Office holder
const officeHolderSuite: Suite<boolean> = {
  name: "office_holder",
  description: "Detect 'who is the legal trustee' style queries",
  run: q => isOfficeHolderQuery(q),
  seeds: [
    { q: "من هو المتولي الشرعي",                expected: true },
    { q: "ما اسم المتولي الشرعي للعتبة العباسية", expected: true },
    { q: "من المتولي الشرعي الحالي",             expected: true },
    { q: "من هو الامين العام للعتبة",            expected: false },
    { q: "اعرض اخبار العتبة",                    expected: false },
    { q: "من هو العباس",                        expected: false },
  ],
}

// 4) Knowledge-layer routing
const knowledgeRoutingSuite: Suite<boolean> = {
  name: "knowledge_routing",
  description: "Should the deep knowledge layer be used?",
  run: q => shouldUseKnowledgeLayer(q),
  seeds: [
    { q: "من هو العباس بن علي",                 expected: true },
    { q: "ما هي القاب ابي الفضل",               expected: true },
    { q: "حدثني عن سيرة العباس",                expected: true },
    { q: "تاريخ بناء الحرم العباسي",             expected: true },
    { q: "اعرض احدث فيديوهات العتبة",            expected: false },
    { q: "كم عدد اقسام الفيديو",                expected: false },
    { q: "اخر خبر",                             expected: false },
  ],
}

// 5) Hard-evidence sensitivity
const hardEvidenceSuite: Suite<boolean> = {
  name: "hard_evidence",
  description: "Question requires concrete date/number to answer honestly",
  run: q => isHardEvidenceSensitive(q),
  seeds: [
    { q: "متى ولد العباس",         expected: true },
    { q: "كم عمر العباس",          expected: true },
    { q: "تاريخ استشهاد العباس",   expected: true },
    { q: "في اي سنة ولد العباس",   expected: true },
    { q: "عدد ابناء العباس",       expected: true },
    { q: "من هو العباس",           expected: false },
    { q: "ما القاب العباس",        expected: false },
    { q: "اعرض احدث الفيديوهات",   expected: false },
  ],
}

// 6) Compound fact query
const compoundSuite: Suite<boolean> = {
  name: "compound_fact",
  description: "Query packs multiple independent facts",
  run: q => isCompoundFactQuery(q),
  seeds: [
    { q: "من والد العباس وما اسم والدته",          expected: true },
    { q: "متى ولد العباس ومتى استشهد",             expected: true },
    { q: "ما اسم زوجة العباس وما اسماء اولاده",    expected: true },
    { q: "من والد العباس",                         expected: false },
    { q: "اعرض احدث فيديوهات العتبة",              expected: false },
  ],
}

// 7) Content intent
type ContentIntentValue = "news" | "video" | "biography" | "history" | "sermon" | "wahy" | "generic"
const contentIntentSuite: Suite<ContentIntentValue> = {
  name: "content_intent",
  description: "Classify query into content channel",
  run: q => understandQuery(q).content_intent as ContentIntentValue,
  seeds: [
    { q: "اعرض احدث فيديوهات العتبة",       expected: "video" },
    { q: "احدث الاخبار",                     expected: "news" },
    { q: "خطبة الجمعة الاخيرة",              expected: "sermon" },
    { q: "وحي الجمعة هذا الاسبوع",            expected: "wahy" },
    { q: "من هو العباس بن علي",              expected: "biography" },
    { q: "تاريخ بناء قبة الحرم العباسي",      expected: "history" },
    { q: "هل لدى العتبة مصانع",               expected: "generic" },
  ],
}

// 8) Operation intent
type OperationIntentValue = "fact_question" | "list_items" | "latest" | "count" | "summarize" | "explain" | "classify" | "direct_answer" | "browse"
const operationIntentSuite: Suite<OperationIntentValue> = {
  name: "operation_intent",
  description: "What operation does the user request",
  run: q => understandQuery(q).operation_intent as OperationIntentValue,
  seeds: [
    { q: "كم عدد ابناء العباس",         expected: "count" },
    { q: "اعرض احدث الفيديوهات",        expected: "latest" },
    { q: "اعرض قائمة المشاريع",         expected: "list_items" },
    { q: "لخص لي حياة العباس",          expected: "summarize" },
    { q: "اشرح لي معركة كربلاء",         expected: "explain" },
    { q: "من هو والد العباس",           expected: "fact_question" },
  ],
}

// 9) Institutional relation
const institutionalSuite: Suite<boolean> = {
  name: "institutional_relation",
  description: "Detect institutional ownership/affiliation queries",
  run: q => deriveRetrievalCapabilitySignals(understandQuery(q), q).institutional_relation,
  seeds: [
    { q: "هل جامعة الكفيل تابعة للعتبة العباسية",       expected: true },
    { q: "هل كلية العميد تابعة للعتبة",                expected: true },
    { q: "هل لدى العتبة العباسية مصانع",               expected: true },
    { q: "هل توجد جامعة تابعة للعتبة العباسية",         expected: true },
    { q: "من هو العباس",                              expected: false },
    { q: "اعرض احدث الفيديوهات",                       expected: false },
  ],
}

// 10) Small-talk
const smallTalkSuite: Suite<boolean> = {
  name: "small_talk",
  description: "Greeting / capability-question / chitchat",
  run: q => isSmallTalkQuery(q),
  seeds: [
    { q: "السلام عليكم",                expected: true },
    { q: "مرحبا",                      expected: true },
    { q: "من انت",                      expected: true },
    { q: "ماذا تستطيع ان تفعل",         expected: true },
    { q: "من هو العباس",               expected: false },
    { q: "اعرض احدث فيديوهات العتبة",  expected: false },
  ],
}

const SUITES: Suite<any>[] = [
  personRelationSuite,
  biographySuite,
  officeHolderSuite,
  knowledgeRoutingSuite,
  hardEvidenceSuite,
  compoundSuite,
  contentIntentSuite,
  operationIntentSuite,
  institutionalSuite,
  smallTalkSuite,
]

// ── Runner ──────────────────────────────────────────────────────────

interface CaseResult {
  suite: string
  family: string
  seed: string
  mutated: string
  expected: any
  got: any
  pass: boolean
}

async function runSuite(s: Suite<any>): Promise<CaseResult[]> {
  const eq = s.eq ?? ((a: any, b: any) => a === b)
  const out: CaseResult[] = []
  for (const seed of s.seeds) {
    // baseline
    const base = await s.run(seed.q)
    out.push({
      suite: s.name, family: "baseline",
      seed: seed.q, mutated: seed.q,
      expected: seed.expected, got: base, pass: eq(base, seed.expected),
    })
    // mutations
    for (const m of MUTATIONS) {
      const mutated = m.apply(seed.q)
      if (mutated === seed.q) continue
      const got = await s.run(mutated)
      out.push({
        suite: s.name, family: m.family,
        seed: seed.q, mutated,
        expected: seed.expected, got, pass: eq(got, seed.expected),
      })
    }
  }
  return out
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0).padStart(3)}%`
}

function bar(rate: number, width = 16): string {
  const filled = Math.round(rate * width)
  return "█".repeat(filled).padEnd(width, "·")
}

async function main() {
  const args = process.argv.slice(2)
  const wantJson = args.includes("--json")
  const suiteFilter = (args.find(a => a.startsWith("--suite=")) || "").slice(8)

  const suitesToRun = suiteFilter
    ? SUITES.filter(s => s.name === suiteFilter)
    : SUITES

  if (suitesToRun.length === 0) {
    console.error(`No suite matches: "${suiteFilter}". Available:`)
    for (const s of SUITES) console.error(`  - ${s.name}`)
    process.exit(2)
  }

  const all: CaseResult[] = []
  for (const s of suitesToRun) {
    const res = await runSuite(s)
    all.push(...res)
  }

  if (wantJson) {
    console.log(JSON.stringify({
      total: all.length,
      pass: all.filter(r => r.pass).length,
      results: all,
    }, null, 2))
    process.exit(all.every(r => r.pass) ? 0 : 1)
  }

  // ── Per-suite summary
  console.log("\n=== SYSTEM-WIDE PARAPHRASE ROBUSTNESS ===\n")
  console.log("Per-suite pass rate:")
  for (const s of suitesToRun) {
    const rows = all.filter(r => r.suite === s.name)
    const p = rows.filter(r => r.pass).length
    const t = rows.length
    const rate = p / t
    console.log(`  ${fmtPct(rate)} ${bar(rate, 20)}  ${s.name.padEnd(24)} (${p}/${t})  ${s.description}`)
  }

  // ── Per-(suite × family) heatmap
  console.log("\nWeak spots (suite × mutation-family with <70% pass):")
  const cells = new Map<string, { pass: number; fail: number }>()
  for (const r of all) {
    const key = `${r.suite}::${r.family}`
    const e = cells.get(key) ?? { pass: 0, fail: 0 }
    if (r.pass) e.pass++; else e.fail++
    cells.set(key, e)
  }
  const weak = [...cells.entries()]
    .map(([k, v]) => ({ key: k, rate: v.pass / (v.pass + v.fail), pass: v.pass, total: v.pass + v.fail }))
    .filter(e => e.rate < 0.7 && e.total >= 2)
    .sort((a, b) => a.rate - b.rate)

  if (weak.length === 0) {
    console.log("  (none — every cell ≥70%)")
  } else {
    for (const w of weak) {
      console.log(`  ${fmtPct(w.rate)} ${bar(w.rate, 16)}  ${w.key.padEnd(48)} (${w.pass}/${w.total})`)
    }
  }

  // ── Per-family overall
  console.log("\nMutation-family overall pass-rate (across all suites):")
  const byFamily = new Map<string, { pass: number; fail: number }>()
  for (const r of all) {
    const e = byFamily.get(r.family) ?? { pass: 0, fail: 0 }
    if (r.pass) e.pass++; else e.fail++
    byFamily.set(r.family, e)
  }
  const famSorted = [...byFamily.entries()].sort((a, b) => {
    const ra = a[1].pass / (a[1].pass + a[1].fail)
    const rb = b[1].pass / (b[1].pass + b[1].fail)
    return ra - rb
  })
  for (const [f, v] of famSorted) {
    const t = v.pass + v.fail
    const rate = v.pass / t
    console.log(`  ${fmtPct(rate)} ${bar(rate, 16)}  ${f.padEnd(28)} (${v.pass}/${t})`)
  }

  // ── Top failures (one example per suite)
  console.log("\nFailure examples (first per weak suite):")
  const seenSuiteFail = new Set<string>()
  for (const r of all) {
    if (r.pass) continue
    if (seenSuiteFail.has(r.suite)) continue
    seenSuiteFail.add(r.suite)
    console.log(`  [${r.suite} / ${r.family}] expect=${JSON.stringify(r.expected)} got=${JSON.stringify(r.got)}`)
    console.log(`    seed:    "${r.seed}"`)
    console.log(`    mutated: "${r.mutated}"`)
  }

  const totalPass = all.filter(r => r.pass).length
  const overall = totalPass / all.length
  console.log(`\nOVERALL: ${totalPass}/${all.length}  (${(overall * 100).toFixed(1)}%)\n`)

  process.exit(overall >= 0.8 ? 0 : 1)
}

main().catch(err => {
  console.error("Eval crashed:", err)
  process.exit(99)
})
