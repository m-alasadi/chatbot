/**
 * Smoke test: 20 questions from easy to hard
 * Run: node tests/smoke-20.js
 */

const questions = [
  // === سهل (1-5): أسئلة عامة بسيطة ===
  { id: 1,  q: "مرحبا", expect: "تحية", tools: false },
  { id: 2,  q: "ما هو موقع الكفيل؟", expect: "تعريف بالموقع", tools: false },
  { id: 3,  q: "ما هي خدمات العتبة العباسية؟", expect: "ذكر خدمات", tools: false },
  { id: 4,  q: "أريد أحدث الأخبار", expect: "قائمة أخبار", tools: true },
  { id: 5,  q: "أحدث الفيديوهات", expect: "قائمة فيديوهات", tools: true },

  // === متوسط (6-10): أسئلة تحتاج أدوات محددة ===
  { id: 6,  q: "كم عدد الأخبار الكلي في الموقع؟", expect: "رقم كبير 30000+", tools: true },
  { id: 7,  q: "كم عدد الفيديوهات؟", expect: "رقم 18000+", tools: true },
  { id: 8,  q: "ما هي أقسام الفيديوهات؟", expect: "قائمة أقسام", tools: true },
  { id: 9,  q: "ابحث عن أخبار ترميم المرقد", expect: "نتائج بحث", tools: true },
  { id: 10, q: "ابحث عن محاضرة دينية", expect: "نتائج بحث", tools: true },

  // === متقدم (11-15): أسئلة تحتاج pagination وmetadata ===
  { id: 11, q: "ما هو أول خبر نُشر في الموقع؟", expect: "خبر قديم 2008", tools: true },
  { id: 12, q: "كم صفحة أخبار موجودة؟", expect: "رقم صفحات كبير", tools: true },
  { id: 13, q: "أعطني أقدم 5 أخبار في الموقع", expect: "أخبار قديمة", tools: true },
  { id: 14, q: "ما هي إحصائيات الموقع؟", expect: "أرقام إحصائية", tools: true },
  { id: 15, q: "أعطني أخبار الصفحة رقم 100", expect: "أخبار من صفحة 100", tools: true },

  // === صعب (16-20): أسئلة معقدة ومركبة ===
  { id: 16, q: "ابحث عن تاريخ أبي الفضل العباس", expect: "معلومات تاريخية", tools: true },
  { id: 17, q: "ما الفرق بين عدد المقالات والفيديوهات؟", expect: "مقارنة أرقام", tools: true },
  { id: 18, q: "أعطني آخر 10 أخبار عن المجمع العلمي", expect: "أخبار مجمع علمي", tools: true },
  { id: 19, q: "هل يوجد أخبار عن القرآن الكريم؟", expect: "نتائج بحث قرآن", tools: true },
  { id: 20, q: "أعطني ملخص عن نشاطات العتبة في الأسبوع الأخير", expect: "ملخص نشاطات", tools: true },
];

const BASE_URL = "http://localhost:3000/api/chat/site";

async function testQuestion(item) {
  const body = JSON.stringify({
    messages: [{ role: "user", content: item.q }],
    use_tools: item.tools,
  });

  const start = Date.now();
  try {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const text = await res.text();

    if (res.status !== 200) {
      return { ...item, status: "FAIL", time: elapsed, answer: `HTTP ${res.status}: ${text.slice(0, 100)}` };
    }

    const answer = text.trim();
    if (!answer || answer.length < 5) {
      return { ...item, status: "FAIL", time: elapsed, answer: "(empty response)" };
    }

    const errorWords = ["عذرًا، لم أتمكن", "حدث خطأ", "مشكلة تقنية"];
    const hasError = errorWords.some(w => answer.includes(w));

    return {
      ...item,
      status: hasError ? "WARN" : "PASS",
      time: elapsed,
      answer: answer.slice(0, 250),
    };
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    return { ...item, status: "FAIL", time: elapsed, answer: err.message };
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("  CHATBOT SMOKE TEST - 20 Questions (Easy -> Hard)");
  console.log("=".repeat(70));
  console.log("");

  const results = [];

  for (const item of questions) {
    const label = `[${String(item.id).padStart(2)}/20]`;
    process.stdout.write(`${label} ${item.q.slice(0, 45).padEnd(47)}... `);
    const result = await testQuestion(item);
    results.push(result);

    const icon = result.status === "PASS" ? "+" : result.status === "WARN" ? "!" : "X";
    console.log(`${icon} ${result.status} (${result.time}s)`);
    console.log(`        -> ${result.answer.slice(0, 140)}`);
    console.log("");

    await new Promise(r => setTimeout(r, 1500));
  }

  console.log("=".repeat(70));
  console.log("  RESULTS SUMMARY");
  console.log("=".repeat(70));

  const pass = results.filter(r => r.status === "PASS").length;
  const warn = results.filter(r => r.status === "WARN").length;
  const fail = results.filter(r => r.status === "FAIL").length;
  const avgTime = (results.reduce((s, r) => s + parseFloat(r.time), 0) / results.length).toFixed(1);

  console.log(`  PASS: ${pass}/20`);
  console.log(`  WARN: ${warn}/20`);
  console.log(`  FAIL: ${fail}/20`);
  console.log(`  Avg Time: ${avgTime}s`);
  console.log(`  Score: ${((pass * 100 + warn * 50) / 20).toFixed(0)}%`);
  console.log("");

  const issues = results.filter(r => r.status !== "PASS");
  if (issues.length > 0) {
    console.log("  Issues:");
    issues.forEach(r => {
      console.log(`    [${r.id}] ${r.status}: ${r.q}`);
      console.log(`         ${r.answer.slice(0, 120)}`);
    });
  }

  console.log("=".repeat(70));
}

main().catch(console.error);
