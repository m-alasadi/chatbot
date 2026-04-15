/**
 * Service Layer للتواصل مع REST API الخاص بالموقع
 *
 * جميع استدعاءات API تمر عبر هذه الطبقة
 * يتم التحكم بالـ Whitelist والتحقق من الأمان هنا
 */

import { getSiteAPIConfig } from "./site-api-config"
import type { AllowedToolName } from "./site-tools-definitions"
import { callSiteAPI } from "./site-api-transport"
import type { APICallResult } from "./site-api-transport"
import {
  type SiteSourceName,
  type SourceFetchParams,
  ALL_SOURCES,
  CATEGORY_INDEX_SOURCES,
  EXPANDABLE_SOURCES,
  canFetchSource,
  fetchSourceMetadataRaw,
  fetchSourcePage,
  friendlySourceLabel,
  getSourceDocuments,
  normalizeProjectsDataset
} from "./site-source-adapters"
import {
  buildEvidenceSnippet,
  deepTitleSearch,
  expandSearchFromSources,
  isCategoryIntent,
  looksLikeTitleQuery,
  normalizeArabic,
  rankCandidateSources,
  scoreTitleMatch,
  scoreUnifiedItem,
  tokenizeArabicQuery
} from "./site-ranking-policy"
import { understandQuery } from "./query-understanding"

export type { APICallResult } from "./site-api-transport"

/**
 * جلب جميع المشاريع من API
 * يتم cache النتائج لتجنب استدعاءات متكررة
 */
let projectsCache: any[] | null = null
let projectsCacheTime: number = 0
const CACHE_DURATION = 30 * 60 * 1000 // 30 دقيقة — تقليل استدعاءات API

async function getAllProjects(): Promise<APICallResult> {
  console.log("[getAllProjects] Starting...")
  const config = getSiteAPIConfig()

  // تحقق من الـ cache
  const now = Date.now()
  if (projectsCache && now - projectsCacheTime < CACHE_DURATION) {
    console.log("[getAllProjects] Returning cached data")
    return {
      success: true,
      data: projectsCache
    }
  }

  console.log("[getAllProjects] Cache miss, fetching from API...")

  // جلب البيانات من API
  const result = await callSiteAPI(config.allProjectsEndpoint)
  const normalizedProjects = result.success
    ? normalizeProjectsDataset(result.data)
    : []

  console.log(
    "[getAllProjects] API result:",
    result.success
      ? `Success (${normalizedProjects.length} projects)`
      : `Failed: ${result.error}`
  )

  if (result.success && normalizedProjects.length > 0) {
    projectsCache = normalizedProjects
    projectsCacheTime = now
    console.log("[getAllProjects] Cached", normalizedProjects.length, "projects")

    return {
      success: true,
      data: normalizedProjects
    }
  }

  if (result.success && normalizedProjects.length === 0) {
    return {
      success: false,
      error: "تم استلام البيانات لكن بصيغة غير مدعومة."
    }
  }

  return result
}

/**
 * البحث العميق في المشاريع
 * يبحث في: الاسم، الوصف، الأقسام، الخصائص (المكان، المواصفات، الجهة المنفذة...)،
 * العلامات (tags)، والعنوان
 *
 * @param query - كلمة البحث
 * @param section - اسم القسم بالعربية (اختياري)
 * @param limit - عدد النتائج
 */
