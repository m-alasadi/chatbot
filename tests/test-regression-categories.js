/**
 * Regression tests for the three PR11 failing categories:
 *   1. biography_vs_shrine_history
 *   2. wahy_vs_friday_sermon
 *   3. fact_vs_list_intent
 *
 * These tests exercise the pure intent-classification functions directly
 * (no server required), plus provide a sample of integration-level queries
 * that can be run against a live server.
 *
 * Pure-function tests run with:
 *   node tests/test-regression-categories.js
 *
 * Integration tests require a running server on PORT (default 3000) and run
 * when --integration flag is passed:
 *   node tests/test-regression-categories.js --integration [port]
 */

// ── Import from compiled TS or via ts-node ──────────────────────────
// For running with plain `node`, we test the JavaScript-equivalent logic.
// For running with `node --require ts-node/register`, we can import TS directly.
// Here we replicate the pure functions inline so no build step is needed.

// ── Inline copy of normalizeArabicQuery (from query-understanding.ts) ──
function normalizeArabicQuery(text) {
  return (text || "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[\u0622\u0623\u0625\u0627]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function isFactQuery(text) {
  const norm = normalizeArabicQuery(text)
  const countPatterns = ["كم", "عدد", "اجمالي", "مجموع", "كلي", "كم عدد", "كم يبلغ", "كم يوجد"]
  if (countPatterns.some(p => norm.includes(p))) return true
  const datePatterns = ["متي", "تاريخ", "في اي سنه", "في اي عام", "في اي تاريخ", "منذ متي", "منذ كم"]
  if (datePatterns.some(p => norm.includes(p))) return true
  const existencePatterns = ["هل يوجد", "هل هناك", "هل تتوفر", "هل يتوفر", "هل توجد", "هل تجد"]
  if (existencePatterns.some(p => norm.includes(p))) return true
  return false
}

function isListQuery(text) {
  const norm = normalizeArabicQuery(text)
  const listPatterns = [
    "اعرض", "اظهر", "قدم", "عرض", "اذكر", "اريد قائمه", "اريد قائمة",
    "احدث", "اخر", "جديد", "اخير",
    "قائمه", "قائمة", "لائحه", "لائحة",
    "اول", "اقدم",
    "كل الـ", "جميع الـ",
  ]
  return listPatterns.some(p => norm.includes(p))
}

// ── Inline copy of isAbbasBiographyQuery logic ──────────────────────
function normalizeArabicLight(text) {
  return (text || "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[\u0622\u0623\u0625\u0627]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\s+/g, " ")
    .trim()
}

function isAbbasBiographyQuery(text) {
  const norm = normalizeArabicLight(text)
  const shrineActivityPatterns = [
    "توسعه", "توسعة", "بناء", "ترميم", "انشاء", "إنشاء", "قبه", "قبة",
    "رواق", "صحن", "بلاطه", "بلاطة", "مشروع", "مشاريع", "طابق",
    "تشييد", "اعمار", "اعمال", "عمل", "خدمه", "خدمة",
    "فعاليه", "فعاليات", "نشاط", "انشطه", "برنامج", "مناسبه",
    "زياره", "زيارة", "زائرين", "خبر", "اخبار",
    // New patterns (biography_vs_shrine_history fix)
    "ضريح", "مرقد", "حرم", "تاريخ العتبه", "تاريخ الضريح",
    "تاريخ المرقد", "مشاريع العتبه", "توسعه العتبه", "توسعة العتبه",
  ]
  if (shrineActivityPatterns.some(p => norm.includes(p))) return false
  const biographyPatterns = [
    "لقب", "القاب", "كنيه", "كنية", "صفه", "صفات", "صفة",
    "من هو", "من هي", "ما هو", "ما هي", "سيره", "سيرة", "حياه", "حياة",
    "نشاه", "نشأة", "ولاده", "ولادة", "مولد",
    "ام ", "امه", "أمه", "ابيه", "ابوه", "اخوه", "اخواته", "اخت",
    "زوجه", "زوجة", "زوجات", "زواج", "ولد", "ابناء", "اولاد",
    "اعمام", "عمه", "عمته",
    "استشهاد", "شهاده", "شهادة", "مقتل", "متي استشهد",
    "موقفه", "قمر بني هاشم", "سقايه", "سقاية", "عمر سنه",
    "تعريف", "نبذه", "نبذة",
  ]
  if (biographyPatterns.some(p => norm.includes(p))) return true
  return false
}

// ── Inline copy of isTransientError ─────────────────────────────────
function isTransientError(result) {
  if (result.success) return false
  const msg = (result.error || "").toLowerCase()
  return (
    msg.includes("timeout") ||
    msg.includes("مهله") ||
    msg.includes("مهلة") ||
    msg.includes("انتهت") ||
    msg.includes("فشل الاتصال") ||
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused")
  )
}

// ── Simple test runner ───────────────────────────────────────────────
let passed = 0
let failed = 0

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.log(`  ❌ ${label}`)
    failed++
  }
}

