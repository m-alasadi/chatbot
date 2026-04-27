/**
 * Paraphrase-robust intent layer.
 *
 * Goal: regardless of how a question is phrased, map it to a single
 * canonical slot. This makes downstream routing (deterministic answers,
 * knowledge lookup, retrieval) immune to phrasing variation.
 *
 * Pure regex over a normalized form — adds microseconds, no model call.
 *
 * IMPORTANT: \b in JavaScript regex does NOT work for Arabic (it only
 * sees Latin letters/digits as word chars). So we use an explicit
 * Arabic-aware boundary: a position that is start-of-string, whitespace,
 * or a non-Arabic-letter character. All patterns reference NORMALIZED
 * Arabic only (after ة→ه, أ/إ/آ/ا→ا, ى→ي, tashkeel removed).
 */

import { normalizeArabicLight } from "./intent-detector"

export type PersonRelationSlot =
  | "father"
  | "mother"
  | "wife"
  | "children"
  | "brothers"
  | "sisters"
  | "uncles"
  | "aunts"
  | "titles"
  | "kunya"
  | "martyrdom"
  | "birth"
  | "age"
  | "definition"

// ── Arabic-aware boundary helpers ───────────────────────────────────

const NON_AR = "[^\u0621-\u064A]"
const B = `(?:^|${NON_AR})`
const B_END = `(?:$|${NON_AR})`

function R(src: string, flags = "u"): RegExp {
  return new RegExp(src, flags)
}

// ── Subject detection: is this query about Abbas ibn Ali? ───────────

const ABBAS_PERSONAL_CUE = R(
  `(?:` +
    `والد|والده|والدت|ابو\\s|ابي\\s|ابوه|ابيه|` +
    `ام\\s|امه|امرا[هة]|` +
    `زوج|زوجه|زوجات|زواج|تزوج|` +
    `ابن|ابناء|اولاد|نسل|ذري[هة]|انجب|` +
    `اخ\\s|اخوه|اخوته|اخوات|اخواته|اشقاء|شقيق|` +
    `عم\\s|عمه|اعمام|عمات|خال|خاله|خالات|` +
    `لقب|القاب|كني[هة]|يلقب|يكني|` +
    `استشهاد|استشهد|شهاد[هة]|مقتل|قتل|` +
    `عمر|كم\\s+سن|ولاد[هة]|ولد|مولد|` +
    `من\\s+هو|من\\s+هي|من\\s+يكون|تعريف|نبذ[هة]|عرفني|حدثني|اخبرني|باختصار` +
  `)`
)

export function isAbbasSubject(normalized: string): boolean {
  const hasPlainAbbas = R(`${B}(?:ل|ب|ك|لل|بال|كال)?(?:العباس|عباس)${B_END}`).test(normalized)
  const hasKunya = R(`(?:ابي|ابو|ابا)\\s+الفضل`).test(normalized)
  const hasHonorific = R(`قمر\\s+بني\\s+هاشم`).test(normalized)

  if (!hasPlainAbbas && !hasKunya && !hasHonorific) return false

  if (!hasKunya && !hasHonorific) {
    const institutional = /(?:العتب[هة]\s+العباسي[هة]|العباسي[هة]\s+المقدس[هة])/u.test(normalized)
    if (institutional && !ABBAS_PERSONAL_CUE.test(normalized)) return false
  }
  return true
}

// ── Slot synonym tables ─────────────────────────────────────────────

interface SlotMatcher {
  slot: PersonRelationSlot
  patterns: RegExp[]
  rejectIf?: RegExp[]
}

