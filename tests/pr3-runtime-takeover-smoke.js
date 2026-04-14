/*
  PR3 runtime takeover smoke test
  Usage: node tests/pr3-runtime-takeover-smoke.js
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

function assertNoImmediateUnavailable(text, label) {
  const hardUnavailableSignals = [
    "لم اتمكن من العثور",
    "لم اجد نتائج",
    "المعلومة غير متاحة حالياً"
  ]
  const unavailable = hardUnavailableSignals.some(s => text.includes(s))
  if (unavailable) {
    throw new Error(`${label}: hard unavailable returned before recovery`)
  }
}

async function run() {
  const videoIntent = await ask("محاضرات الشيخ زمان الحسناوي")
  assertNoImmediateUnavailable(videoIntent, "video_intent")

  const strongNewsBias =
    videoIntent.includes("الأخبار") &&
    !videoIntent.includes("فيديو") &&
    !videoIntent.includes("محاض")
  if (strongNewsBias) {
    throw new Error("video_intent: news-biased response detected on first-pass scenario")
  }

  // utility deterministic flow should still work
  const latestVideos = await ask("اعرض احدث الفيديوهات")
  assertNoImmediateUnavailable(latestVideos, "latest_videos_utility")

  console.log("PASS: PR3 runtime takeover smoke")
}

run().catch(err => {
  console.error("FAIL:", err.message)
  process.exit(1)
})