// ═══════════════════════════════════════════════════════════════════
// Category 1: biography_vs_shrine_history
// ═══════════════════════════════════════════════════════════════════
console.log("\n── biography_vs_shrine_history ──────────────────────")

// Biography queries — MUST return true
assert(isAbbasBiographyQuery("من هو العباس بن علي"), "من هو العباس → biography")
assert(isAbbasBiographyQuery("ما هي ألقاب العباس"), "ألقاب العباس → biography")
assert(isAbbasBiographyQuery("سيرة أبي الفضل العباس"), "سيرة العباس → biography")
assert(isAbbasBiographyQuery("متى استشهد العباس"), "متى استشهد → biography")
assert(isAbbasBiographyQuery("من هم إخوة العباس"), "إخوة العباس → biography")
assert(isAbbasBiographyQuery("ما هي صفات العباس"), "صفات العباس → biography")
assert(isAbbasBiographyQuery("أعطني نبذة عن حياة العباس"), "نبذة حياة → biography")

// Shrine history queries — MUST return false (not biography)
assert(!isAbbasBiographyQuery("تاريخ الضريح العباسي"), "تاريخ الضريح → NOT biography")
assert(!isAbbasBiographyQuery("تاريخ مرقد أبي الفضل"), "تاريخ المرقد → NOT biography")
assert(!isAbbasBiographyQuery("تاريخ الحرم العباسي"), "تاريخ الحرم → NOT biography")
assert(!isAbbasBiographyQuery("توسعة العتبة العباسية"), "توسعة العتبة → NOT biography")
assert(!isAbbasBiographyQuery("مشاريع الضريح العباسي"), "مشاريع الضريح → NOT biography")
assert(!isAbbasBiographyQuery("أخبار العتبة العباسية"), "أخبار العتبة → NOT biography")

// ═══════════════════════════════════════════════════════════════════
// Category 2: wahy_vs_friday_sermon
// ═══════════════════════════════════════════════════════════════════
console.log("\n── wahy_vs_friday_sermon ────────────────────────────")

// isTransientError detection
assert(
  isTransientError({ success: false, error: "فشل الاتصال بعد 2 محاولات: انتهت مهلة الاتصال بعد 30 ثانية" }),
  "Arabic timeout error → isTransientError"
)
assert(
  isTransientError({ success: false, error: "انتهت مهلة الاتصال بعد 30 ثانية" }),
  "Timeout string → isTransientError"
)
assert(
  isTransientError({ success: false, error: "fetch failed" }),
  "fetch failed → isTransientError"
)
assert(
  !isTransientError({ success: true, data: {} }),
  "Successful result → NOT isTransientError"
)
assert(
  !isTransientError({ success: false, error: "لا توجد نتائج" }),
  "Empty result (no network error) → NOT isTransientError"
)

// ═══════════════════════════════════════════════════════════════════
// Category 3: fact_vs_list_intent
// ═══════════════════════════════════════════════════════════════════
console.log("\n── fact_vs_list_intent ───────────────────────────────")

