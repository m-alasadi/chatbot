/**
 * LLM Intent Resolver — Fallback layer for the regex-based intent stack.
 *
 * Problem it solves:
 *   The regex layer fails on any query where a key-word token is misspelled
 *   (typo_drop_char / typo_double_char / typo_swap_adjacent).  The LLM
 *   understands semantics and handles those transparently.
 *
 * Design contract:
 *   - Pure function: resolveIntentWithLLM(query, openaiApiKey, model)
 *   - Only called when the regex pass returns route_confidence < THRESHOLD.
 *   - Returns a LLMIntentPatch that is MERGED (not replaced) over the
 *     regex result in understandQueryWithFallback().
 *   - Results are cached in-process (simple Map, max 500 entries, 30 min TTL).
 *   - If the LLM call fails for any reason, returns null silently — the
 *     caller falls back to the original regex result.
 *
 * Disabled by default. Set env ENABLE_LLM_INTENT_FALLBACK=true to activate.
 */

import type {
  QueryContentIntent,
  QueryOperationIntent,
  QueryClarity,
  QueryUnderstandingResult,
} from "../server/query-understanding"
import type { PersonRelationSlot } from "./paraphrase-intent"

// ── Schema returned by the LLM ───────────────────────────────────────

export interface LLMIntentPatch {
  content_intent: QueryContentIntent
  operation_intent: QueryOperationIntent
  clarity: QueryClarity
  person_relation_slot: PersonRelationSlot | null
  is_biography: boolean
  is_institutional: boolean
  is_small_talk: boolean
  person: string[]
  topic: string[]
  llm_confidence: number
}

// ── In-process cache ─────────────────────────────────────────────────

const CACHE_MAX = 500
const CACHE_TTL_MS = 30 * 60 * 1000

type CacheEntry = { patch: LLMIntentPatch; ts: number }
const _cache = new Map<string, CacheEntry>()

function cacheGet(key: string): LLMIntentPatch | null {
  const e = _cache.get(key)
  if (!e) return null
  if (Date.now() - e.ts > CACHE_TTL_MS) { _cache.delete(key); return null }
  return e.patch
}

function cachePut(key: string, patch: LLMIntentPatch): void {
  if (_cache.size >= CACHE_MAX) {
    const first = _cache.keys().next().value
    if (first !== undefined) _cache.delete(first)
  }
  _cache.set(key, { patch, ts: Date.now() })
}

// ── Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `أنت مصنّف استعلامات لموقع العتبة العباسية المقدسة.
مهمتك: تحليل السؤال العربي وإعادة JSON فقط — بدون أي نص إضافي.

الـ JSON يجب أن يتبع هذا الهيكل تمامًا:
{
  "content_intent": "news"|"video"|"biography"|"history"|"sermon"|"wahy"|"generic",
  "operation_intent": "fact_question"|"list_items"|"latest"|"count"|"summarize"|"explain"|"classify"|"direct_answer"|"browse",
  "clarity": "clear"|"underspecified",
  "person_relation_slot": "father"|"mother"|"wife"|"children"|"brothers"|"sisters"|"uncles"|"aunts"|"titles"|"kunya"|"martyrdom"|"birth"|"age"|"definition"|null,
  "is_biography": true|false,
  "is_institutional": true|false,
  "is_small_talk": true|false,
  "person": ["..."],
  "topic": ["..."],
  "llm_confidence": 0.0-1.0
}

قواعد:
- person_relation_slot: ضعه فقط إذا كان السؤال عن العباس بن علي (ع) بصفته شخصًا (والده/أمه/زوجته/أبناؤه/إلخ). إذا كان عن العتبة كمؤسسة فاجعله null.
- is_biography: true إذا كان السؤال عن سيرة العباس (ع) الشخصية.
- is_institutional: true إذا كان السؤال عن مؤسسات/مرافق/مشاريع تتبع العتبة العباسية.
- is_small_talk: true فقط للتحية/المجاملة/الثرثرة.
- llm_confidence: مدى ثقتك بالتصنيف من 0 إلى 1.
- person: أسماء الأشخاص المذكورين.
- topic: الموضوعات الجوهرية.

