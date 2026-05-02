import assert from "node:assert/strict"
import { scoreUnifiedItem } from "../lib/server/site-ranking-policy"

// Minimal item factory mirroring the shape used by scoreUnifiedItem
function makeItem(name: string, description = ""): any {
  return {
    name,
    description,
    source_type: "videos_latest",
    source_raw: {}
  }
}

function makeOfficialHit(name: string, query: string): any {
  return {
    name,
    description: "",
    source_type: "articles_latest",
    source_raw: { official_search: true, query }
  }
}

function runTests() {
  testHonorificOnlyMatchIsRejected()
  testActualNamePartIsRequiredEvenForOfficialHit()
  testCorrectPersonNamePassesScoring()
  testDifferentHonorificStillRejected()
  console.log("PR14 honorific disambiguation tests passed")
}

// Query asks about الشيخ زمان; candidate is for الشيخ جاسم — must score 0
function testHonorificOnlyMatchIsRejected() {
  const query = "محاضرات الشيخ زمان"
  const candidate = makeItem(
    "محاضرة دينية يلقيها فضيلة الشيخ جاسم الكربلائي",
    "محاضرة دينية للشيخ جاسم الكربلائي"
  )
  const score = scoreUnifiedItem(candidate, query)
  assert.equal(score, 0, `Expected 0 for honorific-only match (got ${score})`)
}

// Even when the result was returned by the official site search (which usually
// gets a relaxed minimum-match threshold), a wrong-person hit must still be rejected.
function testActualNamePartIsRequiredEvenForOfficialHit() {
  const query = "محاضرات الشيخ زمان"
  const candidate = makeOfficialHit(
    "الشيخ جاسم الكربلائي - محاضرة في الأخلاق",
    "الشيخ زمان"
  )
  const score = scoreUnifiedItem(candidate, query)
  assert.equal(score, 0, `Expected 0 for official-hit wrong-person (got ${score})`)
}

// Correct person name in title → score must be > 0
function testCorrectPersonNamePassesScoring() {
  const query = "محاضرات الشيخ زمان"
  const candidate = makeItem(
    "محاضرة دينية للشيخ زمان الحسناوي بذكرى هدم البقيع",
    "محاضرة دينية يلقيها الشيخ زمان الحسناوي"
  )
  const score = scoreUnifiedItem(candidate, query)
  assert.ok(score > 0, `Expected positive score for correct person (got ${score})`)
}

// Query uses الشيخ; result uses different honorific (السيد) for a different person → reject
function testDifferentHonorificStillRejected() {
  const query = "محاضرات الشيخ زمان"
  const candidate = makeItem(
    "محاضرة للسيد أحمد الصافي",
    "محاضرة للسيد أحمد الصافي"
  )
  const score = scoreUnifiedItem(candidate, query)
  assert.equal(score, 0, `Expected 0 for different person + different honorific (got ${score})`)
}

runTests()
