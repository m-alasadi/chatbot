/*
  PR7 integration-style hardening test
  Usage: node tests/pr7-runtime-hardening-smoke.js
*/

const fs = require("node:fs")
const path = require("node:path")

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const PATH = "/api/chat/site"

const ROOT = path.resolve(__dirname, "..")
const ROUTE_FILE = path.join(ROOT, "app", "api", "chat", "site", "route.ts")
const HANDLER_FILE = path.join(ROOT, "lib", "server", "function-calling-handler.ts")

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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertRuntimeConfigInSource() {
  const routeCode = fs.readFileSync(ROUTE_FILE, "utf8")
  const handlerCode = fs.readFileSync(HANDLER_FILE, "utf8")

  assert(routeCode.includes("buildTraceId()"), "route hardening: buildTraceId not used")
  assert(routeCode.includes("{ traceId }"), "route hardening: traceId not passed to resolveToolCalls")

  const requiredStages = [
    'stage: "request_received"',
    'stage: "tools_resolved"',
    'stage: "final_stream_started"',
    'stage: "runtime_error"'
  ]
  for (const stage of requiredStages) {
    assert(routeCode.includes(stage), `route hardening: missing trace stage ${stage}`)
  }

  assert(routeCode.includes("temperature: 0.0"), "route hardening: grounded final temperature is not deterministic")

  assert(handlerCode.includes("routedSourceForSynthetic"), "handler hardening: synthetic tool message does not preserve routed source")
  assert(handlerCode.includes("getPostBootstrapTools"), "handler hardening: post-bootstrap tool narrowing is missing")
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

function assertNoImmediateUnavailable(text, label) {
  const hardUnavailableSignals = [
    "لم اتمكن من العثور",
    "لم اجد نتائج",
    "المعلومة غير متاحة حالياً"
  ]
  const unavailable = hardUnavailableSignals.some(s => text.includes(s))
  if (unavailable) {
    throw new Error(`${label}: hard unavailable returned before exhaustion/recovery`)
  }
}

async function run() {
  assertRuntimeConfigInSource()

  const text = await ask("محاضرات الشيخ زمان الحسناوي")
  assertNoImmediateUnavailable(text, "runtime_takeover")

  console.log("PASS: PR7 runtime hardening smoke")
}

run().catch(err => {
  console.error("FAIL:", err.message)
  process.exit(1)
})