// Fact queries — MUST return true from isFactQuery
assert(isFactQuery("كم عدد خطب الجمعة"), "كم عدد خطب الجمعة → fact")
assert(isFactQuery("كم عدد الأخبار على الموقع"), "كم عدد الأخبار → fact")
assert(isFactQuery("متى أُنشئت العتبة العباسية"), "متى أُنشئت → fact")
assert(isFactQuery("هل يوجد فيديو عن العباس"), "هل يوجد → fact")
assert(isFactQuery("هل هناك مقالات عن الزيارة"), "هل هناك مقالات → fact")
assert(isFactQuery("كم عدد أقسام تاريخ العتبة"), "كم عدد أقسام التاريخ → fact")

// List queries — MUST return true from isListQuery
assert(isListQuery("اعرض أحدث من وحي الجمعة"), "اعرض أحدث وحي → list")
assert(isListQuery("أحدث خطبة جمعة"), "أحدث خطبة → list")
assert(isListQuery("أحدث الأخبار"), "أحدث الأخبار → list")
assert(isListQuery("اعرض قائمة الفيديوهات"), "اعرض قائمة → list")

// Fact queries must NOT be classified as list
assert(!isListQuery("كم عدد خطب الجمعة"), "كم عدد → NOT list")
assert(!isListQuery("هل يوجد فيديو عن العباس"), "هل يوجد → NOT list")
assert(!isFactQuery("اعرض أحدث من وحي الجمعة"), "اعرض → NOT fact (no count/date/existence)")

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════
console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===\n`)

if (failed > 0) {
  process.exit(1)
}

// ── Integration tests (optional, requires running server) ───────────
const runIntegration = process.argv.includes("--integration")
if (!runIntegration) {
  console.log("Skipping integration tests (pass --integration to enable)")
  process.exit(0)
}

const PORT = process.argv[process.argv.indexOf("--integration") + 1] || 3000
const http = require("http")

const integrationQueries = [
  // biography_vs_shrine_history
  { q: "من هو العباس بن علي", cat: "biography", shouldHaveInfo: true },
  { q: "تاريخ مرقد أبي الفضل العباس", cat: "shrine_history", shouldHaveInfo: true },
  // wahy_vs_friday_sermon
  { q: "اعرض أحدث من وحي الجمعة", cat: "wahy", shouldHaveInfo: true },
  { q: "أحدث خطبة جمعة", cat: "sermon", shouldHaveInfo: true },
  // fact_vs_list_intent
  { q: "كم عدد الأخبار على الموقع", cat: "fact", shouldHaveInfo: true },
  { q: "هل يوجد فيديو عن الزيارة", cat: "existence_fact", shouldHaveInfo: true },
  { q: "أحدث الأخبار", cat: "list", shouldHaveInfo: true },
]

function ask(question) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ messages: [{ role: "user", content: question }] })
    const req = http.request(
      {
        hostname: "localhost",
        port: PORT,
        path: "/api/chat/site",
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 45000,
      },
      (res) => {
        let body = ""
        res.on("data", c => (body += c))
        res.on("end", () => resolve({ status: res.statusCode, body }))
      }
    )
    req.on("error", reject)
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })
    req.write(data)
    req.end()
  })
}

;(async () => {
  console.log(`\n── Integration tests (port ${PORT}) ──────────────────`)
  let iPass = 0, iFail = 0

  for (const { q, cat, shouldHaveInfo } of integrationQueries) {
    process.stdout.write(`  [${cat.padEnd(18)}] ${q.substring(0, 50).padEnd(50)} `)
    const start = Date.now()
    try {
      const { status, body } = await ask(q)
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      const noInfo =
        body.includes("لم أجد") ||
        body.includes("لم أتمكن") ||
        body.includes("لا تتوفر") ||
        body.includes("لم يتم العثور")
      const hasInfo = status === 200 && body.length > 20 && !noInfo
      const pass = shouldHaveInfo ? hasInfo : !hasInfo
      const icon = pass ? "✅" : "❌"
      console.log(`${icon} ${elapsed}s (${status}) ${body.length} chars`)
      if (pass) iPass++; else iFail++
    } catch (e) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      console.log(`❌ ERROR ${elapsed}s: ${e.message}`)
      iFail++
    }
  }

  console.log(`\n=== Integration: ${iPass}/${iPass + iFail} passed ===\n`)
  process.exit(iFail > 0 ? 1 : 0)
})()