export async function siteSearch(
  query?: string,
  section?: string,
  limit: number = 5
): Promise<APICallResult> {
  const allProjects = await getAllProjects()

  if (!allProjects.success) {
    return allProjects
  }

  const projects = allProjects.data as any[]

  // معالجة query فارغ أو undefined — GPT أحياناً يرسل section فقط بدون query
  const safeQuery = (query || "").trim()

  // تقسيم الاستعلام إلى كلمات فردية للبحث المرن
  const normQuery = normalizeArabic(safeQuery)
  const queryWords = tokenizeArabicQuery(safeQuery)
  const lowerQuery = normQuery

  function getSearchableTexts(project: any): { text: string; weight: number }[] {
    const texts: { text: string; weight: number }[] = []

    if (project.name) {
      texts.push({ text: normalizeArabic(project.name), weight: 10 })
    }

    if (project.description) {
      texts.push({ text: normalizeArabic(project.description), weight: 5 })
    }

    if (project.address) {
      texts.push({ text: normalizeArabic(project.address), weight: 5 })
    }

    if (Array.isArray(project.sections)) {
      for (const s of project.sections) {
        if (s.name) texts.push({ text: normalizeArabic(s.name), weight: 3 })
      }
    }

    if (Array.isArray(project.properties)) {
      for (const prop of project.properties) {
        if (prop.name) texts.push({ text: normalizeArabic(prop.name), weight: 3 })
        const val = prop.pivot?.value || prop.value
        if (val && typeof val === "string") {
          texts.push({ text: normalizeArabic(val), weight: 4 })
        }
      }
    }

    if (Array.isArray(project.kftags)) {
      for (const tag of project.kftags) {
        if (tag.title) texts.push({ text: normalizeArabic(tag.title), weight: 3 })
        if (tag.name) texts.push({ text: normalizeArabic(tag.name), weight: 3 })
      }
    }

    if (Array.isArray(project.kfnews)) {
      for (const news of project.kfnews) {
        if (news.title) texts.push({ text: normalizeArabic(news.title), weight: 2 })
        if (news.description) texts.push({ text: normalizeArabic(news.description), weight: 1 })
      }
    }

    return texts
  }

  function scoreProject(project: any): number {
    const searchTexts = getSearchableTexts(project)
    let score = 0

    for (const { text, weight } of searchTexts) {
      if (text.includes(lowerQuery)) {
        score += weight * 3
      }

      for (const word of queryWords) {
        if (text.includes(word)) {
          score += weight
        }
      }
    }

    return score
  }

  let scored = projects.map(project => ({
    project,
    score: scoreProject(project)
  }))

  if (section) {
    const normSection = normalizeArabic(section)
    scored = scored.filter(({ project }) =>
      project.sections?.some((s: any) =>
        normalizeArabic(s.name || "").includes(normSection)
      )
    )
  }

  if (queryWords.length > 0) {
    scored = scored.filter(({ score }) => score > 0)
  }

  scored.sort((a, b) => b.score - a.score)

  const filtered = scored.slice(0, limit).map(({ project }) => project)

  return {
    success: true,
    data: {
      results: filtered,
      total: filtered.length,
      query: safeQuery || section || ""
    }
  }
}

/**
 * الحصول على تفاصيل مشروع محدد
 *
 * @param id - معرف المشروع
 */
export async function siteGetProject(id: string): Promise<APICallResult> {
  const allProjects = await getAllProjects()

  if (!allProjects.success) {
    return allProjects
  }

  const projects = allProjects.data as any[]
  const project = projects.find(p => String(p.id) === String(id))

  if (!project) {
    return {
      success: false,
      error: `لم يتم العثور على المشروع ${id}`
    }
  }

  return {
    success: true,
    data: project
  }
}

/**
 * الحصول على قائمة الفئات (الأقسام)
 *
 * @param include_counts - تضمين عدد المشاريع في كل فئة
 */
export async function siteListCategories(
  include_counts: boolean = false
): Promise<APICallResult> {
  const allProjects = await getAllProjects()

  if (!allProjects.success) {
    return allProjects
  }

  const projects = allProjects.data as any[]
  const sectionsMap = new Map<string | number, { name: string; count: number }>()

  projects.forEach(project => {
    if (Array.isArray(project.sections)) {
      project.sections.forEach((section: any) => {
        if (section.id && section.name) {
          const existing = sectionsMap.get(section.id)
          if (existing) {
            existing.count++
          } else {
            sectionsMap.set(section.id, { name: section.name, count: 1 })
          }
        }
      })
    }
  })

  const categories = Array.from(sectionsMap.entries()).map(([id, data]) => ({
    id,
    name: data.name,
    ...(include_counts && { count: data.count })
  }))

  return {
    success: true,
    data: {
      categories,
      total_categories: categories.length
    }
  }
}

/**
 * الحصول على أحدث المشاريع
 *
 * @param limit - عدد المشاريع
 * @param category - فئة اختيارية
 */
export async function siteGetLatest(
  limit: number = 5,
  section?: string
): Promise<APICallResult> {
  const allProjects = await getAllProjects()

  if (!allProjects.success) {
    return allProjects
  }

  let projects = allProjects.data as any[]

  if (section) {
    projects = projects.filter(project =>
      project.sections?.some((s: any) =>
        s.name?.toLowerCase().includes(section.toLowerCase())
      )
    )
  }

  projects.sort((a, b) => {
    const dateA = new Date(a.created_at || 0).getTime()
    const dateB = new Date(b.created_at || 0).getTime()
    return dateB - dateA
  })

  projects = projects.slice(0, limit)

  return {
    success: true,
    data: {
      projects,
      total: projects.length,
      limit
    }
  }
}