مثال إدخال: "منو ابو عباس" (خطأ مطبعي — والد العباس)
مثال إخراج: {"content_intent":"biography","operation_intent":"fact_question","clarity":"clear","person_relation_slot":"father","is_biography":true,"is_institutional":false,"is_small_talk":false,"person":["العباس"],"topic":["الوالد"],"llm_confidence":0.92}
`

// ── Valid value sets (used for validation after parse) ───────────────

const VALID_CONTENT: Set<string> = new Set([
  "news", "video", "biography", "history", "sermon", "wahy", "generic",
])
const VALID_OPERATION: Set<string> = new Set([
  "fact_question", "list_items", "latest", "count", "summarize",
  "explain", "classify", "direct_answer", "browse",
])
const VALID_CLARITY: Set<string> = new Set(["clear", "underspecified"])
const VALID_RELATION_SLOT: Set<string> = new Set([
  "father", "mother", "wife", "children", "brothers", "sisters",
  "uncles", "aunts", "titles", "kunya", "martyrdom", "birth", "age", "definition",
])
// aaaa
function validatePatch(raw: unknown): LLMIntentPatch | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>

  const content_intent = VALID_CONTENT.has(String(o.content_intent))
    ? (o.content_intent as QueryContentIntent)
    : null
  const operation_intent = VALID_OPERATION.has(String(o.operation_intent))
    ? (o.operation_intent as QueryOperationIntent)
    : null
  const clarity = VALID_CLARITY.has(String(o.clarity))
    ? (o.clarity as QueryClarity)
    : null

  if (!content_intent || !operation_intent || !clarity) return null

  const rawSlot = o.person_relation_slot
  const person_relation_slot: PersonRelationSlot | null =
    rawSlot != null && VALID_RELATION_SLOT.has(String(rawSlot))
      ? (rawSlot as PersonRelationSlot)
      : null

  const is_biography = Boolean(o.is_biography)
  const is_institutional = Boolean(o.is_institutional)
  const is_small_talk = Boolean(o.is_small_talk)
  const person = Array.isArray(o.person)
    ? o.person.filter((x): x is string => typeof x === "string")
    : []
  const topic = Array.isArray(o.topic)
    ? o.topic.filter((x): x is string => typeof x === "string")
    : []
  const llm_confidence = typeof o.llm_confidence === "number"
    ? Math.max(0, Math.min(1, o.llm_confidence))
    : 0.7

  return {
    content_intent, operation_intent, clarity,
    person_relation_slot, is_biography, is_institutional, is_small_talk,
    person, topic, llm_confidence,
  }
}

// ── Core resolver ────────────────────────────────────────────────────

/**
 * Call the LLM with a tight JSON prompt and return a structured patch.
 * Returns null on any error (network, parse, validation failure).
 */
export async function resolveIntentWithLLM(
  query: string,
  openaiApiKey: string,
  model = "gpt-4o-mini",
): Promise<LLMIntentPatch | null> {
  // Fast path: empty query
  if (!query.trim()) return null

  // Normalise cache key (strip whitespace variance)
  const cacheKey = query.trim().replace(/\s+/g, " ")
  const cached = cacheGet(cacheKey)
  if (cached) return cached

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 256,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: query.trim() },
        ],
      }),
    })

    if (!response.ok) return null

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data?.choices?.[0]?.message?.content
    if (!content) return null

    let parsed: unknown
    try { parsed = JSON.parse(content) } catch { return null }

    const patch = validatePatch(parsed)
    if (!patch) return null

    cachePut(cacheKey, patch)
    return patch
  } catch {
    // Network error, timeout, etc. — degrade gracefully
    return null
  }
}

// ── Merge helper ─────────────────────────────────────────────────────

/**
 * Merge LLM patch into an existing regex-derived QueryUnderstandingResult.
 *
 * Merge policy:
 *   - content_intent / operation_intent: take LLM value when its confidence > 0.75
 *     OR when the regex value is "generic"/"fact_question" (low-signal defaults).
 *   - clarity: take LLM value.
 *   - person_relation_slot: always take LLM value (this is the main rescue path).
 *   - extracted_entities.person: prepend LLM persons if not already present.
 *   - route_confidence: blend upward when LLM is confident.
 */
export function mergeWithLLMPatch(
  regexResult: QueryUnderstandingResult,
  patch: LLMIntentPatch,
): QueryUnderstandingResult {
  const highConfidence = patch.llm_confidence >= 0.75

  const content_intent =
    (highConfidence || regexResult.content_intent === "generic")
      ? patch.content_intent
      : regexResult.content_intent

  const operation_intent =
    (highConfidence || regexResult.operation_intent === "fact_question")
      ? patch.operation_intent
      : regexResult.operation_intent

  const clarity = patch.clarity

  // Merge person list: add LLM-detected persons not already in the list
  const mergedPerson = [...regexResult.extracted_entities.person]
  for (const p of patch.person) {
    if (!mergedPerson.some(e => e.includes(p) || p.includes(e))) {
      mergedPerson.push(p)
    }
  }

  // Hinted sources: recompute when content_intent changed
  const hinted_sources = deriveHintedSourcesFromPatch(
    content_intent,
    patch.is_biography,
    patch.is_institutional,
    regexResult.hinted_sources,
  )

  // Blend confidence upward
  const blendedConfidence = highConfidence
    ? Math.max(regexResult.route_confidence, patch.llm_confidence * 0.9)
    : regexResult.route_confidence

  return {
    ...regexResult,
    content_intent,
    operation_intent,
    clarity,
    extracted_entities: {
      ...regexResult.extracted_entities,
      person: [...new Set(mergedPerson)],
    },
    hinted_sources,
    route_confidence: Number(blendedConfidence.toFixed(2)),
    // Store slot for downstream consumers (answer-shape-policy etc.)
    person_relation_slot: patch.person_relation_slot,
  } as QueryUnderstandingResult & { person_relation_slot: PersonRelationSlot | null }
}

function deriveHintedSourcesFromPatch(
  contentIntent: QueryContentIntent,
  isBiography: boolean,
  isInstitutional: boolean,
  existingSources: string[],
): string[] {
  const sources: string[] = []
  if (isBiography) {
    sources.push("abbas_history_by_id", "shrine_history_sections")
  }
  switch (contentIntent) {
    case "video":  sources.push("videos_latest"); break
    case "news":   sources.push("articles_latest"); break
    case "biography": sources.push("abbas_history_by_id", "shrine_history_sections"); break
    case "history": sources.push("shrine_history_timeline", "shrine_history_sections"); break
    case "sermon": sources.push("friday_sermons"); break
    case "wahy":   sources.push("wahy_friday"); break
  }
  if (isInstitutional) sources.push("projects_dataset")
  // Keep anything from the original that isn't already covered
  for (const s of existingSources) {
    if (!sources.includes(s)) sources.push(s)
  }
  const AUTO_ALWAYS = "auto"
  if (!sources.includes(AUTO_ALWAYS)) sources.push(AUTO_ALWAYS)
  return [...new Set(sources)]
}

// ── Confidence threshold for triggering LLM ─────────────────────────

/**
 * Returns true when the regex result is weak enough to warrant an LLM pass.
 *
 * Triggers when:
 *   1. route_confidence < 0.55  (regex found no strong intent signals), OR
 *   2. content_intent is "generic" AND query has ≥ 3 tokens (probably needs
 *      deeper understanding, not just underspecified)
 */
export function shouldUseLLMFallback(result: QueryUnderstandingResult): boolean {
  if (process.env.ENABLE_LLM_INTENT_FALLBACK !== "true") return false
  if (result.route_confidence < 0.55) return true
  const tokenCount = result.raw_query.trim().split(/\s+/).length
  if (result.content_intent === "generic" && tokenCount >= 3) return true
  return false
}

// ════════════════════════════════════════════════════════════════════
//  AI-FIRST PRIMARY RESOLVER
// ════════════════════════════════════════════════════════════════════
//
//  Design contract:
//    1. AI is the PRIMARY analyser — it returns a COMPLETE result, not a patch.
//    2. Bounded by a 4 s timeout; failures return null so the caller falls back.
//    3. Cached per normalised query for 30 min (shared process memory).
//    4. Source IDs are validated against the allowed set; unknown IDs are dropped.

// ── Available source IDs (single source of truth for validation) ─────────────
const ALLOWED_SOURCE_IDS = new Set([
  "articles_latest",
  "videos_latest",
  "videos_by_category",
  "videos_categories",
  "friday_sermons",
  "wahy_friday",
  "shrine_history_sections",
  "shrine_history_timeline",
  "shrine_history_by_section",
  "abbas_history_by_id",
  "projects_dataset",
  "lang_words_ar",
  "auto",
])

// ── Mapping from AI content_type → legacy QueryContentIntent ─────────────────
const CONTENT_TYPE_TO_INTENT: Record<string, QueryContentIntent> = {
  news:      "news",
  video:     "video",
  sermon:    "sermon",
  wahy:      "wahy",
  biography: "biography",
  history:   "history",
  project:   "generic",
  article:   "news",
  general:   "generic",
  unknown:   "generic",
}

// ── Full AI result shape ──────────────────────────────────────────────────────
export interface AIQueryUnderstandingResult {
  intent: string
  content_type: string
  operation: string
  main_topic: string
  clean_search_query: string
  keywords: string[]
  entities: {
    persons: string[]
    places: string[]
    organizations: string[]
    events: string[]
    dates: string[]
  }
  time_filter: { type: string; value: string | null }
  allowed_sources: string[]
  forbidden_sources: string[]
  needs_clarification: boolean
  clarification_question: string | null
  confidence: number
  reason: string
}

// ── System prompt with few-shot examples ─────────────────────────────────────
const AI_UNDERSTANDING_SYSTEM_PROMPT = `أنت محلل نية لسؤال مستخدم داخل شات بوت خاص بموقع العتبة العباسية المقدسة (alkafeel.net).
مهمتك ليست الإجابة على السؤال. مهمتك فقط فهم السؤال وإرجاع JSON صالح.

