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
  buildTokenVariants,
  deepTitleSearch,
  expandSearchFromSources,
  extractNamedPhrase,
  isCategoryIntent,
  looksLikeTitleQuery,
  normalizeArabic,
  rankCandidateSources,
  scoreTitleMatch,
  scoreUnifiedItem,
  tokenizeArabicQuery
} from "./site-ranking-policy"
import { understandQuery, deriveRetrievalCapabilitySignals } from "./query-understanding"

export type { APICallResult } from "./site-api-transport"

const OFFICIAL_NEWS_SEARCH_TIMEOUT_MS = Number(process.env.OFFICIAL_NEWS_SEARCH_TIMEOUT_MS || 12000)
const OFFICIAL_NEWS_SEARCH_CACHE_MS = Number(process.env.OFFICIAL_NEWS_SEARCH_CACHE_MS || 10 * 60 * 1000)
const officialNewsSearchCache = new Map<string, { items: any[]; cachedAt: number }>()
const FILTER_STOP_WORDS = new Set([
  "في",
  "من",
  "عن",
  "على",
  "الى",
  "الي",
  "للعتبه",
  "للعتبة",
  "العتبه",
  "العتبة",
  "العباسيه",
  "العباسية",
  "المقدسه",
  "المقدسة",
  "اليوم",
  "حاليا",
  "حالياً",
  "الان",
  "الآن",
  "احدث",
  "اخر",
  "آخر",
  "الاخيره",
  "الاخيرة",
  "الجديده",
  "الجديدة",
  "منشورات",
  "المنشورات",
  "اخبار",
  "الاخبار",
  "خبر",
  "الخبر",
  "فيديو",
  "الفيديو",
  "فيديوهات",
  "الفيديوهات",
  "مقاطع",
  "المقاطع",
  "اعرض",
  "هات",
  "اعطني",
  "اعطني",
  "اريد",
  "لي"
].map(token => normalizeArabic(token)))

type LatestSourceFetchParams = SourceFetchParams & {
  query?: string
}

interface SourceCategoryOption {
  id: string
  name: string
  source: string
}

interface LatestListingResolution {
  source: SiteSourceName | "auto"
  params: SourceFetchParams
  matchedCategory?: SourceCategoryOption | null
}

function buildArabicTokenVariants(token: string): string[] {
  const base = normalizeArabic(String(token || "")).trim()
  if (!base) return []

  const variants = new Set<string>([base])
  const suffixes = ["يه", "ه", "ات", "ين", "ون"]
  for (const suffix of suffixes) {
    if (base.endsWith(suffix) && base.length > suffix.length + 2) {
      variants.add(base.slice(0, -suffix.length))
    }
  }

  return [...variants].filter(value => value.length >= 3)
}

function buildRelaxedProjectQueries(query: string): string[] {
  const original = String(query || "").trim()
  if (!original) return []

  const stopTokens = new Set([
    "ما", "هو", "هي", "هل", "هناك", "هنالك", "يوجد", "توجد", "لدى", "لل",
    "عن", "في", "على", "الى", "إلى", "من", "او", "أو",
    "العتبه", "العتبة", "العباسيه", "العباسية", "المقدسه", "المقدسة",
    "تابع", "تابعة", "تابعه", "يتبع", "تتبع", "مؤسسة", "مؤسسات"
  ].map(token => normalizeArabic(token)))

  const tokens = tokenizeArabicQuery(original).filter(token => !stopTokens.has(token))
  const namedPhrase = extractNamedPhrase(original)
  const queries = new Set<string>()

  if (namedPhrase) queries.add(namedPhrase)
  if (tokens.length > 0) {
    queries.add(tokens.join(" "))
    queries.add(tokens.slice(0, 3).join(" "))
    queries.add(tokens.slice(0, 2).join(" "))
  }

  for (const token of tokens) {
    for (const variant of buildArabicTokenVariants(token)) {
      queries.add(variant)
      queries.add(`مشروع ${variant}`)
    }
  }

  return [...queries].map(value => value.trim()).filter(Boolean).slice(0, 8)
}

