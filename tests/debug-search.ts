import * as fs from "fs"
import * as path from "path"
try {
  const envPath = path.join(process.cwd(), ".env.local")
  const content = fs.readFileSync(envPath, "utf8")
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i)
    if (m) {
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (!process.env[m[1]]) process.env[m[1]] = v
    }
  }
} catch (e) {}

import { fetchOfficialNewsSearchResults } from "../lib/server/site-api-service"
import { fetchOfficialNewsSearchResults, siteSearchContent } from "../lib/server/site-api-service"
import { scoreUnifiedItem, extractNamedPhrase, tokenizeArabicQuery, normalizeArabic } from "../lib/server/site-ranking-policy"

const GENERIC = new Set(["ماهي","ماهو","ما","اسم","من","هو","هي","هل","اين","يقام","كم","عدد","لي","عن","في","على","هن","له","لها","لهم","العتبه","العتبة","العباسيه","العباسية","مشروع","مشاريع","خبر","قديم","يتحدث","تكلم","اشرح","حدثني","اخبرني","حول","باختصار","اعطني","اعرض","عليه","السلام"])

const queries = [
  "هل تمتلك العتبة العباسية مصانع؟",
  "هل للعتبة مزارع أو مشاريع زراعية؟",
  "هل هنالك جامعات تابعة للعتبة العباسية؟",
]

;(async () => {
  for (const q of queries) {
    console.log("\n=====================================")
    console.log("Q:", q)
    const phrase = extractNamedPhrase(q)
    console.log("namedPhrase:", JSON.stringify(phrase))
    const specific = tokenizeArabicQuery(q).map(t => normalizeArabic(t)).filter(t => !GENERIC.has(t))
    console.log("specificTokens:", specific)

    const result = await siteSearchContent(q, "auto", 5)
    const items = (result.data as any)?.items || []
    console.log("siteSearchContent count:", items.length)
    for (const item of items.slice(0, 5)) {
      console.log(`  "${(item?.title || item?.name || "")?.slice(0, 70)}"`)
    }
  }
})()
