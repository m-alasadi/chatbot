// Find article ID=124 via API
async function main() {
  const id = "124";
  const perPage = 50;
  const h = { "Accept-Language": "ar" };
  
  const m = await (await fetch("https://alkafeel.net/alkafeel_back_test/api/v1/articles/GetLast/1/all?page=1", { headers: h })).json();
  const total = m.total;
  const lastPage = Math.ceil(total / perPage);
  console.log("Total:", total, "LastPage:", lastPage);
  
  let target = Math.max(1, Math.min(lastPage, Math.ceil((total - 124 + 1) / perPage)));
  const tried = new Set();
  
  for (let i = 0; i < 8; i++) {
    if (tried.has(target)) break;
    tried.add(target);
    const d = await (await fetch(`https://alkafeel.net/alkafeel_back_test/api/v1/articles/GetLast/${perPage}/all?page=${target}`, { headers: h })).json();
    const items = d.data || [];
    if (!items.length) break;
    
    const ids = items.map(x => +x.id);
    console.log(`Try ${i+1}: page=${target} ids=${Math.max(...ids)}..${Math.min(...ids)}`);
    
    const hit = items.find(x => x.id == id);
    if (hit) { console.log("FOUND:", hit.title, "\nText:", (hit.text||"").slice(0,200)); return; }
    
    if (124 > Math.max(...ids)) target = Math.max(1, target - Math.max(1, Math.ceil((124 - Math.max(...ids)) / perPage)));
    else if (124 < Math.min(...ids)) target = Math.min(lastPage, target + Math.max(1, Math.ceil((Math.min(...ids) - 124) / perPage)));
    else { console.log("In range but gap"); break; }
  }
  console.log("NOT FOUND");
}
main();