function decodeHtmlEntities(text: string): string {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    .replace(/&rlm;|&lrm;/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeOfficialNewsSearchDate(value: string): string {
  const raw = String(value || "").trim()
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return new Date().toISOString()
  const [, day, month, year] = match
  return new Date(`${year}-${month}-${day}T00:00:00.000Z`).toISOString()
}

async function fetchTextWithTimeout(
  url: string,
  timeoutMs: number
): Promise<string | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept-Language": "ar",
        "User-Agent": "Mozilla/5.0"
      }
    })

    if (!response.ok) return null
    return await response.text()
  } catch (error) {
    console.warn("[OfficialNewsSearch] Request failed:", (error as Error)?.message || error)
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

function buildOfficialNewsSearchQueries(query: string, preserveEntityTokens: boolean = false): string[] {
  const original = String(query || "").trim()
  const namedPhrase = extractNamedPhrase(original)
  const normOriginal = normalizeArabic(original)
  const baseStopTokens = [
    "ما", "هو", "هي", "هل", "من", "عن", "في", "على", "الى", "إلى", "او", "أو",
    "للعتبه", "للعتبة", "العتبه", "العتبة", "العباسيه", "العباسية",
    "ابحث", "بحث", "خبر", "اخبار", "قديم", "قديمة", "يتحدث", "حول", "تكلم", "اشرح",
    "لي", "باختصار", "مختصر", "حدثني", "اخبرني", "عرفني", "اعطني", "اعرض", "عليه", "السلام"
  ]
  const stopTokens = new Set(baseStopTokens.map(token => normalizeArabic(token)))
  if (preserveEntityTokens) {
    const identityTokens = ["للعتبه", "للعتبة", "العتبه", "العتبة", "العباسيه", "العباسية"]
    for (const token of identityTokens) {
      stopTokens.delete(normalizeArabic(token))
    }
  }
  const specificTokens = tokenizeArabicQuery(original).filter(token => !stopTokens.has(token))
  const queries = new Set<string>()
  const constructionTokens = specificTokens.filter(token =>
    ["اعمار", "ترميم", "صيانه", "توسعه", "توسعة", "بناء", "تشييد"].includes(token)
  )

  if (namedPhrase) queries.add(namedPhrase)
  if (original) queries.add(original)
  if (specificTokens.length > 0) queries.add(specificTokens.slice(0, 5).join(" "))

  if (specificTokens.length > 0) {
    queries.add(specificTokens.slice(0, 4).join(" "))
    queries.add(specificTokens.slice(0, 2).join(" "))
  }

  const asksProjectLookup =
    specificTokens.length > 0 &&
    /(?:^|\s)(?:هل|يوجد|هناك|هنالك|ما|من)(?:\s|$)/u.test(normOriginal) &&
    !/(?:^|\s)(?:كم|عدد|اجمالي|إجمالي|مجموع)(?:\s|$)/u.test(normOriginal)
  if (asksProjectLookup) {
    for (const token of specificTokens.slice(0, 2)) {
      queries.add(`مشروع ${token}`)
    }
  }

  if (constructionTokens.length > 0) {
    queries.add(constructionTokens.slice(0, 2).join(" "))
    for (const token of constructionTokens.slice(0, 2)) {
      queries.add(`مشروع ${token}`)
      queries.add(token)
    }
  }

  const asksOfficeHolder = normOriginal.includes(normalizeArabic("المتولي الشرعي"))
  if (asksOfficeHolder) {
    queries.add("المتولي الشرعي")
    queries.add("اسم المتولي الشرعي")
  }

  const asksImamaWeek =
    normOriginal.includes(normalizeArabic("أسبوع الإمامة")) ||
    normOriginal.includes(normalizeArabic("اسبوع الامامة"))
  if (asksImamaWeek) {
    queries.add("أسبوع الإمامة")
    queries.add("فعاليات أسبوع الإمامة")
  }

  const asksProxyVisit =
    normOriginal.includes(normalizeArabic("الزيارة بالنيابة")) ||
    normOriginal.includes(normalizeArabic("زياره بالنيابه"))
  if (asksProxyVisit) {
    queries.add("الزيارة بالنيابة")
    queries.add("خدمة الزيارة بالنيابة")
  }

  if (specificTokens.length > 0) {
    for (const token of specificTokens.slice(0, 5)) {
      for (const variant of buildArabicTokenVariants(token)) {
        queries.add(variant)
      }
    }
  }

  return [...queries]
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, 12)
}

