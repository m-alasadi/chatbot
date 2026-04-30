/**
 * Lightweight debug logger gated by `DEBUG_CHATBOT=1`.
 *
 * Use `debugLog(...)` for chatty per-request diagnostics that should be silent
 * in production. `console.warn` / `console.error` should still be used directly
 * for real warnings and errors.
 */
const isDebugEnabled =
  process.env.DEBUG_CHATBOT === "1" ||
  process.env.DEBUG_CHATBOT === "true" ||
  process.env.NODE_ENV === "development"

export function debugLog(...args: unknown[]): void {
  if (isDebugEnabled) {
    // eslint-disable-next-line no-console
    console.log(...args)
  }
}

export function isDebug(): boolean {
  return isDebugEnabled
}
