/*
  PR2 integration smoke test
  Usage: node tests/pr2-orchestrator-integration-smoke.js
*/

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const PATH = "/api/chat/site"

async function readBody(response) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase()
  if (contentType.includes("application/json")) {
    const data = await response.json()
    return data?.message || data?.fallback || JSON.stringify(data)
  }
  return await response.text()
}

function normalize(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase()
}

async function ask(query) {
  const response = await fetch(`${BASE_URL}${PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: query }],
      use_tools: true,
      temperature: 0.5,
      max_tokens: 1200
    })
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const body = normalize(await readBody(response))
  if (!body) {
    throw new Error("empty response body")
  }

  return body
}

async function run() {
  const text = await ask("محاضرات الشيخ زمان الحسناوي")

  const hardUnavailableSignals = [
    "لم اتمكن من العثور",
    "لم اجد نتائج",
    "المعلومة غير متاحة حالياً"
  ]
  const unavailable = hardUnavailableSignals.some(s => text.includes(s))
  if (unavailable) {
    throw new Error("orchestrator smoke failed: returned hard unavailable")
  }

  const strongNewsBias = text.includes("الأخبار") && !text.includes("فيديو") && !text.includes("محاض")
  if (strongNewsBias) {
    throw new Error("orchestrator smoke failed: response appears news-biased for video-intent query")
  }

  console.log("PASS: PR2 orchestrator integration smoke")
}

run().catch(err => {
  console.error("FAIL:", err.message)
  process.exit(1)
})
