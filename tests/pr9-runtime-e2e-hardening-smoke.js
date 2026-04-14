/*
  PR9 runtime end-to-end hardening smoke
  Usage: node tests/pr9-runtime-e2e-hardening-smoke.js

  Note:
  - Trace propagation assertions here are code-level (source assertions).
  - Runtime HTTP assertions validate behavior via endpoint responses.
*/

const fs = require("node:fs")
const path = require("node:path")

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const PATH = "/api/chat/site"

const ROOT = path.resolve(__dirname, "..")
const ROUTE_FILE = path.join(ROOT, "app", "api", "chat", "site", "route.ts")
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

function assertRouteTraceAndGroundedConfig() {
  const routeCode = fs.readFileSync(ROUTE_FILE, "utf8")

  assert(routeCode.includes("buildTraceId()"), "route trace: buildTraceId() not used")
  assert(routeCode.includes("logChatTrace({"), "route trace: logChatTrace not used")
  assert(routeCode.includes("normalizeQueryForTrace("), "route trace: normalizeQueryForTrace not used")
  assert(routeCode.includes("{ traceId }"), "route trace: resolveToolCalls is not passed traceId")

  const requiredStages = [
    'stage: "request_received"',
    'stage: "tool_resolution_started"',
    'stage: "tool_resolution_finished"',
    'stage: "response_ready"',
    'stage: "request_error"'
  ]
  for (const stage of requiredStages) {
    assert(routeCode.includes(stage), `route trace: missing stage ${stage}`)
  }

  const branchStages = ['stage: "direct_answer_returned"', 'stage: "grounded_stream_started"']
  const hasBranchStage = branchStages.some(stage => routeCode.includes(stage))
  assert(hasBranchStage, "route trace: missing direct_answer_returned/grounded_stream_started branch stage")

  // Grounded final call must no longer be 0.5
  assert(routeCode.includes("temperature: 0.0") || routeCode.includes("temperature: 0.1"),
    "route grounded final stream temperature is not deterministic/near-deterministic")
}

function assertBootstrapSourceFidelityInHandler() {
  const handlerCode = fs.readFileSync(HANDLER_FILE, "utf8")
  assert(handlerCode.includes("const routedSourceForSynthetic = orchestrated.routedSource || \"auto\""),
    "handler: routedSourceForSynthetic not found")
  assert(handlerCode.includes("source: routedSourceForSynthetic"),
    "handler: synthetic bootstrap args do not preserve routed source")
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
  if (!body) throw new Error("empty response body")
  return body
}

function assertNoImmediateUnavailable(text, label) {
  const hardUnavailableSignals = [
    "لم اتمكن من العثور",
    "لم اجد نتائج",
    "المعلومة غير متاحة حالياً"
  ]
  const unavailable = hardUnavailableSignals.some(s => text.includes(s))
  if (unavailable) {
    throw new Error(`${label}: hard unavailable returned prematurely`)
  }
}

async function run() {
  assertRouteTraceAndGroundedConfig()
  assertBootstrapSourceFidelityInHandler()

  const videoIntent = await ask("محاضرات الشيخ زمان الحسناوي")
  assertNoImmediateUnavailable(videoIntent, "video_intent")

  const projectsIntent = await ask("ما هي مشاريع توسعة العتبة")
  assertNoImmediateUnavailable(projectsIntent, "projects_intent")

  console.log("PASS: PR9 runtime end-to-end hardening smoke")
}

run().catch(err => {
  console.error("FAIL:", err.message)
  process.exit(1)
})
