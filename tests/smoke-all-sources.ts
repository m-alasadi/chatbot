import { executeToolByName } from "../lib/server/site-api-service"

type Case = {
  name: string
  tool: any
  args: Record<string, any>
}

function extractCount(result: any): number {
  if (!result?.success) return 0
  const data = result.data
  if (!data) return 0
  if (Array.isArray(data)) return data.length
  if (Array.isArray(data.results)) return data.results.length
  if (Array.isArray(data.projects)) return data.projects.length
  if (Array.isArray(data.categories)) return data.categories.length
  if (typeof data === "object") return Object.keys(data).length
  return 0
}

async function run() {
  const cases: Case[] = [
    {
      name: "articles_latest -> latest",
      tool: "get_latest_by_source",
      args: { source: "articles_latest", limit: 5 }
    },
    {
      name: "videos_latest -> latest",
      tool: "get_latest_by_source",
      args: { source: "videos_latest", limit: 5 }
    },
    {
      name: "videos_categories -> categories",
      tool: "list_source_categories",
      args: { source: "videos_categories" }
    },
    {
      name: "videos_by_category -> latest",
      tool: "get_latest_by_source",
      args: { source: "videos_by_category", category_id: "1a2f5", limit: 5 }
    },
    {
      name: "shrine_history_sections -> categories",
      tool: "list_source_categories",
      args: { source: "shrine_history_sections" }
    },
    {
      name: "shrine_history_by_section -> latest",
      tool: "get_latest_by_source",
      args: { source: "shrine_history_by_section", section_id: "1", limit: 5 }
    },
    {
      name: "abbas_history_by_id -> search",
      tool: "search_content",
      args: { source: "abbas_history_by_id", id: "9", query: "العباس", limit: 5 }
    },
    {
      name: "lang_words_ar -> search",
      tool: "search_content",
      args: { source: "lang_words_ar", query: "news", limit: 5 }
    },
    {
      name: "auto routing -> search",
      tool: "search_content",
      args: { source: "auto", query: "اخر الاخبار", limit: 5 }
    },
    {
      name: "legacy tool search_projects",
      tool: "search_projects",
      args: { query: "محاضرة", source: "auto", limit: 5 }
    },
    {
      name: "legacy tool get_statistics",
      tool: "get_statistics",
      args: {}
    }
  ]

  const rows: Array<{
    name: string
    success: boolean
    count: number
    error?: string
  }> = []

  for (const c of cases) {
    const result = await executeToolByName(c.tool, c.args)
    rows.push({
      name: c.name,
      success: result.success,
      count: extractCount(result),
      error: result.error
    })
  }

  let failed = 0
  console.log("\n=== SOURCE TEST RESULTS ===")
  rows.forEach(r => {
    if (!r.success) failed += 1
    console.log(`${r.success ? "OK" : "FAIL"} | ${r.name} | count=${r.count}${r.error ? ` | error=${r.error}` : ""}`)
  })

  console.log(`\nSUMMARY | total=${rows.length} | failed=${failed}`)

  if (failed > 0) {
    process.exit(1)
  }
}

run().catch(err => {
  console.error("CRASH", err)
  process.exit(1)
})
