/*
  PR8 integration-style smoke test
  Usage: node tests/pr8-retrieval-ownership-smoke.js
*/

const fs = require("node:fs")
const path = require("node:path")

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const PATH = "/api/chat/site"

const ROOT = path.resolve(__dirname, "..")
const HANDLER_FILE = path.join(ROOT, "lib", "server", "function-calling-handler.ts")

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function normalize(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase()
}

async function readBody(response) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase()
  if (contentType.includes("application/json")) {
    const data = await response.json()
    return data?.message || data?.fallback || JSON.stringify(data)
  }
  return await response.text()
}

function assertSourceFidelityAndNarrowedOwnership() {
  const code = fs.readFileSync(HANDLER_FILE, "utf8")

  // PR8-1: synthetic bootstrap args should preserve orchestrator source
  assert(code.includes("const routedSourceForSynthetic = orchestrated.routedSource || \"auto\""),
    "source fidelity: routedSourceForSynthetic missing")
  assert(code.includes("source: routedSourceForSynthetic"),
    "source fidelity: synthetic bootstrap args do not use routedSourceForSynthetic")

  // PR8-2: post-bootstrap tool access should be utility-only (no broad retrieval reopening)
  assert(code.includes("const allowedUtilityTools = new Set(["),
    "ownership: allowedUtilityTools guard missing")
  assert(code.includes('"get_source_metadata"'), "ownership: get_source_metadata should remain allowed")
  assert(code.includes('"browse_source_page"'), "ownership: browse_source_page should remain allowed")
  assert(code.includes('"get_latest_by_source"'), "ownership: get_latest_by_source should remain allowed")
  assert(code.includes('"list_source_categories"'), "ownership: list_source_categories should remain allowed")
  assert(code.includes('"get_statistics"'), "ownership: get_statistics should remain allowed")

  assert(code.includes("toolsForIteration.length > 0"),
    "ownership: missing safeguard for empty post-bootstrap tools set")
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

  return normalize(await readBody(response))
}

function assertNoImmediateUnavailable(text, label) {
  const hardUnavailableSignals = [
    "لم اتمكن من العثور",
    "لم اجد نتائج",
    "المعلومة غير متاحة حالياً"
  ]
  const unavailable = hardUnavailableSignals.some(s => text.includes(s))
  if (unavailable) {
    throw new Error(`${label}: hard unavailable returned before orchestration exhaustion/recovery`)
  }
}

async function run() {
  assertSourceFidelityAndNarrowedOwnership()

  const videoText = await ask("محاضرات الشيخ زمان الحسناوي")
  assertNoImmediateUnavailable(videoText, "video_intent")

  const projectsText = await ask("ما هي مشاريع توسعة العتبة")
  assertNoImmediateUnavailable(projectsText, "projects_intent")

  console.log("PASS: PR8 retrieval ownership hardening smoke")
}

run().catch(err => {
  console.error("FAIL:", err.message)
  process.exit(1)
})
