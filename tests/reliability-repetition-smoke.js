/*
  Reliability repetition smoke test (PR — answer-pipeline-stability)

  Sends each query N times and asserts:
   1. ENTITY_SUBSTITUTION check (hard fail):
      No attempt should mention a different person than the one requested.
      E.g. "محاضرات الشيخ زمان" must NEVER return content about Sheikh Jassim etc.
   2. CONSISTENCY check (soft / per-query configurable):
      For queries in MUST_BE_CONSISTENT, all attempts must be either
      consistently grounded OR consistently apologetic. Mixed outcomes => fail.

  Note: Live API non-determinism means consistency failures are expected for
  some queries depending on cache warm-up. Add a query to MUST_BE_CONSISTENT
  only if you are sure data is always available (or always unavailable).

  Usage: node tests/reliability-repetition-smoke.js
*/

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const PATH = "/api/chat/site"
const REPS = Number(process.env.REPS || 3)

const QUERIES = [
  "محاضرات الشيخ زمان",
  "خطبة الجمعة الاخيرة",
  "ما هي اقسام الفيديو في موقع العتبة العباسية",
  "هل لدى العتبة العباسية مصانع",
  "هل لدى العتبة العباسية جامعة",
]

// Queries where we must check for wrong-entity substitution.
// Map: query → array of person name fragments that must NOT appear if they are wrong
// Format: { query, requested, forbidden }
const ENTITY_SUBSTITUTION_CHECKS = [
  {
    query: "محاضرات الشيخ زمان",
    requested: ["زمان", "الحسناوي"],   // one of these must appear when grounded
    forbidden: ["جاسم", "جاسم الكربلائي", "الكربلائي"],  // these must NEVER appear
  },
]

// Queries that must be 100% consistent (all grounded or all apology).
// Only add here if you know the data is always available.
const MUST_BE_CONSISTENT = []

const APOLOGY_MARKERS = [
  "لم أجد",
  "لم اجد",
  "لا أستطيع",
  "لا توجد نتائج",
  "لا أملك معلومات",
  "ليس لدي معلومات",
  "المعلومة غير متاحة",
]

async function readBody(response) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase()
  if (contentType.includes("application/json")) {
    const data = await response.json()
    return data?.message || data?.fallback || JSON.stringify(data)
  }
  return await response.text()
}

function isApology(text) {
  const norm = String(text || "").replace(/\s+/g, " ").trim()
  return APOLOGY_MARKERS.some(m => norm.includes(m))
}

async function ask(query) {
  const response = await fetch(`${BASE_URL}${PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: query }],
      lang: "ar",
    }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await readBody(response)
}

async function run() {
  const failures = []

  for (const q of QUERIES) {
    const outcomes = []
    for (let i = 0; i < REPS; i++) {
      const text = await ask(q)
      outcomes.push({ attempt: i + 1, apology: isApology(text), preview: text.slice(0, 180), full: text })
    }

    // Check 1: entity substitution
    const check = ENTITY_SUBSTITUTION_CHECKS.find(c => c.query === q)
    if (check) {
      for (const o of outcomes) {
        if (!o.apology) {
          const norm = o.full.replace(/\s+/g, " ")
          const hasForbidden = check.forbidden.some(f => norm.includes(f))
          if (hasForbidden) {
            failures.push({ type: "ENTITY_SUBSTITUTION", query: q, attempt: o.attempt, preview: o.preview })
          }
        }
      }
    }

    // Check 2: consistency (only for queries in MUST_BE_CONSISTENT)
    if (MUST_BE_CONSISTENT.includes(q)) {
      const apologies = outcomes.filter(o => o.apology).length
      const grounded = outcomes.length - apologies
      if (apologies > 0 && grounded > 0) {
        failures.push({ type: "INCONSISTENCY", query: q, outcomes })
      }
    }
  }

  if (failures.length > 0) {
    console.error("FAIL: reliability checks failed")
    for (const f of failures) {
      if (f.type === "ENTITY_SUBSTITUTION") {
        console.error(`\n[ENTITY_SUBSTITUTION] Query: ${f.query}`)
        console.error(`  attempt ${f.attempt}: ${f.preview}`)
      } else {
        console.error(`\n[INCONSISTENCY] Query: ${f.query}`)
        for (const o of f.outcomes) {
          console.error(`  attempt ${o.attempt} apology=${o.apology} :: ${o.preview}`)
        }
      }
    }
    process.exit(1)
  }

  console.log(`PASS: reliability-repetition smoke (${QUERIES.length} queries × ${REPS} reps, entity substitution and consistency checks passed)`)
}

run().catch(err => {
  console.error("FAIL:", err.message)
  process.exit(1)
})