المصادر المتاحة (استعمل هذه القيم فقط في allowed_sources/forbidden_sources):
- articles_latest        → الأخبار والمقالات
- videos_latest          → الفيديوهات (آخر الفيديوهات)
- videos_by_category     → فيديوهات قسم أو موضوع محدد
- friday_sermons         → خطب الجمعة
- wahy_friday            → من وحي الجمعة
- shrine_history_sections, shrine_history_timeline → تاريخ العتبة وبنائها
- abbas_history_by_id    → سيرة العباس بن علي (ع) الشخصية
- projects_dataset       → مشاريع/مؤسسات/مرافق العتبة (جامعات، كليات، مستشفيات...)
- auto                   → استعمل فقط إذا كان السؤال غامضًا أو متعدد الأنواع

قواعد التوجيه:
- لا تختر أكثر من مصدر واحد أو اثنين إلا عند الحاجة الفعلية.
- لا تستخدم auto إذا كان السؤال يذكر نوعًا واضحًا (فيديو / خبر / خطبة / تاريخ / مشروع).
- إذا كان السؤال غامضًا جداً (كلمة واحدة عامة بأكثر من معنى) → needs_clarification=true + سؤال توضيحي قصير.
- clean_search_query: صيغة بحث (2-5 كلمات) بدون أدوات الاستفهام أو "اعطني/اعرض/أحدث".
- main_topic: الكيان أو الموضوع الجوهري ("زيارة الأربعين"، "صحن العقيلة"، ...).
- confidence من 0 إلى 1 — انخفاضه يعني احتمال تفسيرات متعددة.
- intent: أحد: news_lookup, video_lookup, sermon_lookup, wahy_lookup, project_info, person_info, history_lookup, latest_content, search_content, explain_topic, small_talk, clarification_needed.
- content_type: أحد: news, video, sermon, wahy, project, biography, history, general, unknown.
- operation: أحد: answer, list, latest, summarize, explain, count, compare, browse.
- time_filter.type: أحد: latest, today, this_week, specific_date, none.

