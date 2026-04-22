import assert from "node:assert/strict"
import {
  deriveRetrievalCapabilitySignals,
  understandQuery
} from "../lib/server/query-understanding"
import { rankCandidateSources } from "../lib/server/site-ranking-policy"

function testSharedCapabilitySignalsGuideOfficeHolderRanking() {
  const query = "من هو المتولي الشرعي للعتبة العباسية"
  const understanding = understandQuery(query)
  const capability = deriveRetrievalCapabilitySignals(understanding, query)
  const ranked = rankCandidateSources(query, {}, capability)

  assert.equal(capability.office_holder_fact, true)
  assert.equal(ranked[0], "articles_latest")
}

async function runTests() {
  testSharedCapabilitySignalsGuideOfficeHolderRanking()
  console.log("PR13 generalization guard tests passed")
}

runTests().catch(err => {
  console.error(err)
  process.exit(1)
})