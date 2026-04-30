/**
 * Smoke test for the AI-first query understanding system.
 *
 * Run:
 *   Get-Content .env.local | Where-Object { $_ -like 'OPENAI_API_KEY*' } | ForEach-Object { $kv = $_ -split '=', 2; [Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim().Trim('"'), 'Process') }
 *   npx tsx tests/ai-first-understanding.test.ts
 */

import { understandQueryWithFallback } from "../lib/server/query-understanding"

const QUESTIONS = [
  "ما آخر أخبار العتبة؟",
  "اعطني آخر فيديو عن زيارة الأربعين",
  "فيديوهات عن كربلاء",
  "خطبة الجمعة الأخيرة",
  "من وحي الجمعة عن الصبر",
  "من هو المتولي الشرعي؟",
  "هل لدى العتبة جامعة؟",
  "اشرح مشروع صحن العقيلة",
  "حدثني عن الزيارة",
  "هل يوجد شيء عن كربلاء؟",
]

async function main() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error("OPENAI_API_KEY not set — set it before running this test")
    process.exit(1)
  }

  console.log(`\n${"=".repeat(72)}`)
  console.log("  AI-FIRST QUERY UNDERSTANDING  —  smoke test")
  console.log(`${"=".repeat(72)}\n`)

  for (const q of QUESTIONS) {
    console.log(`\n${"─".repeat(60)}`)
    console.log(`Q: ${q}`)
    try {
      const r = await understandQueryWithFallback(q, apiKey)
      console.log(`  source          : ${r.understanding_source ?? "regex"}`)
      console.log(`  content_intent  : ${r.content_intent}`)
      console.log(`  operation_intent: ${r.operation_intent}`)
      console.log(`  clarity         : ${r.clarity}`)
      console.log(`  main_topic      : ${r.main_topic ?? "(none)"}`)
      console.log(`  clean_query     : ${r.clean_search_query ?? "(none)"}`)
      console.log(`  keywords        : ${(r.keywords ?? []).join(", ") || "(none)"}`)
      console.log(`  allowed_sources : ${(r.allowed_sources ?? []).join(", ") || "(none)"}`)
      console.log(`  forbidden_srcs  : ${(r.forbidden_sources ?? []).join(", ") || "(none)"}`)
      console.log(`  hinted_sources  : ${r.hinted_sources.join(", ")}`)
      console.log(`  needs_clarif.   : ${r.needs_clarification ?? false}`)
      if (r.needs_clarification && r.clarification_question) {
        console.log(`  clarif. Q       : ${r.clarification_question}`)
      }
      console.log(`  ai_confidence   : ${r.ai_confidence ?? "(n/a)"}`)
      console.log(`  ai_reason       : ${r.ai_reason ?? "(n/a)"}`)
    } catch (err) {
      console.error(`  ERROR: ${err}`)
    }
  }

  console.log(`\n${"=".repeat(72)}\n`)
}

main().catch(console.error)
