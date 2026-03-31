// Quick search test
async function main() {
  const h = { "Accept-Language": "ar", "Content-Type": "application/json" };
  
  // Search in recent 50 articles for the keyword
  const keyword = "مسرحة الشعائر الحسينية";
  console.log(`Searching for: "${keyword}" in last 50 articles...\n`);
  
  const res = await fetch("https://alkafeel.net/alkafeel_back_test/api/v1/articles/GetLast/50/all?page=1", { headers: h });
  const data = await res.json();
  
  const found = data.data?.filter(item => 
    (item.title || "").includes("مسرحة") || (item.text || "").includes("مسرحة")
  );
  
  console.log(`Total in page 1: ${data.data?.length || 0}`);
  console.log(`Found with "مسرحة": ${found?.length || 0}`);
  if (found?.length > 0) {
    found.forEach(f => console.log(`  - [${f.id}] ${f.title}`));
  }
  
  // Try wider search - pages 1-5
  console.log("\nSearching pages 1-5...");
  let allFound = [];
  for (let p = 1; p <= 5; p++) {
    const r = await fetch(`https://alkafeel.net/alkafeel_back_test/api/v1/articles/GetLast/50/all?page=${p}`, { headers: h });
    const d = await r.json();
    const matches = (d.data || []).filter(item =>
      (item.title || "").includes("مسرحة") || 
      (item.title || "").includes("مؤتمر") ||
      (item.text || "").includes("مسرحة")
    );
    if (matches.length > 0) {
      allFound.push(...matches);
      console.log(`  Page ${p}: ${matches.length} matches`);
      matches.forEach(m => console.log(`    - [${m.id}] ${m.title}`));
    }
  }
  
  if (allFound.length === 0) {
    console.log("  Not found in pages 1-5. Trying deeper search (pages 10, 50, 100)...");
    for (const p of [10, 50, 100, 200, 300]) {
      const r = await fetch(`https://alkafeel.net/alkafeel_back_test/api/v1/articles/GetLast/50/all?page=${p}`, { headers: h });
      const d = await r.json();
      const matches = (d.data || []).filter(item =>
        (item.title || "").includes("مسرحة") || (item.title || "").includes("شعائر")
      );
      if (matches.length > 0) {
        console.log(`  Page ${p}: ${matches.length} matches`);
        matches.forEach(m => console.log(`    - [${m.id}] ${m.title}`));
      }
    }
  }
}

main().catch(console.error);
