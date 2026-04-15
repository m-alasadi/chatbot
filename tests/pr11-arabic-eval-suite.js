/*
  PR11 Arabic Eval Suite + Acceptance Gates
  Usage: node tests/pr11-arabic-eval-suite.js
*/

const fs = require("node:fs")
const path = require("node:path")

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const PATH = "/api/chat/site"
const RESULTS_DIR = path.join(__dirname, "eval-results")
const REQUEST_TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS || 90000)

const UNAVAILABLE_SIGNALS = [
  "لم اتمكن من العثور",
  "لم اجد نتائج",
  "المعلومة غير متاحة حالياً"
]

const CATEGORY_THRESHOLDS = {
  repeated_question_stability: { minPassRate: 1.0 },
  news_vs_video_disambiguation: { minPassRate: 1.0 },
  false_unavailable_regression: { minPassRate: 0.85 },
  fact_vs_list_intent: { minPassRate: 1.0 },
  biography_vs_shrine_history: { minPassRate: 1.0 },
  wahy_vs_friday_sermon: { minPassRate: 1.0 },
  project_vs_generic_content: { minPassRate: 1.0 },
  arabic_entity_variation_normalization: { minPassRate: 0.67 },
  person_attribute_facts: { minPassRate: 1.0 },
  office_holder_facts: { minPassRate: 1.0 },
  named_event_lookup: { minPassRate: 1.0 },
  singular_project_queries: { minPassRate: 1.0 },
  follow_up_grounding: { minPassRate: 1.0 }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function normalizeArabic(text) {
  return String(text || "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[\u0622\u0623\u0625\u0627]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function tokenize(text) {
  return normalizeArabic(text)
    .split(" ")
    .filter(Boolean)
}

function jaccardSimilarity(a, b) {
  const setA = new Set(tokenize(a))
  const setB = new Set(tokenize(b))
  const union = new Set([...setA, ...setB])
  if (union.size === 0) return 1
  let intersection = 0
  for (const t of setA) {
    if (setB.has(t)) intersection++
  }
  return intersection / union.size
}

function hasUnavailable(text) {
  const norm = normalizeArabic(text)
  return UNAVAILABLE_SIGNALS.some(s => norm.includes(normalizeArabic(s)))
}

function hasAny(text, words) {
  const norm = normalizeArabic(text)
  return words.some(w => norm.includes(normalizeArabic(w)))
}

function isListLike(text) {
  const raw = String(text || "")
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const bulletLike = lines.filter(l => /^[-*•\d]+[).:\-\s]/.test(l)).length
  return bulletLike >= 2 || lines.length >= 4
}

function isFactLike(text) {
  const raw = String(text || "")
  if (isListLike(raw)) return false
  return raw.length >= 40
}

async function readBody(response) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase()
  if (contentType.includes("application/json")) {
    const data = await response.json()
    return data?.message || data?.fallback || JSON.stringify(data)
  }
  return await response.text()
}

async function ask(query) {
  return await askWithMessages([{ role: "user", content: query }])
}

