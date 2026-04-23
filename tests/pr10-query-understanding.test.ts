import assert from "node:assert/strict"
import { deriveRetrievalCapabilitySignals, understandQuery } from "../lib/server/query-understanding"
import { rankCandidateSources } from "../lib/server/site-ranking-policy"

async function runTests() {
  testVideoQueryUnderstanding()
  testNewsVsVideoDisambiguation()
  testFactVsListIntent()
  testArabicEntityHandling()
  testRouteConfidenceBehavior()
  testSharedCapabilitySignalsGuideRanking()
  testInstitutionalExistenceCapabilitySignal()
  testTitleOrPhraseLookupCapabilitySignal()
  console.log("PR10 query understanding tests passed")
}

function testVideoQueryUnderstanding() {
  const result = understandQuery("محاضرات الشيخ زمان الحسناوي")
  assert.equal(result.content_intent, "video")
  assert.ok(result.hinted_sources.includes("videos_latest"))
}

function testNewsVsVideoDisambiguation() {
  const news = understandQuery("احدث اخبار العتبة")
  const video = understandQuery("احدث فيديوهات العتبة")

  assert.equal(news.content_intent, "news")
  assert.equal(video.content_intent, "video")
  assert.ok(news.hinted_sources.includes("articles_latest"))
  assert.ok(video.hinted_sources.includes("videos_latest"))
}

function testFactVsListIntent() {
  const fact = understandQuery("من هو أبو الفضل العباس")
  const list = understandQuery("اعرض احدث الفيديوهات")

  assert.equal(fact.operation_intent, "fact_question")
  assert.equal(list.operation_intent, "latest")
}

function testArabicEntityHandling() {
  const result = understandQuery("ما هي مشاريع توسعة العتبة")
  assert.ok(result.extracted_entities.place.some(p => p.includes("عتبة") || p.includes("العتبه")))
  assert.ok(result.extracted_entities.topic.some(t => t.includes("مشاريع") || t.includes("توسعة") || t.includes("توسعه")))
  assert.ok(result.hinted_sources.includes("auto"))
}

function testRouteConfidenceBehavior() {
  const generic = understandQuery("مرحبا")
  const specific = understandQuery("اعرض احدث فيديوهات الشيخ زمان الحسناوي")

  assert.ok(generic.route_confidence < specific.route_confidence)
  assert.ok(specific.route_confidence >= 0.6)
}

function testSharedCapabilitySignalsGuideRanking() {
  const query = "من هو المتولي الشرعي للعتبة العباسية"
  const understanding = understandQuery(query)
  const capability = deriveRetrievalCapabilitySignals(understanding, query)
  const ranked = rankCandidateSources(query, {}, capability)

  assert.equal(capability.office_holder_fact, true)
  assert.equal(ranked[0], "articles_latest")
}

function testInstitutionalExistenceCapabilitySignal() {
  const query = "هل لدى العتبة العباسية مشاريع زراعية"
  const understanding = understandQuery(query)
  const capability = deriveRetrievalCapabilitySignals(understanding, query)

  assert.equal(capability.institutional_relation, true)
}

function testTitleOrPhraseLookupCapabilitySignal() {
  const query = "حين تنطق الآيات ذهبا حكاية الكتيبة"
  const understanding = understandQuery(query)
  const capability = deriveRetrievalCapabilitySignals(understanding, query)

  assert.equal(capability.title_or_phrase_lookup, true)
}

runTests().catch(err => {
  console.error(err)
  process.exit(1)
})
