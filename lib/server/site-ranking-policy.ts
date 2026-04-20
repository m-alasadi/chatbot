import { type RetrievalCapabilitySignals } from "./query-understanding"
import { type SiteSourceName, type SourceFetchParams, EXPANDABLE_SOURCES } from "./site-source-adapters"

// ── Arabic normalization utilities ──────────────────────────────────

/** Full Arabic normalization: lowercase, strip diacritics/tatweel, normalize letter forms */
export function normalizeArabic(text: string): string {
  return (text || "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "") // strip tashkeel
    .replace(/\u0640/g, "")                               // strip tatweel
    .replace(/[\u0622\u0623\u0625\u0627]/g, "\u0627")      // normalize alef variants → ا
    .replace(/\u0649/g, "\u064A")                           // ى → ي
    .replace(/\u0629/g, "\u0647")                           // ة → ه
    .replace(/\s+/g, " ")                                   // collapse whitespace
    .trim()
    .toLowerCase()
}

/** Tokenize an Arabic query into meaningful search tokens (≥2 chars) */
export function tokenizeArabicQuery(query: string): string[] {
  return normalizeArabic(query)
    .split(/\s+/)
    .filter(w => w.length >= 2)
}

export function extractNamedPhrase(query: string): string {
  const norm = normalizeArabic(query)
  if (norm.includes(normalizeArabic("نداء العقيدة"))) {
    return normalizeArabic("نداء العقيدة")
  }
  if (norm.includes(normalizeArabic("أسبوع الإمامة")) || norm.includes(normalizeArabic("اسبوع الامامة"))) {
    return normalizeArabic("أسبوع الإمامة")
  }
  if (norm.includes(normalizeArabic("الزيارة بالنيابة"))) {
    return normalizeArabic("الزيارة بالنيابة")
  }

  const removablePrefixes = [
    "ماهي", "ماهو",
    "ما هي", "ما هو", "ما اسم", "من هو", "من هي", "كيف أستخدم", "كيف استخدم", "كيف", "صف لي", "صف", "وصف", "اين يقام", "اين", "هل", "كم", "عدد لي", "عدد", "لخص لي",
    "اشرح لي باختصار حول", "اشرح لي حول", "اشرح لي عن", "اشرح لي", "اشرح",
    "تكلم لي عن", "تكلم عن", "تكلم لي", "حدثني عن", "اخبرني عن", "عرفني على",
    "ابحث عن خبر قديم يتحدث عن", "ابحث عن خبر يتحدث عن", "ابحث عن خبر قديم", "ابحث عن خبر", "ابحث عن"
  ]

  let cleaned = norm
  for (const prefix of removablePrefixes) {
    if (cleaned.startsWith(normalizeArabic(prefix))) {
      cleaned = cleaned.substring(normalizeArabic(prefix).length).trim()
      break
    }
  }

  const removableFillers = [
    "ماهي", "ماهو",
    "لعتبه", "للعتبه", "العتبه", "العباسيه", "العباسية",
    "ما", "هو", "هي", "من", "عن", "في", "على", "هل", "يوجد", "لي", "حول", "باختصار", "مختصر",
    "تكلم", "اشرح", "حدثني", "اخبرني", "عرفني", "ابحث", "خبر", "قديم", "يتحدث", "كيف", "استخدم", "أستخدم", "صف", "وصف",
    "عليه", "السلام", "عليها"
  ]
  const tokens = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .filter(t => !removableFillers.includes(t))

  if (tokens.length < 2) return ""
  return tokens.slice(0, 4).join(" ")
}

/**
 * Detect whether the query looks like a (partial) article title rather than a question.
 * Title-like queries are long Arabic phrases without interrogative structure.
 */
export function looksLikeTitleQuery(query: string): boolean {
  const trimmed = (query || "").trim()
  if (trimmed.length < 20) return false

  const norm = normalizeArabic(trimmed)

  // Question / command prefixes → NOT a title
  const questionPrefixes = [
    "ما هو", "ما هي", "من هو", "من هي", "كيف", "لماذا", "متي",
    "اين", "هل", "كم", "ابحث", "اعرض", "اعطني", "تحدث", "اريد",
    "عرف", "وضح", "اشرح", "ما الذي", "ما هو عدد"
  ]
  if (questionPrefixes.some(q => norm.startsWith(normalizeArabic(q)))) return false

  // Any question mark → not a title
  if (trimmed.includes("?") || trimmed.includes("\u061F")) return false

  // Must be majority Arabic characters
  const arabicChars = (trimmed.match(/[\u0600-\u06FF]/g) || []).length
  if (arabicChars / trimmed.replace(/\s/g, "").length < 0.5) return false

  // Long enough and no question markers anywhere → likely a title
  if (trimmed.length >= 30) return true

  // Medium length (20-29 chars): accept only if no question words appear at all
  const anyQuestion = questionPrefixes.some(q => norm.includes(normalizeArabic(q)))
  return !anyQuestion
}

/**
 * Title-specific scorer: measures how closely an item's title matches the query.
 * Returns 0–100.  50+ = confident match.
 */
export function scoreTitleMatch(item: any, query: string): number {
  const normQ = normalizeArabic(query)
  const normTitle = normalizeArabic(item?.name || "")
  if (!normQ || !normTitle) return 0

  // Exact match
  if (normTitle === normQ) return 100
  // Title contains the full query
  if (normTitle.includes(normQ)) return 85
  // Query contains the full title
  if (normQ.includes(normTitle) && normTitle.length > 10) return 75

  // Token overlap ratio
  const qTokens = tokenizeArabicQuery(query)
  const tTokens = new Set(tokenizeArabicQuery(item?.name || ""))
  if (qTokens.length === 0 || tTokens.size === 0) return 0

  let matchCount = 0
  for (const t of qTokens) {
    for (const tt of tTokens) {
      if (tt.includes(t) || t.includes(tt)) { matchCount++; break }
    }
  }

  const ratio = matchCount / qTokens.length
  if (ratio >= 0.85) return 65
  if (ratio >= 0.7)  return 50
  if (ratio >= 0.5)  return 30
  if (ratio >= 0.3)  return 15
  return 0
}

/** Returns true only when the query clearly asks for categories / sections / classifications */
export function isCategoryIntent(query: string): boolean {
  const norm = normalizeArabic(query)
  const categoryKeywords = [
    "الاقسام", "التصنيفات", "الفئات",
    "اقسام الفيديو", "اقسام التاريخ", "اقسام الاخبار",
    "ما هي الاقسام", "ما هي التصنيفات", "ما هي الفئات",
    "قائمه الاقسام", "قائمه التصنيفات"
  ]
  return categoryKeywords.some(kw => norm.includes(normalizeArabic(kw)))
}

function isShrineLifecycleHistoryQuery(normQuery: string): boolean {
  const shrineSignals = [
    "العتبه", "العتبة", "العباسيه", "العباسية", "الحرم", "المرقد", "الضريح",
    "قبر العباس", "ابي الفضل", "أبي الفضل", "ابو الفضل", "أبو الفضل"
  ]
  const historicalFrameSignals = ["مراحل", "تاريخ", "تأريخ", "هدم", "عدوان", "اعتداء", "بناء"]
  const structuralSignals = ["بناء", "هدم", "اعمار", "إعمار", "ترميم", "تشييد", "عدوان", "اعتداء"]
  const explicitProjectSignals = ["مشاريع", "مشروع", "توسعه", "توسعة"]

  const hasShrineContext = shrineSignals.some(signal => normQuery.includes(normalizeArabic(signal)))
  const hasHistoricalFrame = historicalFrameSignals.some(signal => normQuery.includes(normalizeArabic(signal)))
  const hasStructuralSignal = structuralSignals.some(signal => normQuery.includes(normalizeArabic(signal)))
  const explicitProjectLookup = explicitProjectSignals.some(signal => normQuery.includes(normalizeArabic(signal)))

  return hasShrineContext && hasHistoricalFrame && hasStructuralSignal && !explicitProjectLookup
}

// ── Stronger multi-field scoring ────────────────────────────────────

interface WeightedField { text: string; weight: number }

/** Extract all searchable text fields from a unified item with weights */
function getItemSearchFields(item: any): WeightedField[] {
  const out: WeightedField[] = []
  if (item?.name)        out.push({ text: normalizeArabic(item.name), weight: 10 })
  if (item?.description) out.push({ text: normalizeArabic(item.description), weight: 5 })
  if (item?.address)     out.push({ text: normalizeArabic(item.address), weight: 5 })

  if (Array.isArray(item?.sections)) {
    for (const s of item.sections) {
      if (s?.name) out.push({ text: normalizeArabic(s.name), weight: 2 })
    }
  }
  if (Array.isArray(item?.properties)) {
    for (const p of item.properties) {
      if (p?.name) out.push({ text: normalizeArabic(p.name), weight: 3 })
      const val = p?.pivot?.value || p?.value
      if (typeof val === "string") out.push({ text: normalizeArabic(val), weight: 4 })
    }
  }
  if (Array.isArray(item?.kftags)) {
    for (const t of item.kftags) {
      if (t?.title) out.push({ text: normalizeArabic(t.title), weight: 3 })
      if (t?.name)  out.push({ text: normalizeArabic(t.name), weight: 3 })
    }
  }

  // source_raw extras (caption/summary) — weak
  const raw = item?.source_raw
  if (raw) {
    if (raw.caption)  out.push({ text: normalizeArabic(raw.caption), weight: 2 })
    if (raw.summary)  out.push({ text: normalizeArabic(raw.summary), weight: 2 })
  }

  // source_type only as very weak signal
  if (item?.source_type) out.push({ text: normalizeArabic(item.source_type), weight: 1 })

  return out
}

export function scoreUnifiedItem(item: any, query: string): number {
  const normQ = normalizeArabic(query)
  if (!normQ) return 1

  const tokens = tokenizeArabicQuery(query)
  const combinedPrimaryText = normalizeArabic([
    item?.name || "",
    item?.description || "",
    item?.source_raw?.caption || "",
    item?.source_raw?.summary || "",
    item?._snippet || ""
  ].join(" "))
  const namedPhrase = extractNamedPhrase(query)
  const normTitle = normalizeArabic(item?.name || "")
  const itemSections = Array.isArray(item?.sections)
    ? item.sections.map((section: any) => normalizeArabic(section?.name || ""))
    : []
  const fields = getItemSearchFields(item)
  const isOfficialSearchHit = item?.source_raw?.official_search === true
  const officialSearchQuery = normalizeArabic(String(item?.source_raw?.query || ""))
  const shrineLifecycleHistoryQuery = isShrineLifecycleHistoryQuery(normQ)
  const historicalFramingSignals = [
    "لمحه تاريخيه", "لمحة تاريخية", "لمحه تأريخيه", "لمحة تأريخية",
    "الجزء", "بين مراحل", "عمليات الاعمار", "عبر التاريخ", "التاريخيه", "التاريخية"
  ]
  const eventExhibitSignals = ["معرض", "مهرجان", "فعاليه", "فعالية", "تركيا", "رسوم", "ثلاثيه الابعاد", "ثلاثية الابعاد", "لوحات", "لاول مره", "لأول مرة"]
  const currentProjectSignals = [
    "مشروع", "مشاريع", "يقطع مراحل متقدمه", "يقطع مراحل متقدمة", "نسبه انجاز", "نسبة انجاز",
    "افتتاح", "اواوين", "الأواوين", "الطابق الثاني", "وضع حجر", "انجاز"
  ]
  const hasHistoricalFraming = historicalFramingSignals.some(signal => combinedPrimaryText.includes(normalizeArabic(signal)))
  const isEventExhibitLikeResult = eventExhibitSignals.some(signal => combinedPrimaryText.includes(normalizeArabic(signal)))
  const isCurrentProjectLikeResult = currentProjectSignals.some(signal => combinedPrimaryText.includes(normalizeArabic(signal)))
  const shrineSpecificAbbasSignals = ["العتبه العباسيه", "العتبة العباسية", "ابي الفضل", "أبي الفضل", "ابو الفضل", "أبو الفضل", "العباس"]
  const hasAbbasSpecificSubject = shrineSpecificAbbasSignals.some(signal => combinedPrimaryText.includes(normalizeArabic(signal)))
  const queryRequestsAbbasSubject =
    normQ.includes(normalizeArabic("العتبه العباسيه")) ||
    normQ.includes(normalizeArabic("العتبة العباسية")) ||
    normQ.includes(normalizeArabic("قبر العباس")) ||
    normQ.includes(normalizeArabic("ابي الفضل")) ||
    normQ.includes(normalizeArabic("أبي الفضل")) ||
    normQ.includes(normalizeArabic("ابو الفضل")) ||
    normQ.includes(normalizeArabic("أبو الفضل")) ||
    (
      normQ.includes(normalizeArabic("العتبه")) &&
      normQ.includes(normalizeArabic("العباسيه"))
    ) ||
    (
      normQ.includes(normalizeArabic("العتبة")) &&
      normQ.includes(normalizeArabic("العباسية"))
    )
  const mentionsHusseinOnlySubject =
    combinedPrimaryText.includes(normalizeArabic("الامام الحسين")) &&
    !combinedPrimaryText.includes(normalizeArabic("ابي الفضل")) &&
    !combinedPrimaryText.includes(normalizeArabic("أبي الفضل")) &&
    !combinedPrimaryText.includes(normalizeArabic("ابو الفضل")) &&
    !combinedPrimaryText.includes(normalizeArabic("أبو الفضل")) &&
    !combinedPrimaryText.includes(normalizeArabic("قبر العباس"))
  const isHistorySource =
    item?.source_type === "shrine_history_timeline" ||
    item?.source_type === "shrine_history_by_section" ||
    item?.source_type === "shrine_history_sections" ||
    item?.source_type === "abbas_history_by_id" ||
    itemSections.some((section: string) => section.includes(normalizeArabic("تاريخ")))
  const explicitShrineDescriptionQuery =
    !normQ.includes(normalizeArabic("خبر")) &&
    !normQ.includes(normalizeArabic("اخبار")) &&
    (
      normQ.includes(normalizeArabic("صف")) ||
      normQ.includes(normalizeArabic("وصف")) ||
      normQ.includes(normalizeArabic("نبذه")) ||
      normQ.includes(normalizeArabic("نبذة")) ||
      normQ.includes(normalizeArabic("ملخص")) ||
      normQ.includes(normalizeArabic("مختصر"))
    ) &&
    (
      normQ.includes(normalizeArabic("العتبة العباسية")) ||
      normQ.includes(normalizeArabic("العتبه العباسيه")) ||
      (
        normQ.includes(normalizeArabic("العتبة")) &&
        normQ.includes(normalizeArabic("العباسية"))
      )
    )
  const explicitShrineHistoryQuery =
    (
      normQ.includes(normalizeArabic("تاريخ العتبة")) ||
      normQ.includes(normalizeArabic("تاريخ العتبه")) ||
      (
        normQ.includes(normalizeArabic("تاريخ")) &&
        (
          normQ.includes(normalizeArabic("العتبة")) ||
          normQ.includes(normalizeArabic("العتبه")) ||
          normQ.includes(normalizeArabic("السدانة")) ||
          normQ.includes(normalizeArabic("سدنة")) ||
          normQ.includes(normalizeArabic("الحرم"))
        )
      )
    ) &&
    !normQ.includes(normalizeArabic("خبر"))
  let score = 0
  let matchedTokenCount = 0
  let hasSpecificNamedPhrase = false

  const genericTokens = new Set([
    "ماهي", "ماهو",
    "ما", "اسم", "من", "هو", "هي", "هل", "اين", "يقام", "كم", "عدد", "لي", "عن", "في", "على",
    "هن", "له", "لها", "لهم", "العتبه", "العتبة", "العباسيه", "العباسية", "مشروع", "مشاريع", "خبر", "قديم", "يتحدث",
    "تكلم", "اشرح", "حدثني", "اخبرني", "حول", "باختصار", "اعطني", "اعرض", "عليه", "السلام"
  ])
  const specificTokens = tokens.filter(t => !genericTokens.has(t))
  const projectDomainTokens = [
    "دجاج", "زراعي", "انتاج", "غذايي", "تعليمي", "تربوي", "تصنيع",
    "اعمار", "ترميم", "صيانه", "تشييد", "بناء", "توسعه", "توسعة"
  ]
  const requestedProjectDomainTokens = projectDomainTokens.filter(t => normQ.includes(t))
  let matchedSpecificToken = false
  let matchedProjectDomainToken = false
  let matchedSpecificTokenCount = 0

  const titleSpecificMatchCount = specificTokens.filter(tok => normTitle.includes(tok)).length
  const namedPhraseTokens = namedPhrase ? tokenizeArabicQuery(namedPhrase) : []
  const namedPhraseTokenCoverage =
    namedPhraseTokens.length > 0
      ? namedPhraseTokens.filter(tok => normTitle.includes(tok)).length / namedPhraseTokens.length
      : 0
  const isOfficeHolderQuery =
    normQ.includes(normalizeArabic("المتولي الشرعي")) ||
    (normQ.includes(normalizeArabic("المتولي")) && normQ.includes(normalizeArabic("الشرعي")))
  const isNamedPersonQuery =
    specificTokens.length >= 2 &&
    [
      "الشيخ", "السيد", "الامام", "الإمام", "سماحه", "سماحة", "العلامه", "العلامة"
    ].some(token => normQ.includes(normalizeArabic(token)))
  const isNamedHistoryEntityQuery =
    (specificTokens.length >= 2 && ["سدنه", "السدنه", "كلدار", "اخوات", "اخوه", "زوجته", "زوجات"].some(token => normQ.includes(normalizeArabic(token)))) ||
    (namedPhraseTokens.length >= 2 && ["سدنه", "كلدار", "اخوات"].some(token => namedPhrase.includes(normalizeArabic(token))))
  const requiresStrictSpecificCoverage =
    specificTokens.length >= 2 || isNamedPersonQuery || isNamedHistoryEntityQuery || isOfficeHolderQuery

  if ((explicitShrineHistoryQuery || explicitShrineDescriptionQuery) && !isHistorySource) {
    return 0
  }

  if (
    shrineLifecycleHistoryQuery &&
    isOfficialSearchHit &&
    queryRequestsAbbasSubject &&
    !hasAbbasSpecificSubject
  ) {
    return 0
  }

  if (
    shrineLifecycleHistoryQuery &&
    isOfficialSearchHit &&
    (isEventExhibitLikeResult || isCurrentProjectLikeResult || mentionsHusseinOnlySubject) &&
    !hasHistoricalFraming
  ) {
    return 0
  }

  for (const { text, weight } of fields) {
    if (!text) continue
    // Full query match — highest boost
    if (text.includes(normQ)) score += weight * 4

    if (namedPhrase && text.includes(namedPhrase)) {
      score += weight * 6
      hasSpecificNamedPhrase = true
    }

    // Per-token matching
    for (const tok of tokens) {
      if (text.includes(tok)) {
        score += weight
        matchedTokenCount++
        if (!matchedSpecificToken && specificTokens.includes(tok)) {
          matchedSpecificToken = true
        }
        if (specificTokens.includes(tok)) {
          matchedSpecificTokenCount++
        }
        if (!matchedProjectDomainToken && requestedProjectDomainTokens.includes(tok)) {
          matchedProjectDomainToken = true
        }
      }
    }
  }

  if (isOfficialSearchHit) {
    score += 8
    if (officialSearchQuery && (normQ.includes(officialSearchQuery) || officialSearchQuery.includes(normQ))) {
      score += 4
    }
    if (specificTokens.length > 0 && specificTokens.some(token => officialSearchQuery.includes(token))) {
      score += 2
    }
  }

  // Bonus when ALL tokens matched somewhere
  if (tokens.length > 1 && matchedTokenCount >= tokens.length) {
    score += 8
  }

  if (hasSpecificNamedPhrase) {
    score += 10
  }

  if (shrineLifecycleHistoryQuery && hasHistoricalFraming) {
    score += 16
  }

  if (shrineLifecycleHistoryQuery && hasAbbasSpecificSubject) {
    score += 10
  }

  if (explicitShrineDescriptionQuery && isHistorySource) {
    score += 16
  } else if (explicitShrineHistoryQuery && isHistorySource) {
    score += 14
  } else if (normQ.includes(normalizeArabic("تاريخ")) && isHistorySource) {
    score += 6
  }

  // For named-entity lookups, phrase mismatch means the item is irrelevant,
  // unless the title already covers most phrase tokens (for example: "مراحل الهدم"
  // should still match a query phrased as "مراحل هدم").
  const hasStrongNamedPhraseTokenCoverage =
    namedPhraseTokens.length >= 2 &&
    (namedPhraseTokenCoverage >= 0.75 || titleSpecificMatchCount >= Math.min(2, namedPhraseTokens.length))

  if (
    namedPhrase &&
    !hasSpecificNamedPhrase &&
    !hasStrongNamedPhraseTokenCoverage &&
    (!isOfficialSearchHit || namedPhraseTokens.length >= 2)
  ) {
    return 0
  }

  if (specificTokens.length > 0 && !matchedSpecificToken && !hasSpecificNamedPhrase && !isOfficialSearchHit) {
    return 0
  }

  if (requiresStrictSpecificCoverage) {
    const minimumSpecificMatches = Math.min(2, specificTokens.length)
    if (matchedSpecificTokenCount < minimumSpecificMatches && titleSpecificMatchCount < minimumSpecificMatches && !hasSpecificNamedPhrase) {
      return 0
    }
  }

  // Project/business-domain lookups must preserve the requested domain term.
  if (requestedProjectDomainTokens.length > 0 && !matchedProjectDomainToken) {
    return 0
  }

  // Penalty: if score only came from weak section/source_type matches
  if (score > 0 && score <= 4) {
    score = Math.max(1, score - 1)
  }

  return score
}

// ── Evidence snippet builder ────────────────────────────────────────

/** Build a short evidence snippet showing where the query matched in the item */
export function buildEvidenceSnippet(item: any, query: string): string {
  const normQ = normalizeArabic(query)
  const tokens = tokenizeArabicQuery(query)
  if (!normQ && tokens.length === 0) return ""

  // Candidate raw text fields to extract snippet from, ordered by relevance
  const rawCandidates: { raw: string; weight: number }[] = []
  if (item?.name)        rawCandidates.push({ raw: item.name, weight: 10 })
  if (item?.description) rawCandidates.push({ raw: item.description, weight: 5 })
  if (item?.address)     rawCandidates.push({ raw: item.address, weight: 4 })
  const rawSrc = item?.source_raw
  if (rawSrc?.text)      rawCandidates.push({ raw: rawSrc.text, weight: 3 })
  if (rawSrc?.caption)   rawCandidates.push({ raw: rawSrc.caption, weight: 2 })
  if (rawSrc?.summary)   rawCandidates.push({ raw: rawSrc.summary, weight: 2 })
  if (rawSrc?.content)   rawCandidates.push({ raw: rawSrc.content, weight: 2 })

  // Find best matching field
  let bestSnippet = ""
  let bestScore = -1

  for (const { raw, weight } of rawCandidates) {
    if (!raw || typeof raw !== "string") continue
    const norm = normalizeArabic(raw)
    let fieldScore = 0
    let matchPos = -1

    const fullIdx = norm.indexOf(normQ)
    if (fullIdx !== -1) {
      fieldScore = weight * 4
      matchPos = fullIdx
    } else {
      for (const tok of tokens) {
        const idx = norm.indexOf(tok)
        if (idx !== -1) {
          fieldScore += weight
          if (matchPos === -1) matchPos = idx
        }
      }
    }

    if (fieldScore > bestScore) {
      bestScore = fieldScore
      // Extract a window around the match in the ORIGINAL (non-normalized) text
      if (matchPos !== -1) {
        const WINDOW = 120
        const start = Math.max(0, matchPos - 30)
        const end = Math.min(raw.length, matchPos + WINDOW)
        bestSnippet = (start > 0 ? "…" : "") + raw.slice(start, end).trim() + (end < raw.length ? "…" : "")
      } else {
        bestSnippet = raw.slice(0, 150).trim() + (raw.length > 150 ? "…" : "")
      }
    }
  }

  return bestSnippet
}

// ── Weighted candidate source ranking ───────────────────────────────

interface SourceScore { source: SiteSourceName; score: number }

type RankingCapabilitySignals = Pick<
  RetrievalCapabilitySignals,
  "office_holder_fact" | "named_event_or_program" | "singular_project_lookup"
>

/** Rank candidate sources by query affinity instead of simple if/else branches */
export function rankCandidateSources(
  query: string,
  params: SourceFetchParams = {},
  capability?: RankingCapabilitySignals
): SiteSourceName[] {
  const norm = normalizeArabic(query)
  const scores: SourceScore[] = []

  // Always include articles as baseline
  scores.push({ source: "articles_latest", score: 5 })

  // Video signals
  const videoHints = ["فيديو", "فديو", "مرئي", "يوتيوب", "مقطع", "مشاهده"]
  const videoBoost = videoHints.reduce((acc, h) => acc + (norm.includes(normalizeArabic(h)) ? 6 : 0), 0)
  scores.push({ source: "videos_latest", score: 3 + videoBoost })
  if (params.category_id) scores.push({ source: "videos_by_category", score: 4 + videoBoost })
  if (isCategoryIntent(query)) scores.push({ source: "videos_categories", score: 2 + videoBoost })

  // History signals
  const historyHints = ["تاريخ", "سيره", "العباس", "العتبه", "ابو الفضل", "تاريخي"]
  const histBoost = historyHints.reduce((acc, h) => acc + (norm.includes(normalizeArabic(h)) ? 5 : 0), 0)
  if (histBoost > 0) scores.push({ source: "shrine_history_timeline", score: 8 + histBoost })
  if (params.section_id) scores.push({ source: "shrine_history_by_section", score: 4 + histBoost })
  if (params.id) scores.push({ source: "abbas_history_by_id", score: 4 + histBoost })
  if (isCategoryIntent(query) && histBoost > 0) scores.push({ source: "shrine_history_sections", score: 2 + histBoost })

  // Abbas / broad biography intent — even without params, include sections for auto-resolution
  const abbasHints = ["العباس", "ابو الفضل", "ابا الفضل", "ابوالفضل"]
  const isAbbasIntent = abbasHints.some(h => norm.includes(normalizeArabic(h)))
  if (isAbbasIntent && !params.section_id && !params.id) {
    scores.push({ source: "shrine_history_timeline", score: 5 + histBoost })
    scores.push({ source: "shrine_history_sections", score: 6 + histBoost })
  }

  // Friday sermon signals
  const sermonHints = ["خطبه", "خطب", "جمعه", "صلاه الجمعه", "وحي الجمعه", "خطيب"]
  const sermonBoost = sermonHints.reduce((acc, h) => acc + (norm.includes(normalizeArabic(h)) ? 6 : 0), 0)
  if (sermonBoost > 0) {
    const isExplicitWahy =
      norm.includes(normalizeArabic("من وحي")) ||
      norm.includes(normalizeArabic("وحي الجمعه"))
    const isExplicitSermon =
      norm.includes(normalizeArabic("خطب")) ||
      norm.includes(normalizeArabic("خطبه")) ||
      norm.includes(normalizeArabic("خطيب"))

    const wahyBias = isExplicitWahy ? 4 : 0
    const sermonBias = isExplicitSermon ? 4 : 0

    scores.push({ source: "friday_sermons", score: 6 + sermonBoost + sermonBias })
    scores.push({ source: "wahy_friday", score: 5 + sermonBoost + wahyBias })
  }

  // Office-holder facts + named initiatives/events
  const officeHolderHints = ["المتولي", "المتولي الشرعي", "الامين العام", "امين عام", "مسؤول"]
  const officeBoost = capability?.office_holder_fact
    ? 14
    : officeHolderHints.reduce((acc, h) => acc + (norm.includes(normalizeArabic(h)) ? 7 : 0), 0)
  if (officeBoost > 0) {
    scores.push({ source: "articles_latest", score: 8 + officeBoost })
    scores.push({ source: "shrine_history_timeline", score: 7 + officeBoost })
    scores.push({ source: "shrine_history_sections", score: 6 + officeBoost })
  }

  const namedEventHints = ["نداء العقيده", "نداء العقيدة", "مهرجان", "فعاليه", "فعالية", "مبادره", "مبادرة", "برنامج"]
  const eventBoost = capability?.named_event_or_program
    ? 14
    : namedEventHints.reduce((acc, h) => acc + (norm.includes(normalizeArabic(h)) ? 7 : 0), 0)
  if (eventBoost > 0) {
    scores.push({ source: "articles_latest", score: 8 + eventBoost })
    scores.push({ source: "videos_latest", score: 7 + eventBoost })
    scores.push({ source: "wahy_friday", score: 5 + eventBoost })
    scores.push({ source: "friday_sermons", score: 5 + eventBoost })
  }

  const singularProjectHints = ["مشروع ", "مشروع", "دجاج", "زراعي", "انتاج", "إنتاج", "تربية"]
  const projectBoost = capability?.singular_project_lookup
    ? 10
    : singularProjectHints.reduce((acc, h) => acc + (norm.includes(normalizeArabic(h)) ? 5 : 0), 0)
  if (projectBoost > 0) {
    scores.push({ source: "articles_latest", score: 7 + projectBoost })
    scores.push({ source: "videos_latest", score: 5 + projectBoost })
  }

  // Language signals
  const langHints = ["ترجمه", "لغه", "كلمه", "مصطلح", "معني", "قاموس"]
  const langBoost = langHints.reduce((acc, h) => acc + (norm.includes(normalizeArabic(h)) ? 6 : 0), 0)
  if (langBoost > 0) scores.push({ source: "lang_words_ar", score: 4 + langBoost })
  else scores.push({ source: "lang_words_ar", score: 1 })

  // Sort by score desc, take top 4
  scores.sort((a, b) => b.score - a.score)

  // Deduplicate and return
  const seen = new Set<SiteSourceName>()
  const ranked: SiteSourceName[] = []
  for (const { source } of scores) {
    if (!seen.has(source)) {
      seen.add(source)
      ranked.push(source)
    }
  }
  return ranked.slice(0, 4)
}

/** Expand search by fetching additional pages from expandable sources (parallel batches) */
export async function expandSearchFromSources(
  sources: SiteSourceName[],
  params: SourceFetchParams,
  alreadySeen: Map<string, any>,
  fetchMetadata: (source: SiteSourceName) => Promise<{ total: number; per_page: number; current_page: number; last_page: number }>,
  fetchPage: (source: SiteSourceName, page: number, params?: SourceFetchParams) => Promise<any[]>
): Promise<any[]> {
  const extra: any[] = []
  const MAX_EXPANSION_PAGE = 6
  const BATCH = 5

  for (const s of sources) {
    const meta = await fetchMetadata(s)
    const maxPage = Math.min(meta.last_page, MAX_EXPANSION_PAGE)

    for (let batchStart = 2; batchStart <= maxPage; batchStart += BATCH) {
      const batchEnd = Math.min(batchStart + BATCH - 1, maxPage)
      const pages = Array.from({ length: batchEnd - batchStart + 1 }, (_, i) => batchStart + i)
      const batchResults = await Promise.all(pages.map(p => fetchPage(s, p, params)))

      for (const items of batchResults) {
        for (const item of items) {
          const key = `${item?.source_type || "source"}:${item?.id || item?.name || Math.random()}`
          if (!alreadySeen.has(key)) {
            alreadySeen.set(key, item)
            extra.push(item)
          }
        }
      }
    }
  }
  return extra
}

// ── Deep title search (parallel batch scanning) ─────────────────────

/**
 * Scan deep into paginated archives in parallel batches looking for
 * high-confidence title matches.  Used when `looksLikeTitleQuery` is true.
 */
export async function deepTitleSearch(
  query: string,
  sources: SiteSourceName[],
  params: SourceFetchParams,
  alreadySeen: Map<string, any>,
  limit: number,
  fetchMetadata: (source: SiteSourceName) => Promise<{ total: number; per_page: number; current_page: number; last_page: number }>,
  fetchPage: (source: SiteSourceName, page: number, params?: SourceFetchParams) => Promise<any[]>
): Promise<{ item: any; score: number }[]> {
  const MAX_DEEP_PAGE = 150
  const BATCH_SIZE = 10
  const HIGH_CONFIDENCE = 50

  const hits: { item: any; score: number }[] = []

  for (const source of sources) {
    if (!EXPANDABLE_SOURCES.includes(source)) continue

    const meta = await fetchMetadata(source)
    if (meta.last_page <= 1) continue

    // Build page ranges for both directions
    const newestMax = Math.min(meta.last_page, MAX_DEEP_PAGE)
    const oldestStart = meta.last_page
    const oldestMin = Math.max(1, meta.last_page - MAX_DEEP_PAGE + 1)

    let foundHigh = false
    let newestPage = 2
    let oldestPage = oldestStart

    while (!foundHigh && (newestPage <= newestMax || oldestPage >= oldestMin)) {
      const pagesToFetch: number[] = []

      // Add a batch from the newest direction
      for (let i = 0; i < BATCH_SIZE && newestPage <= newestMax; i++, newestPage++) {
        pagesToFetch.push(newestPage)
      }
      // Add a batch from the oldest direction
      for (let i = 0; i < BATCH_SIZE && oldestPage >= oldestMin; i++, oldestPage--) {
        if (!pagesToFetch.includes(oldestPage)) pagesToFetch.push(oldestPage)
      }

      if (pagesToFetch.length === 0) break

      const batchResults = await Promise.all(
        pagesToFetch.map(p => fetchPage(source, p, params))
      )

      for (const items of batchResults) {
        for (const item of items) {
          const key = `${item?.source_type || "source"}:${item?.id || item?.name || Math.random()}`
          if (alreadySeen.has(key)) continue
          alreadySeen.set(key, item)

          const ts = scoreTitleMatch(item, query)
          if (ts > 0) {
            const gs = scoreUnifiedItem(item, query)
            hits.push({ item, score: Math.max(ts, gs) })
            if (ts >= HIGH_CONFIDENCE) foundHigh = true
          }
        }
      }
    }
  }

  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}