أرجع JSON فقط بدون أي نص خارج الـ JSON.

—— أمثلة ——

سؤال: ما آخر أخبار العتبة؟
{"intent":"news_lookup","content_type":"news","operation":"latest","main_topic":"أخبار العتبة العباسية","clean_search_query":"أخبار العتبة العباسية","keywords":["أخبار","العتبة"],"entities":{"persons":[],"places":[],"organizations":["العتبة العباسية"],"events":[],"dates":[]},"time_filter":{"type":"latest","value":null},"allowed_sources":["articles_latest"],"forbidden_sources":["videos_latest","projects_dataset"],"needs_clarification":false,"clarification_question":null,"confidence":0.93,"reason":"السؤال يطلب آخر الأخبار"}

سؤال: اعطني آخر فيديو عن زيارة الأربعين
{"intent":"video_lookup","content_type":"video","operation":"latest","main_topic":"زيارة الأربعين","clean_search_query":"زيارة الأربعين","keywords":["زيارة","الأربعين"],"entities":{"persons":[],"places":[],"organizations":[],"events":["زيارة الأربعين"],"dates":[]},"time_filter":{"type":"latest","value":null},"allowed_sources":["videos_latest"],"forbidden_sources":["articles_latest","projects_dataset"],"needs_clarification":false,"clarification_question":null,"confidence":0.95,"reason":"السؤال يطلب أحدث فيديو عن موضوع محدد"}