export async function fetchOfficialNewsSearchResults(
  query: string,
  limit: number,
  options: { preserveEntityTokens?: boolean } = {}
): Promise<any[]> {
  const cacheKey = `${query}::${limit}`
  const cached = officialNewsSearchCache.get(cacheKey)
  const now = Date.now()
  if (cached && now - cached.cachedAt < OFFICIAL_NEWS_SEARCH_CACHE_MS) {
    return cached.items.slice(0, Math.max(limit * 8, 40))
  }

  const baseUrl = (process.env.SITE_API_BASE_URL || "https://alkafeel.net").replace(/\/+$/, "")
  const items: any[] = []
  const blockPattern = /<div id="(\d+)"[\s\S]*?<a[^>]+href="index\?id=(\d+)&lang=ar"[\s\S]*?<div class="ar_title-0[\s\S]*?">([\s\S]*?)<\/div>[\s\S]*?<div class="ar_date-[\s\S]*?">([\s\S]*?)<\/div>/g
  const maxCandidates = Math.max(limit * 8, 40)
  const seenIds = new Set<string>()
  const searchQueries = buildOfficialNewsSearchQueries(query, Boolean(options.preserveEntityTokens))

  for (const searchQuery of searchQueries) {
    const searchUrl = `${baseUrl}/news/search?search_term=${encodeURIComponent(searchQuery)}&lang=ar`
    const html = await fetchTextWithTimeout(searchUrl, OFFICIAL_NEWS_SEARCH_TIMEOUT_MS)
    if (!html || !html.includes("message_box")) continue

    let match: RegExpExecArray | null
    while ((match = blockPattern.exec(html)) !== null && items.length < maxCandidates) {
      const [, blockId, articleId, rawTitle, rawDate] = match
      const title = decodeHtmlEntities(rawTitle)
      const stableId = String(articleId || blockId)
      if (!title || seenIds.has(stableId)) continue

      seenIds.add(stableId)
      items.push({
        id: stableId,
        name: title,
        description: "",
        image: null,
        created_at: normalizeOfficialNewsSearchDate(decodeHtmlEntities(rawDate)),
        address: "",
        sections: [{ id: "official_news_search", name: "نتائج بحث الأخبار" }],
        kftags: [],
        properties: [],
        url: `${baseUrl}/news/index?id=${encodeURIComponent(stableId)}&lang=ar`,
        source_type: "articles_latest",
        source_raw: {
          query: searchQuery,
          search_url: searchUrl,
          official_search: true
        }
      })
    }

    if (items.length >= maxCandidates) break
  }

  if (items.length > 0) {
    officialNewsSearchCache.set(cacheKey, {
      items: [...items],
      cachedAt: now
    })
  }

  return items
}

export function shouldAllowOfficialNewsSearchFallback(
  source: SiteSourceName | "auto",
  scoredCount: number,
  topScore: number,
  capability: ReturnType<typeof deriveRetrievalCapabilitySignals>,
  query: string
): boolean {
  const hasQueryTokens = tokenizeArabicQuery(query).length > 0
  if (!hasQueryTokens) return false

  const isPrimaryNewsSource = source === "auto" || source === "articles_latest"
  const isHistorySource =
    source === "shrine_history_timeline" ||
    source === "shrine_history_sections" ||
    source === "shrine_history_by_section"
  const weakOrEmptyHistoryMatch = isHistorySource && (scoredCount === 0 || topScore < 8)

  if (!isPrimaryNewsSource && !weakOrEmptyHistoryMatch) return false

  return (
    scoredCount === 0 ||
    topScore < 8 ||
    capability.named_event_or_program ||
    capability.institutional_relation ||
    capability.title_or_phrase_lookup ||
    capability.singular_project_lookup ||
    looksLikeTitleQuery(query)
  )
}

