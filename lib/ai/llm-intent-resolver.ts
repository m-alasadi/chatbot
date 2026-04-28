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