سؤال: خطبة الجمعة الأخيرة
{"intent":"sermon_lookup","content_type":"sermon","operation":"latest","main_topic":"خطبة الجمعة","clean_search_query":"خطبة الجمعة الأخيرة","keywords":["خطبة","الجمعة"],"entities":{"persons":[],"places":[],"organizations":[],"events":[],"dates":[]},"time_filter":{"type":"latest","value":null},"allowed_sources":["friday_sermons"],"forbidden_sources":["articles_latest","videos_latest"],"needs_clarification":false,"clarification_question":null,"confidence":0.95,"reason":"السؤال يطلب أحدث خطبة جمعة"}

سؤال: من وحي الجمعة عن الصبر
{"intent":"wahy_lookup","content_type":"wahy","operation":"answer","main_topic":"الصبر","clean_search_query":"وحي الجمعة الصبر","keywords":["وحي","الجمعة","الصبر"],"entities":{"persons":[],"places":[],"organizations":[],"events":[],"dates":[]},"time_filter":{"type":"none","value":null},"allowed_sources":["wahy_friday"],"forbidden_sources":[],"needs_clarification":false,"clarification_question":null,"confidence":0.85,"reason":"السؤال يطلب محتوى من وحي الجمعة عن موضوع الصبر"}

سؤال: من هو المتولي الشرعي؟
{"intent":"person_info","content_type":"news","operation":"answer","main_topic":"المتولي الشرعي للعتبة العباسية","clean_search_query":"المتولي الشرعي العتبة العباسية","keywords":["المتولي","الشرعي"],"entities":{"persons":[],"places":[],"organizations":["العتبة العباسية"],"events":[],"dates":[]},"time_filter":{"type":"none","value":null},"allowed_sources":["articles_latest"],"forbidden_sources":["videos_latest"],"needs_clarification":false,"clarification_question":null,"confidence":0.88,"reason":"سؤال عن منصب رسمي يُذكر في الأخبار"}

سؤال: هل لدى العتبة جامعة؟
{"intent":"project_info","content_type":"project","operation":"answer","main_topic":"جامعات العتبة العباسية","clean_search_query":"جامعة العتبة العباسية","keywords":["جامعة","العتبة"],"entities":{"persons":[],"places":[],"organizations":["العتبة العباسية"],"events":[],"dates":[]},"time_filter":{"type":"none","value":null},"allowed_sources":["projects_dataset"],"forbidden_sources":["videos_latest","articles_latest"],"needs_clarification":false,"clarification_question":null,"confidence":0.9,"reason":"سؤال عن مؤسسة تعليمية تابعة للعتبة"}

