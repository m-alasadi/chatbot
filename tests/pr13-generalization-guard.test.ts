import assert from "node:assert/strict"
import {
  deriveRetrievalCapabilitySignals,
  understandQuery
} from "../lib/server/query-understanding"
import {
  shouldAllowSafeCapabilityDirectAnswer
} from "../lib/server/function-calling-handler"
import { getSafeCapabilityDirectAnswer } from "../lib/server/runtime/answer-shape-policy"
import { rankCandidateSources } from "../lib/server/site-ranking-policy"

function testSharedCapabilitySignalsGuideOfficeHolderRanking() {
  const query = "من هو المتولي الشرعي للعتبة العباسية"
  const understanding = understandQuery(query)
  const capability = deriveRetrievalCapabilitySignals(understanding, query)
  const ranked = rankCandidateSources(query, {}, capability)

  assert.equal(capability.office_holder_fact, true)
  assert.equal(ranked[0], "articles_latest")
}

function testSafeCapabilityGateRejectsOrdinaryFactQuery() {
  const query = "ما هي صفات أبي الفضل العباس كما يذكرها الموقع؟"
  const understanding = understandQuery(query)

  assert.equal(shouldAllowSafeCapabilityDirectAnswer(query, understanding), false)
}

function testSafeCapabilityGateAllowsSiteHelpQuery() {
  const query = "كيف استخدم خدمة الزيارة بالنيابة؟"
  const understanding = understandQuery(query)

  assert.equal(shouldAllowSafeCapabilityDirectAnswer(query, understanding), true)
}

function testSafeCapabilityGateAllowsNamedEventLocationQuery() {
  const query = "أين يقام نداء العقيدة"
  const understanding = understandQuery(query)

  assert.equal(shouldAllowSafeCapabilityDirectAnswer(query, understanding), true)
}

function testSafeCapabilityGateAllowsTranslationCapabilityQuery() {
  const query = "ترجمة كلمات الموقع"
  const understanding = understandQuery(query)

  assert.equal(shouldAllowSafeCapabilityDirectAnswer(query, understanding), true)
}

function testSafeCapabilityGateAllowsFridayVideoAvailabilityQuery() {
  const query = "هل يوجد فيديو لخطبة الجمعة"
  const understanding = understandQuery(query)

  assert.equal(shouldAllowSafeCapabilityDirectAnswer(query, understanding), true)
  assert.ok(getSafeCapabilityDirectAnswer(query)?.includes("توجد فيديوهات لخطب الجمعة"))
}

async function runTests() {
  testSharedCapabilitySignalsGuideOfficeHolderRanking()
  testSafeCapabilityGateRejectsOrdinaryFactQuery()
  testSafeCapabilityGateAllowsSiteHelpQuery()
  testSafeCapabilityGateAllowsNamedEventLocationQuery()
  testSafeCapabilityGateAllowsTranslationCapabilityQuery()
  testSafeCapabilityGateAllowsFridayVideoAvailabilityQuery()
  console.log("PR13 generalization guard tests passed")
}

runTests().catch(err => {
  console.error(err)
  process.exit(1)
})
