async function main() {
  const r = await fetch("https://alkafeel.net/alkafeel_back_test/api/v1/videos/latest/40?page=1")
  const j: any = await r.json()
  const arr: any[] = Array.isArray(j) ? j : (j.data || j.videos || [])
  console.log("total videos:", arr.length)
  const cats = new Map<string, string>()
  arr.forEach(v => {
    const c = v.cat_title || v.category || v.cat_name
    const id = v.cat_id || v.category_id
    if (c) cats.set(c, String(id || "?"))
  })
  console.log("unique cats:", cats.size)
  for (const [c, id] of cats) {
    const hit = /مستشف|كفيل|طب/.test(c) ? "  ★ HIT:" : "    -"
    console.log(`${hit} id=${id} '${c}'`)
  }
  console.log("\nProbing ByCat 1..8:")
  for (const id of ["1","2","3","4","5","6","7","8"]) {
    try {
      const r2 = await fetch(`https://alkafeel.net/alkafeel_back_test/api/v1/videos/ByCat/${id}/3?page=1`)
      const j2: any = await r2.json()
      const a2: any[] = Array.isArray(j2) ? j2 : (j2.data || j2.videos || [])
      const cat = a2[0]?.cat_title || a2[0]?.category || "?"
      console.log(`  cat ${id}: count=${a2.length}, name='${cat}'`)
    } catch (e: any) { console.log(`  cat ${id}: ERR ${e.message}`) }
  }
}
main()