function extractSectionFilterCandidates(query: string): string[] {
  const norm = normalizeArabic(String(query || ""))
  if (!norm) return []

  const markers = [
    "من قسم",
    "في قسم",
    "بقسم",
    "قسم",
    "القسم",
    "من تصنيف",
    "في تصنيف",
    "تصنيف",
    "التصنيف",
    "من فئة",
    "في فئة",
    "فئة",
    "الفئة"
  ].map(marker => normalizeArabic(marker))

  const phrases: string[] = []

  for (const marker of markers) {
    const idx = norm.indexOf(marker)
    if (idx === -1) continue

    const tail = norm
      .slice(idx + marker.length)
      .trim()
      .replace(/^(?:الخاص|الخاصة|الخاصه|التابع|التابعه|التابعة|المسمى|المسمي)\s+/u, "")

    if (!tail) continue

    const collected: string[] = []
    for (const token of tail.split(/\s+/).filter(Boolean)) {
      if (FILTER_STOP_WORDS.has(token)) {
        if (collected.length > 0) break
        continue
      }
      collected.push(token)
      if (collected.length >= 5) break
    }

    if (collected.length === 0) continue
    phrases.push(collected.join(" "))
    for (let len = Math.min(collected.length, 4); len >= 1; len--) {
      phrases.push(collected.slice(0, len).join(" "))
    }
  }

  return [...new Set(phrases.filter(Boolean))]
}

function scoreCategoryMatch(
  category: SourceCategoryOption,
  queryCandidates: string[]
): number {
  const normName = normalizeArabic(category.name)
  if (!normName || queryCandidates.length === 0) return 0

  const nameTokens = tokenizeArabicQuery(category.name)
  let bestScore = 0

  for (const candidate of queryCandidates) {
    const normCandidate = normalizeArabic(candidate)
    if (!normCandidate) continue

    if (normName === normCandidate) {
      bestScore = Math.max(bestScore, 100)
      continue
    }

    if (normName.includes(normCandidate)) {
      bestScore = Math.max(bestScore, 80 + Math.min(normCandidate.length, 10))
    }

    if (normCandidate.includes(normName)) {
      bestScore = Math.max(bestScore, 70 + Math.min(normName.length, 10))
    }

    const candidateTokens = tokenizeArabicQuery(candidate)
    const overlap = candidateTokens.filter(token =>
      nameTokens.some(nameToken => nameToken.includes(token) || token.includes(nameToken))
    ).length

    if (overlap > 0) {
      const tokenScore = overlap * 20 + (candidateTokens.length === nameTokens.length ? 10 : 0)
      bestScore = Math.max(bestScore, tokenScore)
    }
  }

  return bestScore
}

function findBestCategoryMatch(
  query: string,
  categories: SourceCategoryOption[]
): SourceCategoryOption | null {
  const candidates = extractSectionFilterCandidates(query)
  if (candidates.length === 0 || categories.length === 0) return null

  let bestMatch: SourceCategoryOption | null = null
  let bestScore = 0

  for (const category of categories) {
    const score = scoreCategoryMatch(category, candidates)
    if (score > bestScore) {
      bestScore = score
      bestMatch = category
    }
  }

  return bestScore >= 40 ? bestMatch : null
}

