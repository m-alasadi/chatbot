/*
  PR10 runtime understanding smoke
  Usage: node tests/pr10-runtime-understanding-smoke.js

  Note:
  - query-understanding integration assertions are code-level.
  - endpoint assertions validate runtime behavior through /api/chat/site.
*/

const fs = require("node:fs")
const path = require("node:path")

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const PATH = "/api/chat/site"

const ROOT = path.resolve(__dirname, "..")
const HANDLER_FILE = path.join(ROOT, "lib", "server", "function-calling-handler.ts")
const ORCHESTRATOR_FILE = path.join(ROOT, "lib", "server", "retrieval-orchestrator.ts")
const UNDERSTANDING_FILE = path.join(ROOT, "lib", "server", "query-understanding.ts")

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

function assertUnderstandingIntegrationInCode() {
  const handlerCode = fs.readFileSync(HANDLER_FILE, "utf8")
  const orchestratorCode = fs.readFileSync(ORCHESTRATOR_FILE, "utf8")
  const understandingCode = fs.readFileSync(UNDERSTANDING_FILE, "utf8")

  assert(understandingCode.includes("export interface QueryUnderstandingResult"), "missing QueryUnderstandingResult type")
  assert(understandingCode.includes("content_intent"), "missing content_intent in understanding layer")
  assert(understandingCode.includes("operation_intent"), "missing operation_intent in understanding layer")
  assert(understandingCode.includes("extracted_entities"), "missing extracted_entities in understanding layer")
  assert(understandingCode.includes("route_confidence"), "missing route_confidence in understanding layer")

  assert(handlerCode.includes("const queryUnderstanding = understandQuery(userQueryForIntent)"),
    "handler does not compute query understanding before orchestration")
  assert(handlerCode.includes("queryUnderstanding"), "handler does not pass query understanding through runtime")

  assert(orchestratorCode.includes("queryUnderstanding?: QueryUnderstandingResult"),
    "orchestrator options do not accept query understanding")
  assert(orchestratorCode.includes("operation_intent"),
    "orchestrator trace details do not include operation_intent")
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

  const text = normalize(await readBody(response))
  if (!text) throw new Error("empty response body")
  return text
}

function assertNoImmediateUnavailable(text, label) {
  const hardUnavailableSignals = [
    "لم اتمكن من العثور",
    "لم اجد نتائج",
    "المعلومة غير متاحة حالياً"
  ]
  const unavailable = hardUnavailableSignals.some(s => text.includes(s))
  if (unavailable) {
    throw new Error(`${label}: hard unavailable returned before attempts exhausted`)
  }
}

async function run() {
  assertUnderstandingIntegrationInCode()

  const video = await ask("محاضرات الشيخ زمان الحسناوي")
  assertNoImmediateUnavailable(video, "video_intent")

  const projects = await ask("ما هي مشاريع توسعة العتبة")
  assertNoImmediateUnavailable(projects, "projects_intent")

  console.log("PASS: PR10 runtime understanding smoke")
}

run().catch(err => {
  console.error("FAIL:", err.message)
  process.exit(1)
})
