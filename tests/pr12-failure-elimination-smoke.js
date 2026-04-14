/*
  PR12 targeted regression smoke for previously red PR11 categories
  Usage: node tests/pr12-failure-elimination-smoke.js
*/

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const PATH = "/api/chat/site"
const REQUEST_TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS || 60000)

function normalize(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase()
}

function hasAny(text, words) {
  const norm = normalize(text)
  return words.some(w => norm.includes(normalize(w)))
}

function hasUnavailable(text) {
  const signals = [
    "لم اتمكن من العثور",
    "لم اجد نتائج",
    "المعلومة غير متاحة حالياً"
  ]
  return hasAny(text, signals)
}

function isListLike(text) {
  const lines = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const bulletLike = lines.filter(l => /^[-*•\d]+[).:\-\s]/.test(l)).length
  return bulletLike >= 2 || lines.length >= 4
}

function isFactLike(text) {
  if (isListLike(text)) return false
  return String(text || "").trim().length >= 40
}

async function readBody(response) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase()
  if (contentType.includes("application/json")) {
    const data = await response.json()
    return data?.message || data?.fallback || JSON.stringify(data)
  }
  return await response.text()
}

async function ask(query) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${BASE_URL}${PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: query }],
        use_tools: true,
        temperature: 0.5,
        max_tokens: 1200
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const text = String(await readBody(response) || "")
    if (!text.trim()) throw new Error("empty response body")
    return text
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`timeout_${REQUEST_TIMEOUT_MS}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function run() {
  // 1) fact_vs_list_intent
  const fact = await ask("من هو أبو الفضل العباس")
  const list = await ask("اعرض أحدث الفيديوهات")
  assert(isFactLike(fact), "fact query should remain fact-like")
  assert(isListLike(list) || hasAny(list, ["1.", "2.", "•", "-", "فيديو"]), "list query should remain list-like")

  // 2) biography_vs_shrine_history (eliminate HTTP 500 and keep semantic split)
  const bio = await ask("ما هي ألقاب أبي الفضل العباس")
  const shrine = await ask("ما هي مشاريع توسعة العتبة")
  assert(!hasUnavailable(bio), "biography query should not hard-unavailable")
  assert(!hasUnavailable(shrine), "shrine history query should not hard-unavailable")
  assert(hasAny(bio, ["العباس", "ابي الفضل", "أبي الفضل", "لقب", "القاب"]), "biography response missing biography signal")
  assert(hasAny(shrine, ["مشروع", "مشاريع", "توسعة", "العتبة"]), "shrine response missing project/history signal")

  // 3) wahy_vs_friday_sermon (eliminate timeout and keep disambiguation)
  const wahy = await ask("اعرض أحدث من وحي الجمعة")
  const sermon = await ask("اعرض أحدث خطب الجمعة")
  assert(!hasUnavailable(wahy), "wahy query should not hard-unavailable")
  assert(!hasUnavailable(sermon), "sermon query should not hard-unavailable")
  assert(hasAny(wahy, ["وحي", "الجمعة", "من وحي"]), "wahy response missing wahy signal")
  assert(hasAny(sermon, ["خطب", "خطبة", "خطيب", "منبر"]), "sermon response missing sermon signal")

  console.log("PASS: PR12 failure elimination smoke")
}

run().catch(err => {
  console.error("FAIL:", err.message)
  process.exit(1)
})