export async function resolveLatestListingRequest(
  source: SiteSourceName | "auto" = "auto",
  params: LatestSourceFetchParams = {},
  listCategories: (source: SiteSourceName | "auto") => Promise<APICallResult> = siteListSourceCategories
): Promise<LatestListingResolution> {
  const resolvedParams: SourceFetchParams = {
    category_id: params.category_id,
    section_id: params.section_id,
    id: params.id
  }

  if (!params.query) {
    return { source, params: resolvedParams, matchedCategory: null }
  }

  if (source === "videos_latest" && !resolvedParams.category_id) {
    const categoriesResult = await listCategories("videos_categories")
    const categories = Array.isArray(categoriesResult.data?.categories)
      ? categoriesResult.data.categories as SourceCategoryOption[]
      : []
    const match = findBestCategoryMatch(params.query, categories)

    if (match) {
      return {
        source: "videos_by_category",
        params: { ...resolvedParams, category_id: match.id },
        matchedCategory: match
      }
    }
  }

  if (source === "articles_latest" && !resolvedParams.section_id) {
    const categoriesResult = await listCategories("articles_latest")
    const categories = Array.isArray(categoriesResult.data?.categories)
      ? categoriesResult.data.categories as SourceCategoryOption[]
      : []
    const match = findBestCategoryMatch(params.query, categories)

    if (match) {
      return {
        source,
        params: { ...resolvedParams, section_id: match.id },
        matchedCategory: match
      }
    }
  }

  return { source, params: resolvedParams, matchedCategory: null }
}

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

  // The canonical projects API is paginated (Laravel-style: { data, current_page,
  // last_page, ... }). When it returns a single array (legacy/simple endpoints)
  // we use it as-is. When it's paginated we fetch every page so the search
  // operates on the full catalog.
  const firstPage = await callSiteAPI(config.allProjectsEndpoint)
  const aggregated: any[] = []

  if (firstPage.success) {
    if (Array.isArray(firstPage.data)) {
      aggregated.push(...firstPage.data)
    } else if (firstPage.data && Array.isArray(firstPage.data.data)) {
      aggregated.push(...firstPage.data.data)
      const lastPage = Number(firstPage.data.last_page) || 1
      const isAbsolute = /^https?:\/\//.test(config.allProjectsEndpoint)
      const separator = config.allProjectsEndpoint.includes("?") ? "&" : "?"
      for (let page = 2; page <= lastPage; page++) {
        const pageUrl = isAbsolute
          ? `${config.allProjectsEndpoint}${separator}page=${page}`
          : `${config.allProjectsEndpoint}${separator}page=${page}`
        const pageResult = await callSiteAPI(pageUrl)
        if (pageResult.success && pageResult.data && Array.isArray(pageResult.data.data)) {
          aggregated.push(...pageResult.data.data)
        } else {
          break
        }
      }
    }
  }

  const result: APICallResult = aggregated.length > 0
    ? { success: true, data: aggregated }
    : firstPage
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
        // Match word OR any morphological variant (broken plural, suffix-stripped)
        const variants = buildTokenVariants(word)
        if (variants.some(v => text.includes(v))) {
          score += weight
        }
      }
    }

    return score
  }

  // Relaxed scorer: matches by morphological stem (≥3-char shared prefix between
  // query token and any whole word in the project text). Generalizable — handles
  // feminine/masculine adjective forms, plural ↔ singular, and root-shared
  // derivatives without hard-coded synonym lists.
  function scoreProjectRelaxed(project: any): number {
    if (queryWords.length === 0) return 0
    // Build stems from BOTH original tokens AND their morphological variants
    // so broken plurals (مصانع→مصنع) can stem-match singular project names.
    const stems: string[] = []
    for (const w of queryWords) {
      for (const v of buildTokenVariants(w)) {
        const stem = v.length >= 4 ? v.slice(0, Math.max(3, v.length - 1)) : v
        if (stem.length >= 3) stems.push(stem)
      }
    }
    if (stems.length === 0) return 0

    const searchTexts = getSearchableTexts(project)
    let score = 0
    for (const { text, weight } of searchTexts) {
      const words = text.split(/\s+/).filter(w => w.length >= 3)
      for (const stem of stems) {
        const hit = words.some(w => {
          if (w.startsWith(stem)) return true
          // bidirectional shared prefix: word starts with stem, or stem starts with word
          // (handles plural↔singular, masc↔fem morphology). Require ≥4 shared chars.
          const minLen = Math.min(w.length, stem.length)
          if (minLen < 4) return false
          return w.slice(0, minLen) === stem.slice(0, minLen)
        })
        if (hit) score += weight
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
    const exactMatched = scored.filter(({ score }) => score > 0)
    if (exactMatched.length > 0) {
      scored = exactMatched
    } else {
      // No exact substring matches — relax to morphological/stem matching.
      scored = projects
        .map(project => ({ project, score: scoreProjectRelaxed(project) }))
        .filter(({ score }) => score > 0)
    }
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
  const capability = deriveRetrievalCapabilitySignals(understanding, query)
  const entityFirstMode = capability.entity_first_mode &&
    understanding.clarity !== "underspecified" &&
    !capability.institutional_relation

  const safeLimit = Math.min(Math.max(limit || 5, 1), 20)
  const rawCandidates = source === "auto"
    ? rankCandidateSources(query, params, capability)
    : [source]
  const widenedCandidates: SiteSourceName[] = source === "auto" && (capability.institutional_relation || capability.title_or_phrase_lookup)
    ? [...new Set<SiteSourceName>([
        ...rawCandidates,
        "articles_latest",
        "friday_sermons",
        "wahy_friday",
        "videos_latest",
        "shrine_history_sections"
      ])]
    : rawCandidates

  const candidates = widenedCandidates.filter(s => {
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

  // Always attempt to augment from the projects dataset when source is auto.
  // No hard-coded vocabulary gate: getAllProjects() is cached (30 min) so the
  // call is cheap, and siteSearch() returns only items with score > 0. The
  // downstream scoring drops any irrelevant items, so non-project queries
  // pay near-zero cost and project queries get full coverage automatically.
  const shouldAugmentFromProjectsDataset = source === "auto"

  if (shouldAugmentFromProjectsDataset) {
    const projectQueries = [query, ...buildRelaxedProjectQueries(query)]
    const seenProjectIds = new Set<string>()

    for (const projectQuery of projectQueries) {
      const projectsAugment = await siteSearch(projectQuery, undefined, Math.min(Math.max(safeLimit * 3, 8), 20))
      if (!projectsAugment.success || !Array.isArray(projectsAugment.data?.results)) continue

      for (const projectItem of projectsAugment.data.results) {
        const projectId = String(projectItem?.id || "")
        if (!projectId || seenProjectIds.has(projectId)) continue
        seenProjectIds.add(projectId)
        merged.push({
          ...projectItem,
          source_type: projectItem?.source_type || "projects_dataset"
        })
      }

      if (seenProjectIds.size >= safeLimit * 2) break
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
    const SAFE_FALLBACK: SiteSourceName[] = capability.title_or_phrase_lookup
      ? ["articles_latest", "friday_sermons", "wahy_friday", "videos_latest", "shrine_history_sections", "lang_words_ar"]
      : ["articles_latest", "videos_latest", "lang_words_ar"]
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

  if (capability.institutional_relation && scored.length === 0) {
    const relaxedScoreQueries = [
      ...buildRelaxedProjectQueries(query),
      ...tokenizeArabicQuery(query).slice(0, 4)
    ]
    const seenRelaxed = new Set<string>()
    const uniqueRelaxed = relaxedScoreQueries.filter(q => {
      const key = normalizeArabic(String(q || ""))
      if (!key || seenRelaxed.has(key)) return false
      seenRelaxed.add(key)
      return true
    }).slice(0, 8)

    if (uniqueRelaxed.length > 0) {
      scored = Array.from(deduped.values())
        .map(item => {
          const best = uniqueRelaxed.reduce((maxScore, relaxedQuery) => {
            return Math.max(maxScore, scoreUnifiedItem(item, relaxedQuery))
          }, 0)
          return { item, score: best }
        })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
    }
  }

  const topScore = scored[0]?.score || 0
  const shouldUseOfficialNewsSearch = shouldAllowOfficialNewsSearchFallback(
    source,
    scored.length,
    topScore,
    capability,
    query
  )

  if (shouldUseOfficialNewsSearch) {
    console.log(`[siteSearchContent] Official news search fallback for query="${query}"`)
    // للاستعلامات الطويلة: استخرج الكلمات الرئيسية (محتوى) فقط بدلاً من الجملة الكاملة
    // حتى لا يُعيد الـ API نتائج غير ذات صلة بسبب الكلمات الوظيفية
    const queryTokensRaw = tokenizeArabicQuery(query)
    const genericStopSet = new Set(["ماهي","ماهو","ما","اسم","من","هو","هي","هل","اين","يقام","كم","عدد","لي","عن","في","على","هن","له","لها","لهم","العتبه","العتبة","العباسيه","العباسية","مشروع","مشاريع","خبر","قديم","يتحدث","تكلم","اشرح","حدثني","اخبرني","حول","باختصار","اعطني","اعرض","عليه","السلام","تمتلك","يمتلك","تملك","توجد","يوجد","هناك","هنالك","تتبع","تابعه","تابع","لديها","لديه","لدى","او","أو","ثم","بل","لكن","اما","للعتبه","لعتبه"])
    const keyTokens = queryTokensRaw.filter(t => !genericStopSet.has(normalizeArabic(t)))
    // Strip stop-words only when at least TWO content tokens remain. With a
    // single content token (e.g. "جامعات") the search loses entity context
    // and returns generic articles; the full query keeps the discriminating
    // tokens (e.g. "العباسية") that the API uses for relevance ranking.
    const officialSearchQuery = keyTokens.length >= 2 && keyTokens.length < queryTokensRaw.length
      ? keyTokens.join(" ")
      : query
    const officialNewsResults = await fetchOfficialNewsSearchResults(officialSearchQuery, safeLimit, {
      preserveEntityTokens: capability.institutional_relation
    })
    console.log(`[siteSearchContent] Official news search returned ${officialNewsResults.length} candidate(s)`)
    for (const item of officialNewsResults) {
      const key = `${item?.source_type || "source"}:${item?.id || item?.name || Math.random()}`
      if (!deduped.has(key)) {
        deduped.set(key, item)
      }
    }

    if (officialNewsResults.length > 0) {
      scored = Array.from(deduped.values())
        .map(item => ({ item, score: scoreUnifiedItem(item, query) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)

      if (capability.institutional_relation && scored.length === 0) {
        const relaxedScoreQueries = [
          ...buildRelaxedProjectQueries(query),
          ...tokenizeArabicQuery(query).slice(0, 4)
        ]
        const seenRelaxed = new Set<string>()
        const uniqueRelaxed = relaxedScoreQueries.filter(q => {
          const key = normalizeArabic(String(q || ""))
          if (!key || seenRelaxed.has(key)) return false
          seenRelaxed.add(key)
          return true
        }).slice(0, 8)

        if (uniqueRelaxed.length > 0) {
          scored = Array.from(deduped.values())
            .map(item => {
              const best = uniqueRelaxed.reduce((maxScore, relaxedQuery) => {
                return Math.max(maxScore, scoreUnifiedItem(item, relaxedQuery))
              }, 0)
              return { item, score: best }
            })
            .filter(x => x.score > 0)
            .sort((a, b) => b.score - a.score)
        }
      }
    }
  }

  const shouldExpandSearch =
    source === "auto" &&
    tokenizeArabicQuery(query).length > 0 &&
    (
      capability.institutional_relation ||
      capability.title_or_phrase_lookup ||
      !entityFirstMode ||
      scored.length === 0 ||
      (scored[0]?.score || 0) < 8
    )

  if (shouldExpandSearch && scored.length < safeLimit) {
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

  const isTitleQ = looksLikeTitleQuery(query) || capability.title_or_phrase_lookup
  const hasStrongTitleHit = scored.some(s => scoreTitleMatch(s.item, query) >= 50)
  const shouldRunDeepTitleScan =
    isTitleQ &&
    !hasStrongTitleHit &&
    source === "auto" &&
    (
      !entityFirstMode ||
      scored.length === 0 ||
      (scored[0]?.score || 0) < 12
    )

  if (shouldRunDeepTitleScan) {
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

  // Final-stage rescue: when the unified search has produced no scored results
  // and we're in auto-source mode, surface the project section catalog so the
  // LLM can either identify a relevant domain category or honestly state which
  // categories exist. The matching is purely data-driven against the live
  // taxonomy (no hard-coded vocabulary): if no section name shares stems with
  // the query, `matched` will be empty and the hint stays generic.
  if (results.length === 0 && source === "auto") {
    try {
      const catalog = await siteListCategories(true)
      const allCats = Array.isArray(catalog?.data?.categories) ? catalog.data.categories : []
      const queryTokens = tokenizeArabicQuery(query)
      const stems = queryTokens
        .map(t => t.length >= 4 ? t.slice(0, t.length - 1) : t)
        .filter(s => s.length >= 3)

      const scoredCatalog = allCats
        .map((c: any) => {
          const name = normalizeArabic(String(c?.name || ""))
          if (!name) return { c, s: 0 }
          let s = 0
          for (const stem of stems) {
            if (name.includes(stem)) s += 5
            const words = name.split(/\s+/).filter((w: string) => w.length >= 3)
            if (words.some((w: string) => w.startsWith(stem) || stem.startsWith(w))) s += 2
          }
          return { c, s }
        })
        .sort((a: any, b: any) => b.s - a.s)

      const matched = scoredCatalog.filter((x: any) => x.s > 0).slice(0, 8).map((x: any) => x.c)
      const browse = allCats.slice(0, 40).map((c: any) => ({
        id: c.id,
        name: c.name,
        count: typeof c.count === "number" ? c.count : undefined
      }))

      return {
        success: true,
        data: {
          results: [],
          total: 0,
          result_count: 0,
          top_score: null,
          query,
          source_used: source,
          candidate_sources: candidates,
          source_attempts: candidates,
          entity_first_mode: entityFirstMode,
          empty_results: true,
          rescue_hint: {
            kind: "project_section_catalog",
            note: "لم تُرجع المصادر المُجدولة نتائج بحث مباشرة، ولكن المؤسسة تمتلك قائمة أقسام للمشاريع. تحقّق من أقسام المشاريع التالية لمعرفة ما إذا كان أحدها يطابق موضوع السؤال (مثلاً: قسم زراعي، قسم صحي، قسم خدمي…). إذا وجدت قسماً مطابقاً، استخدم get_latest_by_source/list_source_categories للحصول على التفاصيل قبل الاعتذار.",
            matched_sections: matched,
            available_sections: browse,
            total_sections: allCats.length
          }
        }
      }
    } catch (e) {
      console.warn("[siteSearchContent] catalog rescue failed:", (e as Error)?.message)
    }
  }

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
  params: LatestSourceFetchParams = {}
): Promise<APICallResult> {
  const safeLimit = Math.min(Math.max(limit || 5, 1), 20)
  const resolved = await resolveLatestListingRequest(source, params)
  const candidates = resolved.source === "auto"
    ? (["articles_latest", "videos_latest"] as SiteSourceName[]).filter(s => canFetchSource(s, resolved.params))
    : [resolved.source]

  const results = await Promise.all(candidates.map(s => getSourceDocuments(s, resolved.params)))
  let merged = results
    .filter(r => r.success && Array.isArray(r.data))
    .flatMap(r => r.data as any[])

  if (resolved.source === "articles_latest" && resolved.params.section_id) {
    const normSection = normalizeArabic(resolved.params.section_id)
    merged = merged.filter(item =>
      Array.isArray(item?.sections) &&
      item.sections.some((section: any) => {
        const sectionId = String(section?.id || "").trim()
        const sectionName = String(section?.name || "").trim()
        return sectionId === resolved.params.section_id || normalizeArabic(sectionName) === normSection
      })
    )
  }

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
      source_used: resolved.source,
      candidate_sources: candidates,
      matched_category: resolved.matchedCategory?.name
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

async function discoverEntities(query: string): Promise<APICallResult> {
  const projectsResult = await getAllProjects()
  const projects = projectsResult.success && Array.isArray(projectsResult.data)
    ? (projectsResult.data as any[])
    : []

  const entities = projects.map((p: any) => ({
    name: p.name,
    type: Array.isArray(p.sections)
      ? p.sections.map((s: any) => (typeof s === "string" ? s : s.name)).filter(Boolean)
      : [],
  }))

  return {
    success: entities.length > 0,
    data: { query, total: entities.length, entities },
    ...(entities.length === 0 && { error: "الفهرس غير متاح حالياً، جرّب البحث المباشر" }),
  }
}

/**
 * بناء مقتطف نصي مضغوط من فهرس الكيانات ليُحقن في system prompt
 * يعيد سلسلة نصية جاهزة أو سلسلة فارغة إذا لم تكن البيانات محملة بعد
 */
export async function buildEntityCatalogSnippet(): Promise<string> {
  const result = await getAllProjects()
  if (!result.success || !Array.isArray(result.data) || result.data.length === 0) return ""

  const lines = (result.data as any[]).map((p: any) => {
    const sections = Array.isArray(p.sections)
      ? p.sections.map((s: any) => (typeof s === "string" ? s : s.name)).filter(Boolean).join("، ")
      : ""
    return sections ? `- ${p.name} [${sections}]` : `- ${p.name}`
  })

  return `\n\n## فهرس الكيانات المتاحة في قاعدة البيانات\nاستخدم الأسماء الدقيقة أدناه عند صياغة استعلامات البحث:\n${lines.join("\n")}`
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
      case "discover_entities":
        return await discoverEntities(args.query || "")

      case "search_projects":
        return await siteSearch(args.query, args.section, args.limit)

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
          id: args.id,
          query: args.query
        })

      case "get_latest_by_source":
        return await siteGetLatestBySource(args.source || "auto", args.limit, {
          category_id: args.category_id,
          section_id: args.section_id,
          id: args.id,
          query: args.query
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
