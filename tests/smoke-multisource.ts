import { executeToolByName } from "../lib/server/site-api-service"

async function run() {
  const search = await executeToolByName("search_content", {
    query: "محاضرة",
    source: "auto",
    limit: 3
  })

  const latest = await executeToolByName("get_latest_by_source", {
    source: "articles_latest",
    limit: 3
  })

  const stats = await executeToolByName("get_statistics", {})

  console.log("SEARCH_OK", search.success, "TOTAL", search.data?.total)
  console.log("LATEST_OK", latest.success, "TOTAL", latest.data?.total)
  console.log("STATS_OK", stats.success, "SOURCES", stats.data?.sources_count)

  if (!search.success || !latest.success || !stats.success) {
    console.error("SMOKE_FAILED", {
      searchError: search.error,
      latestError: latest.error,
      statsError: stats.error
    })
    process.exit(1)
  }
}

run().catch((error) => {
  console.error("SMOKE_CRASH", error)
  process.exit(1)
})
