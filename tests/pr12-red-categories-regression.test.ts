import assert from "node:assert/strict"
import { understandQuery } from "../lib/server/query-understanding"
import { buildDeterministicLatestListAnswer } from "../lib/server/function-calling-handler"
import { formatGroundedAnswer, type Evidence } from "../lib/server/evidence-extractor"
import { orchestrateRetrieval } from "../lib/server/retrieval-orchestrator"
import { scoreUnifiedItem } from "../lib/server/site-ranking-policy"
import {
  shouldAllowOfficialNewsSearchFallback,
  type APICallResult
} from "../lib/server/site-api-service"
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

function testHistoryQueriesCanFallbackToOfficialNewsSearch() {
  const capability = {
    entity_first_mode: true,
    entity_first_reason: "history_lookup",
    named_event_or_program: false,
    office_holder_fact: false,
    person_attribute_fact: false,
    singular_project_lookup: false,
    institutional_relation: false,
    title_or_phrase_lookup: false,
    underspecified_query: false
  }

  assert.equal(
    shouldAllowOfficialNewsSearchFallback(
      "shrine_history_sections",
      0,
      0,
      capability,
      "في قسم تاريخ العتبة تكلم لي عن مراحل الهدم"
    ),
    true
  )

  assert.equal(
    shouldAllowOfficialNewsSearchFallback(
      "abbas_history_by_id",
      0,
      0,
      capability,
      "ألقاب أبي الفضل العباس"
    ),
    false
  )
}

function testOfficialNewsHitSurvivesNamedPhraseArticleVariation() {
  const score = scoreUnifiedItem(
    {
      name: "العتبة العباسية المقدسة بين مراحل الهدم والعدوان وعمليات الاعمار",
      description: "",
      source_type: "articles_latest",
      sections: [{ id: "official_news_search", name: "نتائج بحث الأخبار" }],
      source_raw: {
        official_search: true,
        query: "مراحل هدم"
      }
    },
    "ماهي مراحل هدم العتبة العباسية"
  )

  assert.ok(score > 0)
}

async function testShrineLifecycleBuildingQueryPrefersTimelineHistoryRoute() {
  const calls: Array<{ tool: AllowedToolName; source: string }> = []

  const exec = async (
    toolName: AllowedToolName,
    args: Record<string, any>
  ): Promise<APICallResult> => {
    calls.push({ tool: toolName, source: String(args.source || "") })
    return {
      success: true,
      data: {
        results: [
          {
            id: "history-1",
            source_type: "shrine_history_timeline",
            name: "مراحل البناء في العتبة العباسية المقدسة"
          }
        ],
        total: 1,
        top_score: 12,
        source_used: args.source
      }
    }
  }

  const result = await orchestrateRetrieval(
    "search_content",
    { query: "ماهي مراحل بناء العتبة العباسية", source: "auto" },
    { execute: exec }
  )

  assert.ok(result)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].source, "shrine_history_timeline")
}

function testEventExhibitOfficialNewsIsRejectedForShrineLifecycleQuery() {
  const score = scoreUnifiedItem(
    {
      name: "لأول مرة في تركيا :معرض للرسوم الثلاثية الأبعاد توضح مراحل البناء والعدوان على قبر الإمام الحسين عليه السلام تُعده العتبة العباسية المقدسة",
      description: "",
      source_type: "articles_latest",
      sections: [{ id: "official_news_search", name: "نتائج بحث الأخبار" }],
      source_raw: {
        official_search: true,
        query: "مراحل البناء"
      }
    },
    "ماهي مراحل بناء العتبة العباسية"
  )

  assert.equal(score, 0)
}

function testCurrentProjectNewsIsRejectedForShrineLifecycleQuery() {
  const score = scoreUnifiedItem(
    {
      name: "مشروع بناء أواوين للطابق الثاني في العتبة العباسية المقدسة يقطع مراحل متقدمة",
      description: "",
      source_type: "articles_latest",
      sections: [{ id: "official_news_search", name: "نتائج بحث الأخبار" }],
      source_raw: {
        official_search: true,
        query: "مراحل البناء"
      }
    },
    "ماهي مراحل بناء العتبة العباسية"
  )

  assert.equal(score, 0)
}

function testNonAbbasShrineResultIsRejectedForAbbasLifecycleQuery() {
  const score = scoreUnifiedItem(
    {
      name: "تقارير مصورة حول سامراء وآخر مراحل بناء مرقد الإمامين العسكريين عليهما السلام",
      description: "",
      source_type: "articles_latest",
      sections: [{ id: "official_news_search", name: "نتائج بحث الأخبار" }],
      source_raw: {
        official_search: true,
        query: "مراحل البناء"
      }
    },
    "ماهي مراحل بناء العتبة العباسية"
  )

  assert.equal(score, 0)
}

function testBuildingHistoryAnswerShapeIsNotProjectHeading() {
  const answer = formatGroundedAnswer(
    "ماهي مراحل بناء العتبة العباسية",
    [
      {
        quote: "مرّت العتبة العباسية المقدسة بمراحل بناء متعددة عبر تاريخها.",
        source_title: "مراحل البناء في العتبة العباسية",
        source_url: "https://alkafeel.net/news/index?id=1&lang=ar",
        source_section: "نتائج بحث الأخبار",
        confidence: 72
      }
    ]
  )

  assert.ok(!answer.includes("أبرز مشاريع التوسعة"))
  assert.ok(!answer.includes("أبرز المشاريع ذات الصلة"))
  assert.ok(answer.includes("النتائج الأقرب") || answer.includes("الجواب"))
}

async function runTests() {
  testFactVsListIntentUnderstanding()
  testListShapeFormatter()
  testFactGroundedShapeIsCompact()
  testProjectGroundedShapeHasProjectSignal()
  testHistoryQueriesCanFallbackToOfficialNewsSearch()
  testOfficialNewsHitSurvivesNamedPhraseArticleVariation()
  testEventExhibitOfficialNewsIsRejectedForShrineLifecycleQuery()
  testCurrentProjectNewsIsRejectedForShrineLifecycleQuery()
  testNonAbbasShrineResultIsRejectedForAbbasLifecycleQuery()
  testBuildingHistoryAnswerShapeIsNotProjectHeading()
  await testBiographyRoutingAvoidsInvalidFirstSource()
  await testShrineLifecycleBuildingQueryPrefersTimelineHistoryRoute()
  await testWahyVsFridayRoutingSeparation()
  console.log("PR12 red-category regression tests passed")
}

runTests().catch(err => {
  console.error(err)
  process.exit(1)
})
