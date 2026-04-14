import assert from "node:assert/strict"
import { understandQuery } from "../lib/server/query-understanding"

async function runTests() {
  testVideoQueryUnderstanding()
  testNewsVsVideoDisambiguation()
  testFactVsListIntent()
  testArabicEntityHandling()
  testRouteConfidenceBehavior()
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
  assert.ok(result.extracted_entities.source_specific.includes("projects_query"))
}

function testRouteConfidenceBehavior() {
  const generic = understandQuery("مرحبا")
  const specific = understandQuery("اعرض احدث فيديوهات الشيخ زمان الحسناوي")

  assert.ok(generic.route_confidence < specific.route_confidence)
  assert.ok(specific.route_confidence >= 0.6)
}

runTests().catch(err => {
  console.error(err)
  process.exit(1)
})