async function askWithMessages(messages) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response
  try {
    response = await fetch(`${BASE_URL}${PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        use_tools: true,
        temperature: 0.5,
        max_tokens: 1200
      }),
      signal: controller.signal
    })
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`request timeout after ${REQUEST_TIMEOUT_MS}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const body = await readBody(response)
  if (!String(body || "").trim()) {
    throw new Error("empty response body")
  }
  return String(body)
}

function pickFirstUsefulToken(text) {
  const stop = new Set(["وجدت", "لك", "نتائج", "من", "الفيديوهات", "الأخبار", "المصدر", "هل", "تريد", "تفاصيل", "أكثر"])
  const tokens = tokenize(text).filter(t => t.length >= 3 && !stop.has(t))
  return tokens[0] || ""
}

function extractFirstListedItemTitle(text) {
  const raw = String(text || "")
  const m = raw.match(/(?:^|\n)\s*1\.\s*(.+)/)
  return m ? m[1].trim() : ""
}

function summarizeCategory(categoryId, mode, checks, meta = {}) {
  const passedChecks = checks.filter(c => c.passed).length
  const totalChecks = checks.length
  const passRate = totalChecks === 0 ? 1 : passedChecks / totalChecks
  const threshold = CATEGORY_THRESHOLDS[categoryId]
  const categoryPassed = passRate >= threshold.minPassRate

  return {
    id: categoryId,
    mode,
    threshold,
    pass_rate: Number(passRate.toFixed(3)),
    passed_checks: passedChecks,
    total_checks: totalChecks,
    passed: categoryPassed,
    meta,
    checks
  }
}

async function evalRepeatedQuestionStability() {
  const query = "اعرض أحدث فيديوهات العتبة"
  const responses = [await ask(query), await ask(query), await ask(query)]

  const sim12 = jaccardSimilarity(responses[0], responses[1])
  const sim23 = jaccardSimilarity(responses[1], responses[2])
  const sim13 = jaccardSimilarity(responses[0], responses[2])
  const avgSim = (sim12 + sim23 + sim13) / 3

  const checks = [
    { id: "stability_no_unavailable_1", passed: !hasUnavailable(responses[0]), value: null },
    { id: "stability_no_unavailable_2", passed: !hasUnavailable(responses[1]), value: null },
    { id: "stability_no_unavailable_3", passed: !hasUnavailable(responses[2]), value: null },
    { id: "stability_similarity", passed: avgSim >= 0.45, value: Number(avgSim.toFixed(3)) }
  ]

  return summarizeCategory("repeated_question_stability", "runtime", checks, {
    query,
    similarities: {
      sim12: Number(sim12.toFixed(3)),
      sim23: Number(sim23.toFixed(3)),
      sim13: Number(sim13.toFixed(3))
    }
  })
}

async function evalNewsVsVideoDisambiguation() {
  const newsQuery = "اعرض أحدث أخبار العتبة"
  const videoQuery = "اعرض أحدث فيديوهات العتبة"

  const newsResponse = await ask(newsQuery)
  const videoResponse = await ask(videoQuery)

  const checks = [
    {
      id: "news_response_news_signal",
      passed: hasAny(newsResponse, ["خبر", "اخبار", "مقال", "الأخبار"]),
      value: null
    },
    {
      id: "video_response_video_signal",
      passed: hasAny(videoResponse, ["فيديو", "محاض", "مرئي", "الفيديو"]),
      value: null
    },
    {
      id: "video_not_unavailable",
      passed: !hasUnavailable(videoResponse),
      value: null
    }
  ]

  return summarizeCategory("news_vs_video_disambiguation", "runtime", checks, {
    queries: [newsQuery, videoQuery]
  })
}

async function evalFalseUnavailableRegression() {
  const queries = [
    "اعرض أحدث فيديوهات العتبة",
    "ما هي مشاريع توسعة العتبة",
    "اعرض أحدث من وحي الجمعة",
    "اعرض أحدث خطب الجمعة",
    "ما هي أبرز أخبار العتبة اليوم",
    "من هو أبو الفضل العباس"
  ]

  const checks = []
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i]
    const response = await ask(q)
    checks.push({
      id: `no_unavailable_${i + 1}`,
      passed: !hasUnavailable(response),
      value: q
    })
  }

  return summarizeCategory("false_unavailable_regression", "runtime", checks, {
    sample_size: queries.length
  })
}

async function evalFactVsListIntent() {
  const factQuery = "من هو أبو الفضل العباس"
  const listQuery = "اعرض أحدث الفيديوهات"

  const factResponse = await ask(factQuery)
  const listResponse = await ask(listQuery)

  const checks = [
    {
      id: "fact_not_list_like",
      passed: isFactLike(factResponse),
      value: null
    },
    {
      id: "list_has_listing_shape_or_signal",
      passed: isListLike(listResponse) || hasAny(listResponse, ["فيديو", "1", "2", "-", "•"]),
      value: null
    }
  ]

  return summarizeCategory("fact_vs_list_intent", "runtime", checks, {
    queries: [factQuery, listQuery]
  })
}

