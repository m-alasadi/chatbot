/**
 * Smoke regression for the paraphrase intent layer.
 * Run with: npx tsx tests/paraphrase-intent.smoke.ts
 */
import { detectAbbasRelationSlot, PersonRelationSlot } from "../lib/ai/paraphrase-intent"

type Case = { q: string; expect: PersonRelationSlot | null }

const cases: Case[] = [
  // Father
  { q: "من والد العباس", expect: "father" },
  { q: "من هو والد العباس", expect: "father" },
  { q: "ما اسم والد العباس", expect: "father" },
  { q: "من ابو العباس", expect: "father" },
  { q: "من ابوه العباس", expect: "father" },
  { q: "من هو أبو العباس بن علي", expect: "father" },
  { q: "والد أبي الفضل العباس من؟", expect: "father" },
  // Mother
  { q: "من والدة العباس", expect: "mother" },
  { q: "من ام العباس", expect: "mother" },
  { q: "ما اسم أم أبي الفضل العباس", expect: "mother" },
  { q: "من هي والدة قمر بني هاشم", expect: "mother" },
  // Wife
  { q: "من زوجة العباس", expect: "wife" },
  { q: "من هي زوجة العباس", expect: "wife" },
  { q: "ما اسم زوجة العباس", expect: "wife" },
  { q: "من تزوج العباس", expect: "wife" },
  { q: "كم زوجة للعباس", expect: "wife" },
  { q: "زوجات أبي الفضل العباس", expect: "wife" },
  { q: "من امرأة العباس", expect: "wife" },
  // Children
  { q: "من ابناء العباس", expect: "children" },
  { q: "من هم اولاد العباس", expect: "children" },
  { q: "كم ولد للعباس", expect: "children" },
  { q: "اسماء اولاد العباس", expect: "children" },
  { q: "ذرية العباس", expect: "children" },
  // Brothers / sisters / uncles
  { q: "من اخوة العباس", expect: "brothers" },
  { q: "اشقاء العباس", expect: "brothers" },
  { q: "من اخوات العباس", expect: "sisters" },
  { q: "من اعمام العباس", expect: "uncles" },
  // Titles / kunya
  { q: "ما القاب العباس", expect: "titles" },
  { q: "ما هي ألقاب أبي الفضل", expect: "titles" },
  { q: "ما كنية العباس", expect: "kunya" },
  // Martyrdom / birth / age
  { q: "متى استشهد العباس", expect: "martyrdom" },
  { q: "كيف استشهد العباس", expect: "martyrdom" },
  { q: "متى ولد العباس", expect: "birth" },
  { q: "كم كان عمر العباس يوم استشهاده", expect: "martyrdom" },
  // Definition
  { q: "من هو العباس", expect: "definition" },
  { q: "من هو ابو الفضل العباس", expect: "definition" },
  { q: "تعريف العباس", expect: "definition" },
  { q: "نبذة عن العباس", expect: "definition" },
  // Negative — institutional / unrelated
  { q: "ما هي مشاريع العتبة العباسية", expect: null },
  { q: "اخبار العتبة العباسية", expect: null },
  { q: "من هو المتولي الشرعي", expect: null },
  { q: "متى تأسست جامعة الكفيل", expect: null },
]

let pass = 0, fail = 0
for (const c of cases) {
  const got = detectAbbasRelationSlot(c.q)
  const ok = got === c.expect
  if (ok) pass++
  else fail++
  console.log(`${ok ? "OK  " : "FAIL"} "${c.q}" -> got=${got}, expect=${c.expect}`)
}
console.log(`\n${pass} pass / ${fail} fail / ${cases.length} total`)
process.exit(fail === 0 ? 0 : 1)