const SLOT_MATCHERS: SlotMatcher[] = [
  {
    slot: "kunya",
    patterns: [
      R(`${B}(?:كنيه|كنيته|الكنيه|كنيتك)${B_END}`),
      R(`${B}يكني${B_END}`),
      R(`ما\\s+كنيت`),
    ],
  },
  {
    slot: "titles",
    patterns: [
      R(`${B}(?:القاب|الالقاب|لقب|الالقب|اللقب|اشهر\\s+القاب|اشهر\\s+لقب)${B_END}`),
      R(`${B}يلقب${B_END}`),
    ],
  },
  {
    slot: "martyrdom",
    patterns: [
      R(`(?:استشهاد|استشهد|شهاده|شهادته|مقتل|مقتله|كيف\\s+استشهد|متي\\s+استشهد|اين\\s+استشهد|سن[هة]\\s+استشهاد|تاريخ\\s+استشهاد)`),
    ],
  },
  {
    slot: "birth",
    patterns: [
      R(`(?:ولاده|ولادته|مولد|متي\\s+ولد|تاريخ\\s+ولاد|سن[هة]\\s+ولاد|اين\\s+ولد)`),
    ],
    rejectIf: [/استشهد|استشهاد|مقتل/u],
  },
  {
    slot: "age",
    patterns: [
      R(`(?:كم\\s+عمر|كم\\s+كان\\s+عمر|عمره\\s+يوم|عمره\\s+عند|عمره\\s+حين|كم\\s+سن[هة])`),
    ],
    rejectIf: [/استشهد|استشهاد|مقتل/u],
  },
  {
    // Mother — checked BEFORE father so "والدته" wins over "والد".
    slot: "mother",
    patterns: [
      R(`(?:والده|والدته)${B_END}`),
      R(`${B}والدت${B_END}`),
      R(`${B}ام\\s+(?:العباس|ابو\\s+الفضل|ابي\\s+الفضل|ابا\\s+الفضل|قمر)`),
      R(`من\\s+(?:هي\\s+)?(?:ام|امه|والده|والدته)(?:\\s|$)`),
      R(`ما\\s+اسم\\s+(?:ام|والده|والدته)`),
      R(`${B}امه${B_END}`),
    ],
    rejectIf: [/ام\s+البنين/u],
  },
  {
    // Father.
    slot: "father",
    patterns: [
      R(`${B}والد(?:\\s|$)`),
      R(`من\\s+(?:هو\\s+)?(?:ابوه|ابيه|والد)(?:\\s|$)`),
      R(`${B}ابو\\s+(?:العباس|قمر)`),
      R(`${B}(?:ابيه|ابوه)${B_END}`),
      R(`ما\\s+اسم\\s+(?:ابوه|ابيه|والد)`),
    ],
  },
  {
    slot: "wife",
    patterns: [
      R(`${B}(?:زوج|زوجه|زوجات|الزوجه|الزوجات|زوجته|زوجاته)${B_END}`),
      R(`من\\s+(?:هي\\s+)?(?:زوج|زوجه|زوجته)(?:\\s|$)`),
      R(`ما\\s+اسم\\s+زوج`),
      R(`كم\\s+زوج`),
      R(`من\\s+تزوج(?:\\s|$|ه)`),
      R(`كم\\s+تزوج`),
      R(`${B}زواج${B_END}`),
      R(`${B}امرا[هة](?:\\s|$)`),
    ],
  },
  {
    slot: "children",
    patterns: [
      R(`${B}(?:ابناء|اولاد|الابناء|الاولاد|نسل|ذري[هة]|اطفال|الاطفال)${B_END}`),
      R(`من\\s+(?:هم\\s+)?(?:ابناء|اولاد)(?:\\s|$)`),
      R(`كم\\s+(?:ولد|ابن|اولاد|ابناء)(?:\\s|$)`),
      R(`من\\s+انجب(?:\\s|$)`),
      R(`اسماء\\s+(?:ابناء|اولاد)`),
    ],
  },
  {
    slot: "brothers",
    patterns: [
      R(`${B}(?:اخوه|اخوته|الاخوه|اخوان|اخوانه|الاخوان|اشقاء|اشقاؤه)${B_END}`),
      R(`من\\s+(?:هم\\s+)?(?:اخوه|اخوته|اخوان|اشقاء)(?:\\s|$)`),
    ],
  },
  {
    slot: "sisters",
    patterns: [
      R(`${B}(?:اخوات|اخواته|الاخوات|شقيقات|شقيقاته)${B_END}`),
      R(`من\\s+(?:هي\\s+)?(?:اخت|اخوات|شقيق[هة])(?:\\s|$)`),
      R(`اخت\\s+العباس`),
    ],
  },
  {
    slot: "uncles",
    patterns: [
      R(`${B}(?:اعمام|اعمامه|الاعمام|عمه)${B_END}`),
      R(`من\\s+(?:هم\\s+)?(?:اعمام|عم)(?:\\s|$)`),
      R(`${B}عم\\s+(?:العباس|ابي\\s+الفضل|ابو\\s+الفضل)`),
    ],
  },
  {
    slot: "aunts",
    patterns: [
      R(`${B}(?:عمات|عماته|خالات|خالاته)${B_END}`),
    ],
  },
  {
    slot: "definition",
    patterns: [
      R(`(?:^|\\s)(?:من\\s+هو|من\\s+هي|من\\s+يكون)(?:\\s|$)`),
      R(`(?:^|\\s)(?:تعريف|نبذ[هة]|باختصار|عرفني|حدثني\\s+عن|اخبرني\\s+عن)`),
      R(`(?:^|\\s)(?:ما\\s+هو|ماهو)\\s+العباس`),
    ],
  },
]

/**
 * Detect canonical slot for a query about Abbas. Returns null if the
 * query is not about Abbas or no slot matched.
 *
 * Disambiguation: "أبو الفضل" is the kunya, not a father question. We
 * strip kunya occurrences before matching slots, then fall back to
 * "definition" if "من هو/من هي/تعريف/نبذة" remains in the original.
 */
export function detectAbbasRelationSlot(query: string): PersonRelationSlot | null {
  if (!query) return null
  const norm = normalizeArabicLight(query)
  if (!isAbbasSubject(norm)) return null

  const noKunya = norm.replace(/(?:ابي|ابو|ابا)\s+الفضل/gu, " ").replace(/\s+/g, " ").trim()

  for (const matcher of SLOT_MATCHERS) {
    if (matcher.rejectIf?.some(r => r.test(norm))) continue
    if (matcher.patterns.some(p => p.test(noKunya))) return matcher.slot
  }
  if (/(?:من\s+هو|من\s+هي|من\s+يكون|تعريف|نبذ[هة])/u.test(norm)) return "definition"
  return null
}

export function detectRelationSlotAnySubject(query: string): PersonRelationSlot | null {
  if (!query) return null
  const norm = normalizeArabicLight(query)
  const noKunya = norm.replace(/(?:ابي|ابو|ابا)\s+الفضل/gu, " ").replace(/\s+/g, " ").trim()
  for (const matcher of SLOT_MATCHERS) {
    if (matcher.rejectIf?.some(r => r.test(norm))) continue
    if (matcher.patterns.some(p => p.test(noKunya))) return matcher.slot
  }
  if (/(?:من\s+هو|من\s+هي|من\s+يكون|تعريف|نبذ[هة])/u.test(norm)) return "definition"
  return null
}