async function evalBiographyVsShrineHistory() {
  const bioQuery = "ما هي ألقاب أبي الفضل العباس"
  const shrineQuery = "ما هي مشاريع توسعة العتبة"

  const bioResponse = await ask(bioQuery)
  const shrineResponse = await ask(shrineQuery)

  const checks = [
    {
      id: "biography_has_person_signal",
      passed: hasAny(bioResponse, ["العباس", "ابي الفضل", "أبي الفضل", "لقب", "القاب"]),
      value: null
    },
    {
      id: "shrine_history_has_project_signal",
      passed: hasAny(shrineResponse, ["مشروع", "مشاريع", "توسعة", "العتبة", "صحن", "بناء"]),
      value: null
    }
  ]

  return summarizeCategory("biography_vs_shrine_history", "runtime", checks, {
    queries: [bioQuery, shrineQuery]
  })
}

async function evalWahyVsFridaySermon() {
  const wahyQuery = "اعرض أحدث من وحي الجمعة"
  const sermonQuery = "اعرض أحدث خطب الجمعة"

  const wahyResponse = await ask(wahyQuery)
  const sermonResponse = await ask(sermonQuery)

  const checks = [
    {
      id: "wahy_response_signal",
      passed: hasAny(wahyResponse, ["وحي", "الجمعة", "من وحي"]),
      value: null
    },
    {
      id: "sermon_response_signal",
      passed: hasAny(sermonResponse, ["خطب", "خطبة", "خطيب", "منبر"]),
      value: null
    }
  ]

  return summarizeCategory("wahy_vs_friday_sermon", "runtime", checks, {
    queries: [wahyQuery, sermonQuery]
  })
}

async function evalProjectVsGenericContent() {
  const projectQuery = "ما هي مشاريع توسعة العتبة"
  const genericQuery = "ما أبرز أخبار العتبة اليوم"

  const projectResponse = await ask(projectQuery)
  const genericResponse = await ask(genericQuery)

  const checks = [
    {
      id: "project_response_has_project_signal",
      passed: hasAny(projectResponse, ["مشروع", "مشاريع", "توسعة", "إعمار", "بناء"]),
      value: null
    },
    {
      id: "generic_response_has_generic_content_signal",
      passed: hasAny(genericResponse, ["خبر", "اخبار", "الأخبار", "اليوم"]),
      value: null
    }
  ]

  return summarizeCategory("project_vs_generic_content", "runtime", checks, {
    queries: [projectQuery, genericQuery]
  })
}

async function evalArabicEntityVariationNormalization() {
  const variations = [
    "اعرض أحدث فيديوهات العتبة",
    "اعرض احدث فديوهات العتبة",
    "هات آخر فيديوهات العتبة"
  ]

  const responses = []
  for (const q of variations) {
    responses.push(await ask(q))
  }

  const sim12 = jaccardSimilarity(responses[0], responses[1])
  const sim13 = jaccardSimilarity(responses[0], responses[2])

  const checks = [
    {
      id: "variation_no_unavailable_1",
      passed: !hasUnavailable(responses[0]),
      value: variations[0]
    },
    {
      id: "variation_no_unavailable_2",
      passed: !hasUnavailable(responses[1]),
      value: variations[1]
    },
    {
      id: "variation_no_unavailable_3",
      passed: !hasUnavailable(responses[2]),
      value: variations[2]
    },
    {
      id: "variation_similarity_1_2",
      passed: sim12 >= 0.3,
      value: Number(sim12.toFixed(3))
    },
    {
      id: "variation_similarity_1_3",
      passed: sim13 >= 0.2,
      value: Number(sim13.toFixed(3))
    }
  ]

  return summarizeCategory("arabic_entity_variation_normalization", "runtime", checks, {
    similarities: {
      sim12: Number(sim12.toFixed(3)),
      sim13: Number(sim13.toFixed(3))
    }
  })
}