سؤال: اشرح مشروع صحن العقيلة
{"intent":"project_info","content_type":"project","operation":"explain","main_topic":"صحن العقيلة","clean_search_query":"مشروع صحن العقيلة","keywords":["مشروع","صحن","العقيلة"],"entities":{"persons":[],"places":[],"organizations":["العتبة العباسية"],"events":[],"dates":[]},"time_filter":{"type":"none","value":null},"allowed_sources":["projects_dataset"],"forbidden_sources":[],"needs_clarification":false,"clarification_question":null,"confidence":0.95,"reason":"السؤال يطلب شرحاً عن مشروع محدد"}

سؤال: حدثني عن الزيارة
{"intent":"clarification_needed","content_type":"unknown","operation":"explain","main_topic":"الزيارة","clean_search_query":"الزيارة","keywords":["الزيارة"],"entities":{"persons":[],"places":[],"organizations":[],"events":[],"dates":[]},"time_filter":{"type":"none","value":null},"allowed_sources":[],"forbidden_sources":[],"needs_clarification":true,"clarification_question":"هل تقصد زيارة الأربعين، زيارة عاشوراء، أم زيارة الإمام الحسين عليه السلام؟","confidence":0.45,"reason":"كلمة الزيارة عامة ولها أكثر من معنى"}

سؤال: السلام عليكم
{"intent":"small_talk","content_type":"general","operation":"answer","main_topic":"تحية","clean_search_query":"","keywords":[],"entities":{"persons":[],"places":[],"organizations":[],"events":[],"dates":[]},"time_filter":{"type":"none","value":null},"allowed_sources":[],"forbidden_sources":[],"needs_clarification":false,"clarification_question":null,"confidence":0.99,"reason":"تحية"}

—— ملاحظة: اللهجة العراقية ——
بعض الكلمات العراقية الدارجة وما تعنيه بالعربية الفصحى:
- "اكو" = يوجد / هل يوجد
- "ماكو" = لا يوجد
- "مال / تبع / يرجع لـ" = خاص بـ / تابع لـ
- "شنو / شنهو / شنو اسمه" = ما هو / ما اسمه
- "شلون / كيف" = كيف
- "هواية / كثير" = كثير
- "يمه / أمه" = أمه (حرف الجر)
استخرج الكلمات الجوهرية بالعربية الفصحى في clean_search_query بغض النظر عن اللهجة.

سؤال: اكو مشروع مال الواح طاقة شمسية شنو اسمه
{"intent":"project_info","content_type":"project","operation":"answer","main_topic":"مشروع ألواح الطاقة الشمسية","clean_search_query":"مشروع ألواح طاقة شمسية","keywords":["مشروع","ألواح","طاقة شمسية"],"entities":{"persons":[],"places":[],"organizations":["العتبة العباسية"],"events":[],"dates":[]},"time_filter":{"type":"none","value":null},"allowed_sources":["projects_dataset"],"forbidden_sources":[],"needs_clarification":false,"clarification_question":null,"confidence":0.87,"reason":"سؤال بلهجة عراقية عن مشروع طاقة شمسية تابع للعتبة"}

سؤال: اكو فيديو يرجع للأربعين
{"intent":"video_lookup","content_type":"video","operation":"latest","main_topic":"زيارة الأربعين","clean_search_query":"فيديو الأربعين","keywords":["فيديو","الأربعين"],"entities":{"persons":[],"places":[],"organizations":[],"events":["زيارة الأربعين"],"dates":[]},"time_filter":{"type":"latest","value":null},"allowed_sources":["videos_latest","videos_by_category"],"forbidden_sources":[],"needs_clarification":false,"clarification_question":null,"confidence":0.88,"reason":"سؤال بلهجة عراقية عن فيديوهات الأربعين"}

سؤال: اعطني فيديوهات من قسم افلام
{"intent":"video_lookup","content_type":"video","operation":"list","main_topic":"أفلام","clean_search_query":"أفلام","keywords":["أفلام","قسم"],"entities":{"persons":[],"places":[],"organizations":[],"events":[],"dates":[]},"time_filter":{"type":"none","value":null},"allowed_sources":["videos_by_category"],"forbidden_sources":["videos_latest","articles_latest"],"needs_clarification":false,"clarification_question":null,"confidence":0.95,"reason":"المستخدم طلب فيديوهات من قسم محدد، يجب البحث في videos_by_category فقط"}

