export interface ChatTraceEvent {
  trace_id: string
  stage: string
  normalized_query?: string
  routed_source?: string
  retry_attempts?: number
  result_counts?: number
  top_score?: number | null
  answer_mode?: "direct_grounded" | "llm_stream" | "fallback_stream" | "tool_failure_message" | "error"
  unavailable_reason?: string
  details?: Record<string, any>
}

export function buildTraceId(): string {
  const rnd = Math.random().toString(36).slice(2, 8)
  return `trace_${Date.now().toString(36)}_${rnd}`
}

export function normalizeQueryForTrace(text: string): string {
  return (text || "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[\u0622\u0623\u0625\u0627]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

export function logChatTrace(event: ChatTraceEvent): void {
  try {
    console.log("[ChatTrace]", JSON.stringify(event))
  } catch {
    console.log("[ChatTrace]", event.stage, event.trace_id)
  }
}