/**
 * الحصول على إحصائيات المشاريع
 */
export async function siteGetStatistics(): Promise<APICallResult> {
  const allProjects = await getAllProjects()

  if (!allProjects.success) {
    return allProjects
  }

  const projects = allProjects.data as any[]
  const totalProjects = projects.length

  const sectionCounts = new Map<string, number>()
  projects.forEach(project => {
    if (Array.isArray(project.sections)) {
      project.sections.forEach((section: any) => {
        const name = section.name || "غير مصنف"
        sectionCounts.set(name, (sectionCounts.get(name) || 0) + 1)
      })
    }
  })

  const topSections = Array.from(sectionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ section: name, count }))

  return {
    success: true,
    data: {
      total_projects: totalProjects,
      top_sections: topSections,
      sections_count: sectionCounts.size
    }
  }
}

export async function siteSearchContent(
  query: string,
  source: SiteSourceName | "auto" = "auto",
  limit: number = 5,
  params: SourceFetchParams = {}
): Promise<APICallResult> {
  const understanding = understandQuery(query)
  const entityFirstMode = (() => {
    const norm = normalizeArabic(query)
    const officeHolderSignals = ["المتولي", "الشرعي", "الامين العام", "أمين عام"]
    const namedEventSignals = ["نداء العقيدة", "مهرجان", "فعالية", "برنامج", "مبادرة"]
    const personAttributeSignals = ["زوج", "زوجات", "ابناء", "أبناء", "القاب", "كنيه", "كنية", "عمر"]
    const singularProjectSignals = ["مشروع", "دجاج", "انتاج", "إنتاج", "زراعي", "تعليمي", "تربوي"]

    const officeHolder = officeHolderSignals.some(s => norm.includes(normalizeArabic(s)))
    const namedEvent = namedEventSignals.some(s => norm.includes(normalizeArabic(s)))
    const personAttribute =
      understanding.extracted_entities.person.length > 0 &&
      personAttributeSignals.some(s => norm.includes(normalizeArabic(s)))
    const singularProject =
      singularProjectSignals.some(s => norm.includes(normalizeArabic(s))) &&
      !norm.includes(normalizeArabic("مشاريع"))

    return officeHolder || namedEvent || personAttribute || singularProject
  })()

  const safeLimit = Math.min(Math.max(limit || 5, 1), 20)
  const rawCandidates = source === "auto"
    ? rankCandidateSources(query, params)
    : [source]

  const candidates = rawCandidates.filter(s => {
    if (!canFetchSource(s, params)) return false
    if (CATEGORY_INDEX_SOURCES.includes(s) && !isCategoryIntent(query)) return false
    return true
  })

  const fetched = await Promise.all(
    candidates.map(async s => ({ source: s, result: await getSourceDocuments(s, params) }))
  )

  let merged: any[] = []
  for (const entry of fetched) {
    if (entry.result.success && Array.isArray(entry.result.data)) {
      merged.push(...entry.result.data)
    }
  }

  const norm = normalizeArabic(query)
  const abbasAutoHints = ["العباس", "ابو الفضل", "ابا الفضل", "ابوالفضل"]
  const isAbbasBioQuery = abbasAutoHints.some(h => norm.includes(normalizeArabic(h)))
  if (isAbbasBioQuery && !params.section_id && !params.id && source === "auto") {
    const sectionsResult = await getSourceDocuments("shrine_history_sections")
    if (sectionsResult.success && Array.isArray(sectionsResult.data)) {
      for (const item of sectionsResult.data) {
        const s = scoreUnifiedItem(item, query)
        if (s > 0) {
          merged.push(item)
        }
      }
    }
  }

  if (merged.length === 0 && source === "auto") {
    const SAFE_FALLBACK: SiteSourceName[] = ["articles_latest", "videos_latest", "lang_words_ar"]
    const fallback = await Promise.all(
      SAFE_FALLBACK.map(async s => ({ source: s, result: await getSourceDocuments(s, params) }))
    )
    for (const entry of fallback) {
      if (entry.result.success && Array.isArray(entry.result.data)) {
        merged.push(...entry.result.data)
      }
    }
  }

  const deduped = new Map<string, any>()
  for (const item of merged) {
    const key = `${item?.source_type || "source"}:${item?.id || item?.name || Math.random()}`
    if (!deduped.has(key)) deduped.set(key, item)
  }

  let scored = Array.from(deduped.values())
    .map(item => ({ item, score: scoreUnifiedItem(item, query) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)

  if (!entityFirstMode && scored.length < safeLimit && source === "auto" && tokenizeArabicQuery(query).length > 0) {
    const expandSources = candidates.filter(s => EXPANDABLE_SOURCES.includes(s))
    if (expandSources.length > 0) {
      const extra = await expandSearchFromSources(
        expandSources,
        params,
        deduped,
        (s) => fetchSourceMetadataRaw(s, params),
        (s, p, pms) => fetchSourcePage(s, p, pms)
      )
      for (const item of extra) {
        const s = scoreUnifiedItem(item, query)
        if (s > 0) scored.push({ item, score: s })
      }
      scored.sort((a, b) => b.score - a.score)
    }
  } else if (entityFirstMode) {
    console.log("[siteSearchContent] Entity-first mode active, skipping broad expansion")
  }

  const isTitleQ = looksLikeTitleQuery(query)
  const hasStrongTitleHit = scored.some(s => scoreTitleMatch(s.item, query) >= 50)
  if (!entityFirstMode && isTitleQ && !hasStrongTitleHit && source === "auto") {
    console.log("[siteSearchContent] Title-query detected, launching deep archive scan...")
    const deepSources = candidates.filter(s => EXPANDABLE_SOURCES.includes(s))
    if (deepSources.length > 0) {
      const deepHits = await deepTitleSearch(
        query,
        deepSources,
        params,
        deduped,
        safeLimit,
        (s) => fetchSourceMetadataRaw(s, params),
        (s, p, pms) => fetchSourcePage(s, p, pms)
      )
      for (const h of deepHits) {
        scored.push(h)
      }
      scored.sort((a, b) => b.score - a.score)
    }
  } else if (entityFirstMode && isTitleQ) {
    console.log("[siteSearchContent] Entity-first mode active, skipping deep archive scan")
  }

  const results = scored.slice(0, safeLimit).map(x => ({
    ...x.item,
    _snippet: buildEvidenceSnippet(x.item, query)
  }))

  return {
    success: true,
    data: {
      results,
      total: results.length,
      result_count: results.length,
      top_score: scored.length > 0 ? scored[0].score : null,
      query,
      source_used: source,
      candidate_sources: candidates,
      source_attempts: candidates,
      entity_first_mode: entityFirstMode
    }
  }
}

export async function siteGetContentById(
  id: string,
  source: SiteSourceName | "auto" = "auto",
  params: SourceFetchParams = {}
): Promise<APICallResult> {
  const candidates = source === "auto" ? ALL_SOURCES : [source]
  const strId = String(id)

  for (const s of candidates) {
    const result = await getSourceDocuments(s, { ...params, id })
    if (!result.success || !Array.isArray(result.data)) continue
    const hit = result.data.find((item: any) => String(item?.id) === strId)
    if (hit) {
      return { success: true, data: hit }
    }
  }

  const paginatedCandidates = candidates.filter(s => EXPANDABLE_SOURCES.includes(s))
  for (const s of paginatedCandidates) {
    const meta = await fetchSourceMetadataRaw(s, params)
    const maxPage = Math.min(meta.last_page, 10)

    const numId = Number(strId)
    const pagesToTry: number[] = []

    if (Number.isFinite(numId) && numId > 0 && meta.per_page > 0 && meta.total > 0) {
      const estimatedPage = Math.ceil(meta.total / meta.per_page)
      const candidatesPages = [2, 3, estimatedPage, estimatedPage - 1, estimatedPage + 1]
      for (const p of candidatesPages) {
        if (p >= 2 && p <= maxPage && !pagesToTry.includes(p)) pagesToTry.push(p)
      }
    } else {
      for (let p = 2; p <= Math.min(5, maxPage); p++) pagesToTry.push(p)
    }

    for (const page of pagesToTry) {
      const items = await fetchSourcePage(s, page, params)
      if (items.length === 0) continue
      const hit = items.find((item: any) => String(item?.id) === strId)
      if (hit) {
        return { success: true, data: hit }
      }
    }
  }

  return {
    success: false,
    error: `لم يتم العثور على محتوى بالمعرف ${id}`
  }
}

export async function siteListSourceCategories(
  source: SiteSourceName | "auto" = "auto"
): Promise<APICallResult> {
  const categories: Array<{ id: string; name: string; source: string }> = []
  const candidates = source === "auto"
    ? ["articles_latest", "videos_categories", "shrine_history_sections"] as SiteSourceName[]
    : [source]

  for (const s of candidates) {
    const result = await getSourceDocuments(s)
    if (!result.success || !Array.isArray(result.data)) continue

    if (s === "articles_latest") {
      const map = new Map<string, string>()
      result.data.forEach((item: any) => {
        item?.sections?.forEach((sec: any) => {
          if (sec?.id && sec?.name) map.set(String(sec.id), String(sec.name))
        })
      })
      map.forEach((name, id) => categories.push({ id, name, source: s }))
      continue
    }

    result.data.forEach((item: any) => {
      categories.push({
        id: String(item?.id || ""),
        name: String(item?.name || "بدون اسم"),
        source: s
      })
    })
  }

  return {
    success: true,
    data: {
      categories,
      total_categories: categories.length,
      source_used: source
    }
  }
}

export async function siteGetLatestBySource(
  source: SiteSourceName | "auto" = "auto",
  limit: number = 5,
  params: SourceFetchParams = {}
): Promise<APICallResult> {
  const safeLimit = Math.min(Math.max(limit || 5, 1), 20)
  const candidates = source === "auto"
    ? (["articles_latest", "videos_latest"] as SiteSourceName[]).filter(s => canFetchSource(s, params))
    : [source]

  const results = await Promise.all(candidates.map(s => getSourceDocuments(s, params)))
  const merged = results
    .filter(r => r.success && Array.isArray(r.data))
    .flatMap(r => r.data as any[])

  merged.sort((a, b) => {
    const dateA = new Date(a?.created_at || 0).getTime()
    const dateB = new Date(b?.created_at || 0).getTime()
    return dateB - dateA
  })

  const items = merged.slice(0, safeLimit)
  return {
    success: true,
    data: {
      projects: items,
      total: items.length,
      limit: safeLimit,
      source_used: source,
      candidate_sources: candidates
    }
  }
}

export async function siteGetMultiSourceStatistics(): Promise<APICallResult> {
  const targets: SiteSourceName[] = ["articles_latest", "videos_latest", "lang_words_ar"]

  const bySource = await Promise.all(targets.map(async s => {
    if (EXPANDABLE_SOURCES.includes(s)) {
      const meta = await fetchSourceMetadataRaw(s)
      if (meta.total > 0) {
        return { source: s, count: meta.total }
      }
    }
    const docs = await getSourceDocuments(s)
    const count = docs.success && Array.isArray(docs.data) ? docs.data.length : 0
    return { source: s, count }
  }))

  const total = bySource.reduce((acc, cur) => acc + cur.count, 0)

  return {
    success: true,
    data: {
      total_records: total,
      sources_count: bySource.length,
      by_source: bySource
    }
  }
}

/**
 * Get metadata about a source: pagination info, cache stats, param requirements.
 * If source is "auto" (cast externally), returns compact metadata for all primary sources.
 */
export async function siteGetSourceMetadata(
  source: SiteSourceName | "auto" = "articles_latest"
): Promise<APICallResult> {
  const needsParam: Record<string, string | undefined> = {
    videos_by_category: "category_id",
    shrine_history_by_section: "section_id",
    abbas_history_by_id: "id"
  }

  if (source === "auto") {
    const primaries: SiteSourceName[] = ["articles_latest", "videos_latest", "lang_words_ar"]
    const summaries = await Promise.all(primaries.map(async s => {
      const meta = await fetchSourceMetadataRaw(s)
      return {
        source: s,
        friendly_name: friendlySourceLabel(s),
        total: meta.total,
        per_page: meta.per_page,
        last_page: meta.last_page,
        has_pagination: EXPANDABLE_SOURCES.includes(s)
      }
    }))
    return { success: true, data: { sources: summaries } }
  }

  const meta = await fetchSourceMetadataRaw(source)
  const cached = await getSourceDocuments(source)
  const cachedCount = cached.success && Array.isArray(cached.data) ? cached.data.length : 0

  return {
    success: true,
    data: {
      source,
      friendly_name: friendlySourceLabel(source),
      total: meta.total,
      current_page: meta.current_page,
      last_page: meta.last_page,
      per_page: meta.per_page,
      has_pagination: EXPANDABLE_SOURCES.includes(source),
      cached_count: cachedCount,
      is_category_index: CATEGORY_INDEX_SOURCES.includes(source),
      required_param: needsParam[source] || null
    }
  }
}

/**
 * Browse a specific page of a paginated source.
 * Supports order="newest" (default, page 1 = newest) and order="oldest" (reverses page direction).
 */
export async function siteBrowseSourcePage(
  source: SiteSourceName,
  page: number = 1,
  perPage: number = 10,
  order: "newest" | "oldest" = "newest"
): Promise<APICallResult> {
  if (!EXPANDABLE_SOURCES.includes(source)) {
    return { success: false, error: `المصدر ${source} لا يدعم التصفح بالصفحات` }
  }

  const safePerPage = Math.min(Math.max(perPage || 10, 1), 20)
  let targetPage = Math.max(1, Math.floor(page))

  if (order === "oldest") {
    const meta = await fetchSourceMetadataRaw(source)
    targetPage = Math.max(1, meta.last_page - (targetPage - 1))
  }

  const meta = await fetchSourceMetadataRaw(source)

  const items = targetPage === 1
    ? ((await getSourceDocuments(source)).data || []) as any[]
    : await fetchSourcePage(source, targetPage, {})

  const ordered = order === "oldest" ? [...items].reverse() : items

  const hasMore = meta.last_page > 1
    ? (order === "oldest" ? targetPage > 1 : targetPage < meta.last_page)
    : false

  return {
    success: true,
    data: {
      items: ordered.slice(0, safePerPage),
      total_in_page: ordered.length,
      total_all: meta.total,
      last_page: meta.last_page,
      page: Math.max(1, Math.floor(page)),
      api_page: targetPage,
      source,
      order,
      has_more: hasMore
    }
  }
}

/**
 * تنفيذ أداة بناءً على اسمها والمعاملات
 *
 * هذه الدالة هي نقطة الدخول الرئيسية لتنفيذ أي أداة
 *
 * @param toolName - اسم الأداة
 * @param args - معاملات الأداة
 */
export async function executeToolByName(
  toolName: AllowedToolName,
  args: Record<string, any>
): Promise<APICallResult> {
  console.log(`[Tool Execution] ${toolName}`, args)

  try {
    switch (toolName) {
      case "search_projects":
        return await siteSearchContent(args.query, args.source || "auto", args.limit, {
          category_id: args.category_id,
          section_id: args.section_id,
          id: args.id
        })

      case "search_content":
        return await siteSearchContent(args.query, args.source || "auto", args.limit, {
          category_id: args.category_id,
          section_id: args.section_id,
          id: args.id
        })

      case "get_project_by_id":
        return await siteGetContentById(args.id, args.source || "auto", {
          category_id: args.category_id,
          section_id: args.section_id,
          id: args.id
        })

      case "get_content_by_id":
        return await siteGetContentById(args.id, args.source || "auto", {
          category_id: args.category_id,
          section_id: args.section_id,
          id: args.id
        })

      case "filter_projects":
        return await siteListSourceCategories(args.source || "auto")

      case "list_source_categories":
        return await siteListSourceCategories(args.source || "auto")

      case "get_latest_projects":
        return await siteGetLatestBySource(args.source || "auto", args.limit, {
          category_id: args.category_id,
          section_id: args.section_id,
          id: args.id
        })

      case "get_latest_by_source":
        return await siteGetLatestBySource(args.source || "auto", args.limit, {
          category_id: args.category_id,
          section_id: args.section_id,
          id: args.id
        })

      case "get_statistics":
        return await siteGetMultiSourceStatistics()

      case "get_source_metadata":
        return await siteGetSourceMetadata(args.source || "auto")

      case "browse_source_page":
        return await siteBrowseSourcePage(
          args.source || "articles_latest",
          args.page,
          args.per_page || args.limit,
          args.order
        )

      default:
        return {
          success: false,
          error: `أداة غير معروفة: ${toolName}`
        }
    }
  } catch (error: any) {
    console.error(`[Tool Execution Error] ${toolName}:`, error)
    return {
      success: false,
      error: error.message || "حدث خطأ أثناء تنفيذ الأداة"
    }
  }
}