async function evalPersonAttributeFacts() {
  const query = "عدد لي زوجات العباس"
  const response = await ask(query)

  const checks = [
    {
      id: "person_attribute_not_unavailable",
      passed: !hasUnavailable(response),
      value: query
    },
    {
      id: "person_attribute_has_relevant_signal",
      passed: hasAny(response, ["زوج", "زوجة", "زوجات", "العباس", "أم البنين", "لبابة"]),
      value: null
    }
  ]

  return summarizeCategory("person_attribute_facts", "runtime", checks, { query })
}

async function evalOfficeHolderFacts() {
  const query = "ما اسم المتولي الشرعي للعتبة العباسية"
  const response = await ask(query)

  const checks = [
    {
      id: "office_holder_not_unavailable",
      passed: !hasUnavailable(response),
      value: query
    },
    {
      id: "office_holder_has_name_signal",
      passed: hasAny(response, ["السيد", "أحمد", "الصافي", "المتولي الشرعي"]),
      value: null
    }
  ]

  return summarizeCategory("office_holder_facts", "runtime", checks, { query })
}

async function evalNamedEventLookup() {
  const query = "أين يقام نداء العقيدة"
  const response = await ask(query)

  const checks = [
    {
      id: "named_event_not_unavailable",
      passed: !hasUnavailable(response),
      value: query
    },
    {
      id: "named_event_has_event_or_location_signal",
      passed: hasAny(response, ["نداء العقيدة", "يقام", "في", "كربلاء", "الصحن", "العتبة"]),
      value: null
    }
  ]

  return summarizeCategory("named_event_lookup", "runtime", checks, { query })
}

async function evalSingularProjectQueries() {
  const query = "هل للعتبة العباسية مشروع دجاج"
  const response = await ask(query)

  const checks = [
    {
      id: "singular_project_not_unavailable",
      passed: !hasUnavailable(response),
      value: query
    },
    {
      id: "singular_project_mentions_query_domain",
      passed: hasAny(response, ["دجاج", "مشروع", "العتبة"]),
      value: null
    }
  ]

  return summarizeCategory("singular_project_queries", "runtime", checks, { query })
}

async function evalFollowUpGrounding() {
  const firstQuery = "اعرض أحدث فيديوهات العتبة"
  const firstResponse = await ask(firstQuery)

  const followUpQuery = "لخص لي أول نتيجة ذكرتها"
  const followUpResponse = await askWithMessages([
    { role: "user", content: firstQuery },
    { role: "assistant", content: firstResponse },
    { role: "user", content: followUpQuery }
  ])

  const firstItemTitle = extractFirstListedItemTitle(firstResponse)
  const anchorToken = pickFirstUsefulToken(firstItemTitle || firstResponse)

  const checks = [
    {
      id: "follow_up_not_unavailable",
      passed: !hasUnavailable(followUpResponse),
      value: null
    },
    {
      id: "follow_up_has_grounding_overlap",
      passed: anchorToken
        ? normalizeArabic(followUpResponse).includes(normalizeArabic(anchorToken))
        : jaccardSimilarity(firstResponse, followUpResponse) >= 0.1,
      value: anchorToken || Number(jaccardSimilarity(firstResponse, followUpResponse).toFixed(3))
    }
  ]

  return summarizeCategory("follow_up_grounding", "runtime", checks, {
    queries: [firstQuery, followUpQuery]
  })
}

