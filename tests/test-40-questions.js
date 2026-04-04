/**
 * Comprehensive 40+ question validation suite.
 * Covers: articles/news, videos, Abbas biography, shrine history,
 *         Friday sermons, وحي الجمعة, language, categories, type-constrained queries.
 *
 * Usage: node tests/test-40-questions.js [port]
 */
const http = require("http");

const PORT = process.argv[2] || 3000;

// ── Test questions organized by category ────────────────────────────

const questions = [
  // ── 1. Articles / News (5) ──────────────────────────────
  { q: "ما هي آخر أخبار العتبة العباسية", cat: "news", expectInfo: true },
  { q: "أحدث المقالات على الموقع", cat: "news", expectInfo: true },
  { q: "أخبار مشاريع العتبة العباسية", cat: "news", expectInfo: true },
  { q: "ابحث عن أخبار الزيارات", cat: "news", expectInfo: true },
  { q: "هل يوجد خبر عن مدارس العتبة", cat: "news", expectInfo: true },

  // ── 2. Videos (5) ──────────────────────────────────────
  { q: "أحدث الفيديوهات", cat: "video", expectInfo: true },
  { q: "فيديوهات العتبة العباسية", cat: "video", expectInfo: true },
  { q: "هل يوجد مقطع مرئي عن الزيارة", cat: "video", expectInfo: true },
  { q: "ما هي أقسام الفيديوهات", cat: "video-cat", expectInfo: true },
  { q: "فيديو عن الضريح المقدس", cat: "video", expectInfo: true },

  // ── 3. Abbas biography (5) ─────────────────────────────
  { q: "من هو العباس بن علي", cat: "abbas", expectInfo: true },
  { q: "ألقاب العباس", cat: "abbas", expectInfo: true },
  { q: "صفات أبي الفضل العباس", cat: "abbas", expectInfo: true },
  { q: "من هم إخوة العباس", cat: "abbas", expectInfo: true },
  { q: "ماذا يذكر الموقع عن أبي الفضل العباس", cat: "abbas", expectInfo: true },

  // ── 4. Shrine history (5) ──────────────────────────────
  { q: "تاريخ العتبة العباسية المقدسة", cat: "history", expectInfo: true },
  { q: "ما هي أقسام تاريخ العتبة", cat: "history", expectInfo: true },
  { q: "نبذة عن ضريح العباس", cat: "history", expectInfo: true },
  { q: "حدثني عن الحرم العباسي", cat: "history", expectInfo: true },
  { q: "معلومات عن مرقد أبي الفضل العباس", cat: "history", expectInfo: true },

  // ── 5. Friday sermons (5) ──────────────────────────────
  { q: "خطب الجمعة", cat: "sermon", expectInfo: true },
  { q: "أحدث خطبة جمعة", cat: "sermon", expectInfo: true },
  { q: "ابحث عن خطب الجمعة في العتبة", cat: "sermon", expectInfo: true },
  { q: "صلاة الجمعة في العتبة العباسية", cat: "sermon", expectInfo: true },
  { q: "هل يوجد فيديو لخطبة الجمعة", cat: "sermon", expectInfo: true },

  // ── 6. وحي الجمعة (3) ─────────────────────────────────
  { q: "من وحي الجمعة", cat: "wahy", expectInfo: true },
  { q: "مقتطفات من وحي الجمعة", cat: "wahy", expectInfo: true },
  { q: "ابحث في وحي الجمعة", cat: "wahy", expectInfo: true },

  // ── 7. Language / dictionary (3) ───────────────────────
  { q: "ما معنى كلمة العتبة", cat: "lang", expectInfo: true },
  { q: "ترجمة كلمات الموقع", cat: "lang", expectInfo: true },
  { q: "قاموس مصطلحات العتبة", cat: "lang", expectInfo: true },

  // ── 8. Type-constrained queries (5) ────────────────────
  { q: "فيديو عن العباس", cat: "type-video", expectInfo: true },
  { q: "خبر عن مشاريع العتبة", cat: "type-news", expectInfo: true },
  { q: "خطبة عن الإمام الحسين", cat: "type-sermon", expectInfo: true },
  { q: "مقال عن زيارة العتبة", cat: "type-article", expectInfo: true },
  { q: "فيديو عن صلاة الجمعة", cat: "type-video-sermon", expectInfo: true },

  // ── 9. Descriptive / biographical deep queries (5) ─────
  { q: "حدثني عن واقعة الطف", cat: "deep", expectInfo: true },
  { q: "ما هو دور العباس في كربلاء", cat: "deep", expectInfo: true },
  { q: "اخبرني عن تاريخ العتبة العباسية المقدسة", cat: "deep", expectInfo: true },
  { q: "معلومات عن زيارة الإمام الحسين", cat: "deep", expectInfo: true },
  { q: "عرفني على العتبة العباسية", cat: "deep", expectInfo: true },

  // ── 10. Edge cases / negative (4) ─────────────────────
  { q: "كم عدد الأخبار", cat: "count", expectInfo: true },
  { q: "ما هو أقدم خبر", cat: "oldest", expectInfo: true },
  { q: "ما هي تصنيفات الفيديوهات المتوفرة", cat: "categories", expectInfo: true },
  { q: "ما هي أحدث إصدارات العتبة", cat: "publications", expectInfo: true },
];

