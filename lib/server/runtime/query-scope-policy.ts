import { type QueryUnderstandingResult } from "../query-understanding"

function normalizeArabicLight(text: string): string {
  return (text || "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[\u0622\u0623\u0625\u0627]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\s+/g, " ")
    .trim()
}

function includesAny(norm: string, values: string[]): boolean {
  return values.some(value => norm.includes(normalizeArabicLight(value)))
}

export function isSmallTalkQuery(text: string): boolean {
  const norm = normalizeArabicLight(text)
  if (!norm) return true

  return includesAny(norm, [
    "مرحبا",
    "اهلا",
    "السلام عليكم",
    "شكرا",
    "شكرا لك",
    "تسلم",
    "من انت",
    "من أنت",
    "ماذا تستطيع",
    "شنو تقدر تسوي",
    "ما الذي يمكنك فعله",
    "كيف استخدمك",
    "كيف استخدم هذا البوت",
    "ساعدني",
  ])
}

function hasInstitutionSignal(norm: string): boolean {
  return includesAny(norm, [
    "العتبة العباسية",
    "العتبه العباسيه",
    "العتبة",
    "العتبه",
    "العباسية",
    "العباسيه",
    "الكفيل",
    "alkafeel",
    "موقع الكفيل",
    "الموقع",
    "في الموقع",
    "ضمن الموقع",
    "لديكم",
    "عندكم",
    "لدى العتبة",
    "تابع للعتبة",
  ])
}

export function isOutOfScopeQuery(
  text: string,
  understanding?: QueryUnderstandingResult
): boolean {
  // Small-talk (greetings, thanks, "من أنت", capability checks) is NOT out of
  // scope — it should receive a friendly assistant reply, not the
  // out-of-scope fallback. Returning false here lets the LLM's natural
  // response pass through.
  if (isSmallTalkQuery(text)) return false
  return false
}