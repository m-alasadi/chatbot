import assert from "node:assert/strict"
import { understandQuery } from "../lib/server/query-understanding"
import { buildDeterministicLatestListAnswer } from "../lib/server/function-calling-handler"
import { formatGroundedAnswer, type Evidence } from "../lib/server/evidence-extractor"
import { orchestrateRetrieval } from "../lib/server/retrieval-orchestrator"
import type { APICallResult } from "../lib/server/site-api-service"
import type { AllowedToolName } from "../lib/server/site-tools-definitions"

function testFactVsListIntentUnderstanding() {
  const fact = understandQuery("من هو أبو الفضل العباس")
  const list = understandQuery("اعرض أحدث الفيديوهات")

  assert.equal(fact.operation_intent, "fact_question")
  assert.equal(list.operation_intent, "latest")
}

function testListShapeFormatter() {
  const answer = buildDeterministicLatestListAnswer(
    {
      success: true,
      data: {
        source_used: "videos_latest",
        projects: [
          { name: "فيديو 1", url: "https://example.com/1" },
          { name: "فيديو 2", url: "https://example.com/2" }
        ]
      }
    },
    "videos_latest"
  )

  assert.ok(answer)
  assert.ok(String(answer).includes("1. فيديو 1"))
  assert.ok(String(answer).includes("2. فيديو 2"))
}

function testFactGroundedShapeIsCompact() {
  const evidence: Evidence[] = [
    {
      quote: "أبو الفضل العباس هو ابن الإمام علي بن أبي طالب.",
      source_title: "سيرة أبي الفضل العباس",
      source_url: "https://alkafeel.net/abbas?lang=ar",
      source_section: "التعريف",
      confidence: 80
    }
  ]

  const answer = formatGroundedAnswer("من هو أبو الفضل العباس", evidence)
  assert.ok(answer.includes("[المصدر]("))
  assert.ok(!answer.includes("\n\n"))
}

function testProjectGroundedShapeHasProjectSignal() {
  const evidence: Evidence[] = [
    {
      quote: "شهدت العتبة مشروع توسعة جديد في الصحن الشريف.",
      source_title: "أخبار العتبة",
      source_url: "https://alkafeel.net/news/example",
      source_section: "مشاريع",
      confidence: 70
    }
  ]

  const answer = formatGroundedAnswer("ما هي مشاريع توسعة العتبة", evidence)
  assert.ok(answer.includes("مشاريع"))
}

async function testBiographyRoutingAvoidsInvalidFirstSource() {
  const calls: Array<{ tool: AllowedToolName; source: string }> = []

  const exec = async (
    toolName: AllowedToolName,
    args: Record<string, any>
  ): Promise<APICallResult> => {
    calls.push({ tool: toolName, source: String(args.source || "") })
    return {
      success: true,
      data: {
        results: [{ id: "bio-1", source_type: "shrine_history_sections", name: "سيرة أبي الفضل العباس" }],
        total: 1,
        top_score: 8,
        source_used: args.source
      }
    }
  }

  const result = await orchestrateRetrieval(
    "search_content",
    { query: "ما هي ألقاب أبي الفضل العباس", source: "auto" },
    { execute: exec }
  )

  assert.ok(result)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].source, "shrine_history_sections")
}

async function testWahyVsFridayRoutingSeparation() {
  const calls: Array<{ q: string; source: string }> = []

  const exec = async (
    _toolName: AllowedToolName,
    args: Record<string, any>
  ): Promise<APICallResult> => {
    calls.push({ q: String(args.query || ""), source: String(args.source || "") })
    return {
      success: true,
      data: {
        results: [{ id: "x", source_type: args.source, name: "item" }],
        total: 1,
        top_score: 9,
        source_used: args.source
      }
    }
  }

  await orchestrateRetrieval(
    "search_content",
    { query: "اعرض أحدث من وحي الجمعة", source: "auto" },
    { execute: exec }
  )

  await orchestrateRetrieval(
    "search_content",
    { query: "اعرض أحدث خطب الجمعة", source: "auto" },
    { execute: exec }
  )

  const wahyCall = calls.find(c => c.q.includes("وحي"))
  const sermonCall = calls.find(c => c.q.includes("خطب"))

  assert.ok(wahyCall)
  assert.ok(sermonCall)
  assert.equal(wahyCall?.source, "wahy_friday")
  assert.equal(sermonCall?.source, "friday_sermons")
}

async function runTests() {
  testFactVsListIntentUnderstanding()
  testListShapeFormatter()
  testFactGroundedShapeIsCompact()
  testProjectGroundedShapeHasProjectSignal()
  await testBiographyRoutingAvoidsInvalidFirstSource()
  await testWahyVsFridayRoutingSeparation()
  console.log("PR12 red-category regression tests passed")
}

runTests().catch(err => {
  console.error(err)
  process.exit(1)
})