// ── HTTP client ─────────────────────────────────────────────────────

function ask(question) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      messages: [{ role: "user", content: question }],
    });
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
        timeout: 90000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.write(data);
    req.end();
  });
}

// ── Runner ──────────────────────────────────────────────────────────

(async () => {
  console.log(`\n=== 40+ Question Validation Suite ===`);
  console.log(`Port: ${PORT}  |  Questions: ${questions.length}\n`);

  const results = [];
  const catStats = {};

  for (let i = 0; i < questions.length; i++) {
    const { q, cat, expectInfo } = questions[i];
    process.stdout.write(`Q${String(i + 1).padStart(2, "0")} [${cat.padEnd(16)}] ${q.substring(0, 50).padEnd(50)} `);

    const start = Date.now();
    try {
      const { status, body } = await ask(q);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      const notFound =
        body.includes("لم أجد") ||
        body.includes("لم أتمكن") ||
        body.includes("لا تتوفر") ||
        body.includes("لا يتوفر") ||
        body.includes("لم يتم العثور");

      const isRateLimit = status === 429 || body.includes("exceeded your current quota");

      if (isRateLimit) {
        console.log(`⚠️  ${elapsed}s RATE-LIMITED (429)`);
        if (!catStats[cat]) catStats[cat] = { pass: 0, fail: 0, skipped: 0 };
        if (!catStats[cat].skipped) catStats[cat].skipped = 0;
        catStats[cat].skipped++;
        results.push({ n: i + 1, cat, pass: null, time: parseFloat(elapsed), chars: body.length });
        continue;
      }

      const hasInfo = !notFound && status === 200 && body.length > 20;
      const pass = expectInfo ? hasInfo : !hasInfo;
      const icon = pass ? "✅" : "❌";

      console.log(`${icon} ${elapsed}s (${body.length} chars)`);

      if (!catStats[cat]) catStats[cat] = { pass: 0, fail: 0 };
      catStats[cat][pass ? "pass" : "fail"]++;

      results.push({
        n: i + 1,
        cat,
        pass,
        time: parseFloat(elapsed),
        chars: body.length,
      });
    } catch (e) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`❌ ERROR ${elapsed}s: ${e.message}`);

      if (!catStats[cat]) catStats[cat] = { pass: 0, fail: 0 };
      catStats[cat].fail++;

      results.push({ n: i + 1, cat, pass: false, time: parseFloat(elapsed), chars: 0 });
    }
  }

  // ── Summary ─────────────────────────────────────────────
  const totalPass = results.filter((r) => r.pass === true).length;
  const totalSkipped = results.filter((r) => r.pass === null).length;
  const totalFail = results.length - totalPass - totalSkipped;
  const totalAnswered = totalPass + totalFail;

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total: ${totalPass}/${totalAnswered} passed (${totalFail} failed, ${totalSkipped} rate-limited/skipped)`);
  console.log(`Avg response time: ${(results.filter(r => r.pass !== null).reduce((s, r) => s + r.time, 0) / Math.max(1, totalAnswered)).toFixed(1)}s\n`);

  console.log("By category:");
  for (const [cat, stats] of Object.entries(catStats)) {
    const total = stats.pass + stats.fail;
    const skipped = stats.skipped || 0;
    const pct = total > 0 ? ((stats.pass / total) * 100).toFixed(0) : "N/A";
    console.log(`  ${cat.padEnd(18)} ${stats.pass}/${total} (${pct}%)${skipped > 0 ? ` [${skipped} skipped]` : ""}`);
  }

  if (totalFail > 0) {
    console.log(`\nFailed questions:`);
    for (const r of results.filter((r) => r.pass === false)) {
      console.log(`  Q${r.n}: [${r.cat}] ${questions[r.n - 1].q}`);
    }
  }

  const passRate = totalAnswered > 0 ? totalPass / totalAnswered : 0;
  console.log(`\n${passRate >= 0.8 ? "🟢 PASS" : "🔴 NEEDS WORK"} (${(passRate * 100).toFixed(0)}%, threshold: 80%)`);
})();
