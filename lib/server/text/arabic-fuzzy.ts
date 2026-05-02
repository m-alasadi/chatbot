/**
 * Arabic fuzzy-matching primitives shared across retrieval layers.
 *
 * Two cheap operations:
 *   - damerauLevenshteinAtMost(a, b, max): bounded edit distance with
 *     transposition (swap of two adjacent chars). Returns Infinity once
 *     the running cost exceeds `max`, so it is O(n) for short strings
 *     and a constant `max`.
 *   - softFoldArabic(s): a "soft" normalization layer applied ON TOP of
 *     the existing `normalizeArabic` / `normalizeArabicLight`. Folds
 *     phonetically-confusable consonants (س↔ص, ت↔ط, ذ↔ز↔ظ, ك↔ق, ه↔ح,
 *     د↔ض, ث↔س↔ص). Used ONLY as a second-pass match — never persisted
 *     into stored text — to avoid losing real distinctions.
 *
 * Both helpers are pure and side-effect free.
 */

/**
 * Damerau-Levenshtein distance with an early-exit cap.
 *
 * @param a - source string
 * @param b - target string
 * @param max - inclusive upper bound on the edit distance to consider
 * @returns the distance if ≤ max, otherwise `max + 1`
 */
export function damerauLevenshteinAtMost(a: string, b: string, max: number): number {
  if (a === b) return 0
  const lenA = a.length
  const lenB = b.length
  if (Math.abs(lenA - lenB) > max) return max + 1
  if (lenA === 0) return lenB
  if (lenB === 0) return lenA

  // Two-row DP with prev-prev row for transposition lookup.
  let prevPrev: number[] | null = null
  let prev: number[] = new Array(lenB + 1)
  for (let j = 0; j <= lenB; j++) prev[j] = j

  for (let i = 1; i <= lenA; i++) {
    const curr: number[] = new Array(lenB + 1)
    curr[0] = i
    let rowMin = curr[0]
    const ai = a.charCodeAt(i - 1)
    const ai1 = i > 1 ? a.charCodeAt(i - 2) : -1

    for (let j = 1; j <= lenB; j++) {
      const bj = b.charCodeAt(j - 1)
      const cost = ai === bj ? 0 : 1
      let v = Math.min(
        curr[j - 1] + 1,         // insertion
        prev[j] + 1,              // deletion
        prev[j - 1] + cost        // substitution
      )
      // Transposition (Damerau): adjacent swap
      if (
        i > 1 && j > 1 &&
        prevPrev !== null &&
        ai === b.charCodeAt(j - 2) &&
        ai1 === bj
      ) {
        v = Math.min(v, prevPrev[j - 2] + 1)
      }
      curr[j] = v
      if (v < rowMin) rowMin = v
    }

    if (rowMin > max) return max + 1
    prevPrev = prev
    prev = curr
  }

  return prev[lenB] <= max ? prev[lenB] : max + 1
}

/**
 * Soft phonetic folding for Arabic. Use ONLY as a second-pass matching
 * helper — the real text and indexes should keep their original letters.
 *
 * Maps:
 *   ص ث → س
 *   ط   → ت
 *   ذ ظ ز → ز
 *   ض   → د
 *   ق   → ك
 *   ح خ → ه   (already ة→ه via normalizeArabic)
 */
export function softFoldArabic(s: string): string {
  if (!s) return ""
  return s
    .replace(/[\u0635\u062B]/g, "\u0633") // ص ث → س
    .replace(/\u0637/g, "\u062A")           // ط → ت
    .replace(/[\u0630\u0638]/g, "\u0632")  // ذ ظ → ز
    .replace(/\u0636/g, "\u062F")           // ض → د
    .replace(/\u0642/g, "\u0643")           // ق → ك
    .replace(/[\u062D\u062E]/g, "\u0647")  // ح خ → ه
}

/**
 * Allowed edit-distance for a token of the given length.
 *  ≤3 chars: 0 (too short — too many false matches)
 *  4–6   : 1
 *  ≥7    : 2
 */
export function maxEditsForLength(len: number): number {
  if (len < 4) return 0
  if (len < 7) return 1
  return 2
}