سؤال: أحتاج فيديوهات من قسم المناسبات الدينية
{"intent":"video_lookup","content_type":"video","operation":"list","main_topic":"المناسبات الدينية","clean_search_query":"مناسبات دينية","keywords":["مناسبات","دينية","قسم"],"entities":{"persons":[],"places":[],"organizations":[],"events":[],"dates":[]},"time_filter":{"type":"none","value":null},"allowed_sources":["videos_by_category"],"forbidden_sources":["videos_latest","articles_latest"],"needs_clarification":false,"clarification_question":null,"confidence":0.95,"reason":"طلب فيديوهات من قسم محدد — videos_by_category فقط"}
`

// ── In-process cache ──────────────────────────────────────────────────────────
const _aiCache = new Map<string, { result: AIQueryUnderstandingResult; ts: number }>()
const AI_CACHE_TTL_MS = 30 * 60 * 1000
const AI_CACHE_MAX = 500

function aiCacheGet(key: string): AIQueryUnderstandingResult | null {
  const e = _aiCache.get(key)
  if (!e) return null
  if (Date.now() - e.ts > AI_CACHE_TTL_MS) { _aiCache.delete(key); return null }
  return e.result
}

function aiCachePut(key: string, result: AIQueryUnderstandingResult): void {
  if (_aiCache.size >= AI_CACHE_MAX) {
    const first = _aiCache.keys().next().value
    if (first !== undefined) _aiCache.delete(first)
  }
  _aiCache.set(key, { result, ts: Date.now() })
}

// ── Validation ────────────────────────────────────────────────────────────────
function validateAIResult(raw: unknown): AIQueryUnderstandingResult | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>

  const intent   = typeof o.intent        === "string" ? o.intent        : null
  const content_type = typeof o.content_type === "string" ? o.content_type : null
  const operation    = typeof o.operation    === "string" ? o.operation    : null
  if (!intent || !content_type || !operation) return null

  const filterSources = (input: unknown): string[] =>
    (Array.isArray(input) ? input : [])
      .filter((x): x is string => typeof x === "string")
      .filter(s => ALLOWED_SOURCE_IDS.has(s))

  const filterStrings = (input: unknown): string[] =>
    (Array.isArray(input) ? input : []).filter((x): x is string => typeof x === "string" && x.length > 0)

  const ent = (o.entities as Record<string, unknown> | undefined) ?? {}
  const timeRaw = (o.time_filter as Record<string, unknown> | undefined) ?? {}

  return {
    intent,
    content_type,
    operation,
    main_topic:          typeof o.main_topic          === "string" ? o.main_topic          : "",
    clean_search_query:  typeof o.clean_search_query  === "string" ? o.clean_search_query  : "",
    keywords:            filterStrings(o.keywords),
    entities: {
      persons:       filterStrings(ent.persons),
      places:        filterStrings(ent.places),
      organizations: filterStrings(ent.organizations),
      events:        filterStrings(ent.events),
      dates:         filterStrings(ent.dates),
    },
    time_filter: {
      type:  typeof timeRaw.type  === "string" ? timeRaw.type  : "none",
      value: typeof timeRaw.value === "string" ? timeRaw.value : null,
    },
    allowed_sources:      filterSources(o.allowed_sources),
    forbidden_sources:    filterSources(o.forbidden_sources),
    needs_clarification:  Boolean(o.needs_clarification),
    clarification_question: typeof o.clarification_question === "string" ? o.clarification_question : null,
    confidence: typeof o.confidence === "number" ? Math.max(0, Math.min(1, o.confidence)) : 0.5,
    reason:     typeof o.reason     === "string" ? o.reason     : "",
  }
}

// ── Primary resolver ──────────────────────────────────────────────────────────
/**
 * Calls the OpenAI API and returns a complete AIQueryUnderstandingResult.
 * Returns null on any failure so the caller can silently fall back to regex.
 */
export async function resolveQueryUnderstandingWithAI(
  query: string,
  openaiApiKey: string,
  model = "gpt-4o-mini",
  timeoutMs = 4000,
): Promise<AIQueryUnderstandingResult | null> {
  if (!query.trim()) return null

  const cacheKey = query.trim().replace(/\s+/g, " ")
  const cached = aiCacheGet(cacheKey)
  if (cached) return cached

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: AI_UNDERSTANDING_SYSTEM_PROMPT },
          { role: "user",   content: query.trim() },
        ],
      }),
    })

    if (!response.ok) return null

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = data?.choices?.[0]?.message?.content
    if (!content) return null

    let parsed: unknown
    try { parsed = JSON.parse(content) } catch { return null }

    const result = validateAIResult(parsed)
    if (!result) return null

    aiCachePut(cacheKey, result)
    return result
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ── Mapper: AI result → legacy QueryUnderstandingResult ──────────────────────
/**
 * Merges a full AI result onto the regex baseline so every downstream
 * consumer (forced-utility-routing-policy, retrieval-orchestrator,
 * answer-shape-policy, …) keeps working without changes.
 *
 * The AI fields are written into the new optional slots; the legacy slots
 * (content_intent, operation_intent, hinted_sources, …) are kept in sync.
 */
export function mapAIResultToUnderstanding(
  query: string,
  ai: AIQueryUnderstandingResult,
  regexBaseline: QueryUnderstandingResult,
): QueryUnderstandingResult {
  const content_intent: QueryContentIntent =
    CONTENT_TYPE_TO_INTENT[ai.content_type] ?? "generic"

  const opMap: Record<string, QueryOperationIntent> = {
    answer:    "fact_question",
    list:      "list_items",
    latest:    "latest",
    summarize: "summarize",
    explain:   "explain",
    count:     "count",
    compare:   "classify",
    browse:    "browse",
  }
  const operation_intent: QueryOperationIntent =
    opMap[ai.operation] ?? regexBaseline.operation_intent

  const clarity: QueryClarity = ai.needs_clarification ? "underspecified" : "clear"

  // Merge entity lists
  const personMerged = [...new Set([...regexBaseline.extracted_entities.person, ...ai.entities.persons])]
  const placeMerged  = [...new Set([...regexBaseline.extracted_entities.place,  ...ai.entities.places])]
  const topicMerged  = [...new Set([
    ...regexBaseline.extracted_entities.topic,
    ...ai.keywords,
    ...(ai.main_topic ? [ai.main_topic] : []),
  ].filter(Boolean))]

  // AI allowed_sources → hinted_sources (AI first, then regex remainder minus forbidden)
  const hintedMerged: string[] = []
  for (const s of ai.allowed_sources) {
    if (!hintedMerged.includes(s)) hintedMerged.push(s)
  }
  for (const s of regexBaseline.hinted_sources) {
    if (!hintedMerged.includes(s) && !ai.forbidden_sources.includes(s)) hintedMerged.push(s)
  }
  if (!hintedMerged.includes("auto")) hintedMerged.push("auto")

  return {
    ...regexBaseline,
    raw_query: query,
    content_intent,
    operation_intent,
    clarity,
    extracted_entities: {
      person:          personMerged,
      topic:           topicMerged,
      place:           placeMerged,
      source_specific: regexBaseline.extracted_entities.source_specific,
    },
    hinted_sources:  hintedMerged,
    route_confidence: Math.max(regexBaseline.route_confidence, ai.confidence),
    // ── AI-first fields ──
    clean_search_query:     ai.clean_search_query || query.trim(),
    main_topic:             ai.main_topic,
    keywords:               ai.keywords,
    allowed_sources:        ai.allowed_sources,
    forbidden_sources:      ai.forbidden_sources,
    needs_clarification:    ai.needs_clarification,
    clarification_question: ai.clarification_question ?? undefined,
    ai_confidence:          ai.confidence,
    ai_reason:              ai.reason,
    understanding_source:   "ai+regex",
  }
}
