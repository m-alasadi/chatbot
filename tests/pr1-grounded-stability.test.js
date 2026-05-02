/*
  PR1 smoke test: grounded stability
  Usage: node tests/pr1-grounded-stability.test.js
*/

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const PATH = "/api/chat/site"
const RUNS = Number(process.env.RUNS || 5)

async function readBody(response) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase()
  if (contentType.includes("application/json")) {
    const data = await response.json()
    return data?.message || JSON.stringify(data)
  }
  return await response.text()
}

function normalize(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
}

async function runOnce(query) {
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

  return normalize(await readBody(response))
}

async function main() {
  const query = "من هو ابو الفضل العباس"
  const outputs = []

  for (let i = 0; i < RUNS; i++) {
    const text = await runOnce(query)
    if (!text) throw new Error(`Empty response at run ${i + 1}`)
    outputs.push(text)
  }

  const signatures = outputs.map(o => o.slice(0, 180))
  const unique = new Set(signatures)

  console.log("Runs:", RUNS)
  console.log("Unique leading signatures:", unique.size)

  // PR1 target is improved stability; allow slight variation while preventing high drift.
  if (unique.size > 2) {
    throw new Error(`Stability regression: got ${unique.size} unique outputs in ${RUNS} runs`)
  }

  console.log("PASS: grounded stability within expected PR1 bound")
}

main().catch(err => {
  console.error("FAIL:", err.message)
  process.exit(1)
})
