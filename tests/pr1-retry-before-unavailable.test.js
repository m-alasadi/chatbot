/*
  PR1 smoke test: retry-before-unavailable behavior
  Usage: node tests/pr1-retry-before-unavailable.test.js
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
  return String(text || "").replace(/\s+/g, " ").trim()
}

async function main() {
  const query = "محاضرات الشيخ زمان الحسناوي"

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

  const text = normalize(await readBody(response))
  if (!text) throw new Error("Empty response")

  const hardUnavailableSignals = [
    "لم اتمكن من العثور",
    "لم اجد نتائج",
    "المعلومة غير متاحة حالياً"
  ]

  const lowered = text.toLowerCase()
  const isHardUnavailable = hardUnavailableSignals.some(s => lowered.includes(s))

  // PR1 expectation: this constrained query should often return content, not immediate unavailable.
  if (isHardUnavailable) {
    throw new Error("Unexpected hard unavailable response for PR1 retry smoke case")
  }

  console.log("PASS: no immediate hard unavailable in retry smoke case")
}

main().catch(err => {
  console.error("FAIL:", err.message)
  process.exit(1)
})
