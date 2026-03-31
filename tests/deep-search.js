// Deep search for specific article
async function main() {
  const h = { "Accept-Language": "ar" };
  const keyword = "مسرحة الشعائر";
  
  console.log(`Deep searching for: "${keyword}"\n`);
  
  // Binary-ish search across many pages
  const pages = [1, 5, 10, 20, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 696];
  
  for (const p of pages) {
    const r = await fetch(`https://alkafeel.net/alkafeel_back_test/api/v1/articles/GetLast/50/all?page=${p}`, { headers: h });
    const d = await r.json();
    const items = d.data || [];
    
    const matches = items.filter(item =>
      (item.title || "").includes(keyword)
    );
    
    if (matches.length > 0) {
      console.log(`PAGE ${p}: FOUND ${matches.length}`);
      matches.forEach(m => console.log(`  [${m.id}] ${m.title}`));
    } else if (items.length > 0) {
      console.log(`Page ${p}: IDs ${items[0].id}..${items[items.length-1].id} - no match`);
    }
  }
}
main().catch(console.error);
