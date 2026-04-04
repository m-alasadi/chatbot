/**
 * Test 10 Abbas questions against the chatbot API.
 * Usage: node tests/test-abbas-10.js [port]
 */
const http = require("http");

const PORT = process.argv[2] || 3017;

const questions = [
  "من هو العباس بن علي",
  "نبذة عن حياة أبي الفضل العباس",
  "ألقاب العباس",
  "صفات العباس",
  "من هم إخوة العباس",
  "أخوات العباس",
  "ما الذي يذكره الموقع عن زواج العباس",
  "متى استشهد العباس",
  "في أي عمر استشهد العباس",
  "ماذا يذكر الموقع عن أبي الفضل العباس",
];

function ask(question) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ messages: [{ role: "user", content: question }] });
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
        timeout: 60000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  console.log(`Testing 10 Abbas questions on port ${PORT}...\n`);
  const results = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    console.log(`Q${i + 1}: ${q}`);
    const start = Date.now();
    try {
      const { status, body } = await ask(q);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const hasInfo = !body.includes("لم أجد") && !body.includes("لم أتمكن") && !body.includes("لا تتوفر");
      const snippet = body.substring(0, 120).replace(/\n/g, " ");
      const result = hasInfo ? "✅ FOUND" : "❌ NOT FOUND";
      console.log(`  ${result} (${elapsed}s) ${snippet}...`);
      results.push({ q: i + 1, result: hasInfo ? "FOUND" : "NOT_FOUND", time: elapsed });
    } catch (e) {
      console.log(`  ❌ ERROR: ${e.message}`);
      results.push({ q: i + 1, result: "ERROR", time: 0 });
    }
  }
  console.log("\n=== Summary ===");
  const found = results.filter((r) => r.result === "FOUND").length;
  console.log(`Found: ${found}/10`);
  console.log(`Not found: ${results.filter((r) => r.result === "NOT_FOUND").length}/10`);
  console.log(`Errors: ${results.filter((r) => r.result === "ERROR").length}/10`);
})();
