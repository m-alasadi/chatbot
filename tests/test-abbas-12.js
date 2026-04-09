/**
 * Abbas 12-question validation test
 * Tests Abbas pipeline end-to-end for biography quality.
 * 
 * Usage: node tests/test-abbas-12.js [port]
 */

const PORT = process.argv[2] || "3023"
const BASE = `http://localhost:${PORT}/api/chat/site`

const questions = [
  { q: "من هو العباس بن علي", expect: ["عباس", "علي"] },
  { q: "أعطني نبذة عن حياة أبي الفضل العباس", expect: ["عباس"] },
  { q: "ما هي ألقاب العباس", expect: ["عباس"] },
  { q: "ما هي صفات العباس", expect: ["صفات", "عباس"] },
  { q: "من هم إخوة العباس", expect: ["عباس"] },
  { q: "من هن أخوات العباس", expect: ["عباس"] },
  { q: "ما الذي يذكره الموقع عن زواج العباس", expect: ["عباس"] },
  { q: "ماذا يذكر الموقع عن أبي الفضل العباس", expect: ["عباس"] },
  { q: "ما الذي يذكره الموقع عن نشأة العباس", expect: ["نشأ", "عباس"] },
  { q: "متى استشهد العباس", expect: ["عباس"] },
  { q: "في أي عمر استشهد العباس", expect: ["عباس"] },
  { q: "أين دفن أبو الفضل العباس", expect: ["عباس"] },
]

async function ask(question) {
  const body = JSON.stringify({
    messages: [{ role: "user", content: question }],
  })

  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })

  if (!res.ok) {
    const text = await res.text()
    if (text.includes("insufficient_quota") || text.includes("429")) {
      return { answer: null, rateLimited: true }
    }
    return { answer: null, error: `HTTP ${res.status}` }
  }

  // Response could be plain text or SSE
  const text = await res.text()
  const contentType = res.headers.get("content-type") || ""

  let answer = ""
  if (contentType.includes("text/event-stream")) {
    // SSE parsing
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue
      try {
        const json = JSON.parse(line.slice(6))
        const delta = json.choices?.[0]?.delta?.content
        if (delta) answer += delta
      } catch {}
    }
  } else {
    // Plain text response
    answer = text.trim()
  }

  return { answer, rateLimited: false }
}

function checkBadPattern(answer) {
  // Check for the bad pattern: "لم أتمكن من العثور" followed by actual answer
  const badPhrases = [
    "لم أتمكن من العثور",
    "لم أجد معلومات دقيقة",
    "لم أعثر على",
  ]
  for (const phrase of badPhrases) {
    if (answer.includes(phrase) && answer.length > phrase.length + 100) {
      return phrase // returned answer with apology + actual content = BAD
    }
  }
  return null
}

async function main() {
  console.log(`\nAbbas 12-Question Test — port ${PORT}\n${"=".repeat(50)}`)
  let passed = 0, failed = 0, rateLimited = 0

  for (let i = 0; i < questions.length; i++) {
    const { q, expect } = questions[i]
    process.stdout.write(`Q${i + 1}: ${q.substring(0, 50)}... `)

    try {
      const { answer, rateLimited: rl, error } = await ask(q)

      if (rl) {
        console.log("⚠️  RATE-LIMITED (429)")
        rateLimited++
        continue
      }

      if (error || !answer) {
        console.log(`❌ ${error || "Empty response"}`)
        failed++
        continue
      }

      // Check for bad apology pattern
      const badPattern = checkBadPattern(answer)
      if (badPattern) {
        console.log(`⚠️  BAD PATTERN: "${badPattern}" + answer`)
        failed++
        continue
      }

      // Check that all expect terms appear somewhere in answer
      const missing = expect.filter(t => !answer.includes(t))
      if (missing.length === 0) {
        console.log(`✅ (${answer.length} chars)`)
        passed++
      } else {
        console.log(`❌ Missing: ${missing.join(", ")} (${answer.length} chars)`)
        failed++
      }
    } catch (e) {
      console.log(`❌ Error: ${e.message}`)
      failed++
    }
  }

  console.log(`\n${"=".repeat(50)}`)
  console.log(`Results: ${passed}/${passed + failed} passed, ${rateLimited} rate-limited`)
  if (failed === 0 && rateLimited === 0) console.log("🎉 ALL PASSED!")
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(console.error)