function formatTextReport(report) {
  const lines = []
  lines.push("PR11 Arabic Eval Suite Report")
  lines.push(`Run ID: ${report.run_id}`)
  lines.push(`Base URL: ${report.base_url}`)
  lines.push(`Timestamp: ${report.timestamp}`)
  lines.push("")
  lines.push(`Overall: ${report.overall_passed ? "PASS" : "FAIL"} (${report.passed_categories}/${report.total_categories} categories passed)`)
  lines.push("")
  lines.push("Category Summary:")

  for (const c of report.categories) {
    lines.push(
      `- ${c.id} [${c.mode}] => ${c.passed ? "PASS" : "FAIL"} | pass_rate=${c.pass_rate} | threshold>=${c.threshold.minPassRate}`
    )
  }

  lines.push("")
  lines.push("Detailed Checks:")
  for (const c of report.categories) {
    lines.push(`* ${c.id}`)
    for (const check of c.checks) {
      lines.push(`  - ${check.id}: ${check.passed ? "PASS" : "FAIL"}${check.value !== null ? ` | ${check.value}` : ""}`)
    }
  }

  return lines.join("\n")
}

async function run() {
  ensureDir(RESULTS_DIR)

  const startedAt = new Date()
  const runId = `pr11_${startedAt.toISOString().replace(/[.:]/g, "-")}`

  const evaluators = [
    { id: "repeated_question_stability", fn: evalRepeatedQuestionStability },
    { id: "news_vs_video_disambiguation", fn: evalNewsVsVideoDisambiguation },
    { id: "false_unavailable_regression", fn: evalFalseUnavailableRegression },
    { id: "fact_vs_list_intent", fn: evalFactVsListIntent },
    { id: "biography_vs_shrine_history", fn: evalBiographyVsShrineHistory },
    { id: "wahy_vs_friday_sermon", fn: evalWahyVsFridaySermon },
    { id: "project_vs_generic_content", fn: evalProjectVsGenericContent },
    { id: "arabic_entity_variation_normalization", fn: evalArabicEntityVariationNormalization },
    { id: "person_attribute_facts", fn: evalPersonAttributeFacts },
    { id: "office_holder_facts", fn: evalOfficeHolderFacts },
    { id: "named_event_lookup", fn: evalNamedEventLookup },
    { id: "singular_project_queries", fn: evalSingularProjectQueries },
    { id: "follow_up_grounding", fn: evalFollowUpGrounding }
  ]

  const categories = []
  for (const evaluator of evaluators) {
    try {
      categories.push(await evaluator.fn())
    } catch (error) {
      categories.push(
        summarizeCategory(
          evaluator.id,
          "runtime",
          [{ id: "category_runtime_error", passed: false, value: String(error.message || error) }],
          { error: String(error.message || error) }
        )
      )
    }
  }

  const passedCategories = categories.filter(c => c.passed).length
  const overallPassed = passedCategories === categories.length

  const report = {
    run_id: runId,
    timestamp: startedAt.toISOString(),
    base_url: BASE_URL,
    overall_passed: overallPassed,
    passed_categories: passedCategories,
    total_categories: categories.length,
    categories
  }

  const jsonPath = path.join(RESULTS_DIR, `${runId}.json`)
  const txtPath = path.join(RESULTS_DIR, `${runId}.txt`)
  const latestJsonPath = path.join(RESULTS_DIR, "latest.json")
  const latestTxtPath = path.join(RESULTS_DIR, "latest.txt")

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8")
  fs.writeFileSync(txtPath, formatTextReport(report), "utf8")
  fs.writeFileSync(latestJsonPath, JSON.stringify(report, null, 2), "utf8")
  fs.writeFileSync(latestTxtPath, formatTextReport(report), "utf8")

  console.log(formatTextReport(report))
  console.log("")
  console.log(`JSON: ${jsonPath}`)
  console.log(`TEXT: ${txtPath}`)

  process.exit(overallPassed ? 0 : 1)
}

run().catch(err => {
  console.error("PR11 eval fatal error:", err.message)
  process.exit(1)
})
