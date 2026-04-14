/**
 * Retrieval Orchestrator
 *
 * Provides safe wrappers around tool execution that:
 *   1. Never propagate uncaught exceptions (prevents HTTP 500)
 *   2. Detect timeout / connectivity failures quickly
 *   3. Return user-friendly fallback messages for each source type
 *
 * Responsible for the biography_vs_shrine_history and
 * wahy_vs_friday_sermon reliability improvements.
 */

import { executeToolByName, type APICallResult } from "./site-api-service"
import type { AllowedToolName } from "./site-tools-definitions"

// ── Safe tool execution ─────────────────────────────────────────────

/**
 * Execute a tool and always return an APICallResult — never throws.
 *
 * This wrapper is the single safe execution point for forced-intent tool
 * calls inside resolveToolCalls.  It catches any unexpected exception that
 * might escape executeToolByName and converts it to a structured error
 * result, preventing HTTP 500 from propagating to the route handler.
 */
export async function safeExecuteTool(
  toolName: AllowedToolName,
  args: Record<string, any>
): Promise<APICallResult> {
  try {
    return await executeToolByName(toolName, args)
  } catch (err: any) {
    const msg = (err?.message || String(err) || "خطأ غير متوقع أثناء تنفيذ الأداة")
    console.error(`[RetrievalOrchestrator] Uncaught error in tool "${toolName}":`, msg)
    return {
      success: false,
      error: msg,
    }
  }
}

// ── Failure classification ──────────────────────────────────────────

/**
 * Returns true when the APICallResult represents a transient
 * network / timeout failure (as opposed to a data-not-found result).
 */
export function isTransientError(result: APICallResult): boolean {
  if (result.success) return false
  const msg = (result.error || "").toLowerCase()
  return (
    msg.includes("timeout") ||
    msg.includes("مهله") ||
    msg.includes("مهلة") ||
    msg.includes("انتهت") ||
    msg.includes("فشل الاتصال") ||
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused")
  )
}

// ── Fallback messages ───────────────────────────────────────────────

/** Source identifiers that have specific human-readable fallback text */
type KnownSource =
  | "wahy_friday"
  | "friday_sermons"
  | "articles_latest"
  | "videos_latest"
  | "shrine_history_sections"
  | "shrine_history_by_section"
  | "abbas_history_by_id"

const SOURCE_FALLBACKS: Record<KnownSource, string> = {
  wahy_friday:
    "عذراً، لم أتمكن من استرجاع محتوى «من وحي الجمعة» في الوقت الحالي. " +
    "يُرجى زيارة الموقع الرسمي للعتبة العباسية على alkafeel.net للاطلاع على أحدث الإصدارات.",
  friday_sermons:
    "عذراً، لم أتمكن من استرجاع خطب الجمعة حالياً. " +
    "يُرجى المحاولة مرة أخرى أو زيارة alkafeel.net.",
  articles_latest:
    "عذراً، لم أتمكن من استرجاع أحدث المقالات في الوقت الحالي. " +
    "يُرجى المحاولة مرة أخرى.",
  videos_latest:
    "عذراً، لم أتمكن من استرجاع الفيديوهات في الوقت الحالي. " +
    "يُرجى المحاولة مرة أخرى.",
  shrine_history_sections:
    "عذراً، لم أتمكن من استرجاع معلومات تاريخ العتبة في الوقت الحالي. " +
    "يُرجى زيارة alkafeel.net/history للاطلاع على التاريخ الكامل.",
  shrine_history_by_section:
    "عذراً، لم أتمكن من استرجاع معلومات تاريخ العتبة في الوقت الحالي. " +
    "يُرجى زيارة alkafeel.net/history للاطلاع على التاريخ الكامل.",
  abbas_history_by_id:
    "عذراً، لم أتمكن من استرجاع المعلومات حول أبي الفضل العباس (عليه السلام) في الوقت الحالي. " +
    "يُرجى زيارة alkafeel.net/abbas للاطلاع على الصفحة الكاملة.",
}

/**
 * Return a user-friendly Arabic fallback message for a given source.
 * Falls back to a generic message when the source is unknown.
 */
export function getSourceFallbackMessage(source?: string): string {
  if (source && source in SOURCE_FALLBACKS) {
    return SOURCE_FALLBACKS[source as KnownSource]
  }
  return "عذراً، حدث خطأ أثناء استرجاع البيانات. يُرجى المحاولة مرة أخرى."
}
