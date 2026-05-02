import {
  getSiteSystemPrompt,
  getFallbackResponse
} from "@/lib/server/system-prompts"
import { getOpenAIModel } from "@/lib/server/site-api-config"
import { ALL_SITE_TOOLS } from "@/lib/server/site-tools-definitions"
import { resolveToolCalls } from "@/lib/server/function-calling-handler"
import { buildEntityCatalogSnippet } from "@/lib/server/site-api-service"
import {
  applyRateLimit,
  createRateLimitResponse
} from "@/lib/server/rate-limiter"
import {
  validateAndSanitize,
  sanitizeMessages,
  logSecurityIssue
} from "@/lib/server/data-sanitizer"
import {
  buildTraceId,
  logChatTrace,
  normalizeQueryForTrace
} from "@/lib/server/observability/chat-trace"
import {
  startRuntimeRequestMetrics,
  finishRuntimeRequestMetrics
} from "@/lib/server/observability/runtime-metrics"
import { understandQuery, understandQueryWithFallback, getQueryClassKey, type QueryContentIntent } from "@/lib/server/query-understanding"
import { requiresPriorConversationContext } from "@/lib/server/runtime/dialog-context-policy"
import {
  normalizeChatDomain,
  getDomainPreferredSources,
  getChatDomainLabel
} from "@/lib/shared/chat-domains"
import type { ServerRuntime } from "next"
import OpenAI from "openai"
import { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs"

export const runtime: ServerRuntime = "edge"

/**
 * Security Headers
 */
function getSecurityHeaders(): HeadersInit {
  // Ø§Ù„Ø³Ù…Ø§Ø­ Ù„Ø£ÙŠ origin Ù„Ø£Ù† Ø§Ù„ÙˆØ¯Ø¬Øª ÙŠÙØ¶Ù…Ù‘Ù† ÙÙŠ Ù…ÙˆØ§Ù‚Ø¹ Ø®Ø§Ø±Ø¬ÙŠØ© Ù…ØªØ¹Ø¯Ø¯Ø©
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'",
  }
}

function getSecurityHeadersWithTrace(traceId?: string): HeadersInit {
  return {
    ...getSecurityHeaders(),
    ...(traceId ? { "X-Trace-Id": traceId } : {})
  }
}

function classifyRuntimeFailure(error: any): "timeout" | "rate_limit" | "upstream" | "network" | "auth" | "unknown" {
  const text = String(error?.message || error || "").toLowerCase()
  if (!text) return "unknown"
  if (
    text.includes("incorrect api key") ||
    text.includes("invalid_api_key") ||
    text.includes("api key") ||
    text.includes("unauthorized") ||
    text.includes("forbidden") ||
    text.includes("401") ||
    text.includes("403")
  ) {
    return "auth"
  }
  if (text.includes("timeout") || text.includes("timed out") || text.includes("request_budget_exhausted")) {
    return "timeout"
  }
  if (text.includes("rate limit") || text.includes("429") || text.includes("too many requests")) {
    return "rate_limit"
  }
  if (
    text.includes("503") ||
    text.includes("502") ||
    text.includes("504") ||
    text.includes("service unavailable") ||
    text.includes("bad gateway")
  ) {
    return "upstream"
  }
  if (
    text.includes("fetch") ||
    text.includes("network") ||
    text.includes("econn") ||
    text.includes("socket") ||
    text.includes("enotfound")
  ) {
    return "network"
  }
  return "unknown"
}

function buildRuntimeFailureMessage(kind: ReturnType<typeof classifyRuntimeFailure>, traceId: string): string {
  const traceSuffix = `\n\nرقم التتبع: ${traceId}`
  const underDevelopmentMessage = `خدمة الرد الآلي قيد التطوير حالياً وقد لا تتوفر الإجابة في هذه اللحظة. يرجى المحاولة بعد قليل.${traceSuffix}`
  switch (kind) {
    case "auth":
      return underDevelopmentMessage
    case "timeout":
      return underDevelopmentMessage
    case "rate_limit":
      return underDevelopmentMessage
    case "upstream":
      return underDevelopmentMessage
    case "network":
      return underDevelopmentMessage
    default:
      return underDevelopmentMessage
  }
}

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

function isStandaloneReferentialQuestion(text: string): boolean {
  const norm = normalizeArabicLight(text)
  const referentialSignals = [
    "ألقابه",
    "القابه",
    "أبناؤه",
    "ابناؤه",
    "أولاده",
    "اولاده",
    "زوجته",
    "زوجاته",
    "اسم زوجته",
    "شهادته",
    "استشهاده"
  ]
  const explicitSubjectSignals = [
    "العباس",
    "أبي الفضل",
    "ابي الفضل",
    "أبو الفضل",
    "ابو الفضل",
    "المتولي الشرعي",
    "إذاعة الكفيل",
    "اذاعة الكفيل",
    "نداء العقيدة",
    "أسبوع الإمامة",
    "اسبوع الامامة",
    "جامعة الكفيل",
    "الشؤون النسوية"
  ]

  return includesAny(norm, referentialSignals) && !includesAny(norm, explicitSubjectSignals)
}

/**
 * Ù…Ø¹Ø§Ù„Ø¬Ø© OPTIONS request (CORS Preflight)
 */
export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: getSecurityHeaders()
  })
}

interface ChatRequest {
  messages: ChatCompletionMessageParam[]
  temperature?: number
  max_tokens?: number
  use_tools?: boolean
  forced_source?: string   // legacy — محفوظ للتوافق مع العملاء القدامى
  preferredDomain?: string  // المجال المختار من بطاقة اختيار الوجهة
}

const DEFAULT_CHAT_TEMPERATURE = 0.2
const DEFAULT_CHAT_MAX_TOKENS = 1200
const MAX_CONTEXT_MESSAGES = 12

/**
 * Endpoint Ù…ÙˆØ­Ø¯ Ù„Ù„Ø´Ø§Øª Ù…Ø¹ Ø¯Ø¹Ù… Function Calling - Ø§Ù„Ù…Ø±Ø­Ù„Ø© 2 + 4
 * 
 * Ø§Ù„ØªØ·ÙˆÙŠØ±Ø§Øª:
 * âœ… Phase 2: Ø¯Ø¹Ù… Function Calling Ù…Ø¹ REST API
 * âœ… Phase 3: Ù…Ù†Ø¹ Ø§Ù„Ù‡Ù„ÙˆØ³Ø© ÙˆØ§Ù„Ø§Ù‚ØªØ±Ø§Ø­Ø§Øª Ø§Ù„Ø°ÙƒÙŠØ©
 * âœ… Phase 4: Rate Limiting + Security + Data Sanitization
 */
export async function POST(request: Request) {
  const traceId = buildTraceId()
  const securityHeaders = getSecurityHeadersWithTrace(traceId)
  const requestStartedAt = Date.now()
  let metricsFinalized = false
  const finalizeMetrics = (input: { answerMode?: string; unavailableReason?: string; routedSource?: string }) => {
    if (metricsFinalized) return
    metricsFinalized = true
    finishRuntimeRequestMetrics({
      traceId,
      totalLatencyMs: Date.now() - requestStartedAt,
      answerMode: input.answerMode,
      unavailableReason: input.unavailableReason,
      routedSource: input.routedSource
    })
  }

  try {
    const host = String(request.headers.get("host") || "").toLowerCase()
    const forwardedFor = String(request.headers.get("x-forwarded-for") || "").toLowerCase()
    const isLocalLoopbackRequest =
      host.includes("localhost") ||
      host.includes("127.0.0.1") ||
      forwardedFor.includes("127.0.0.1") ||
      forwardedFor.includes("::1")

    // âœ… Phase 4.1: Rate Limiting - Ø­Ù…Ø§ÙŠØ© Ù…Ù† Spam
    const rateLimitResult = isLocalLoopbackRequest
      ? { allowed: true, ip: "loopback" as string, retryAfter: undefined }
      : applyRateLimit(request, {
          maxRequests: 20, // 20 Ø·Ù„Ø¨
          windowMs: 60 * 1000, // Ù„ÙƒÙ„ Ø¯Ù‚ÙŠÙ‚Ø©
          blockDurationMs: 5 * 60 * 1000 // Ø­Ø¸Ø± 5 Ø¯Ù‚Ø§Ø¦Ù‚ Ø¹Ù†Ø¯ Ø§Ù„ØªØ¬Ø§ÙˆØ²
        })

    if (!rateLimitResult.allowed) {
      console.warn(
        `[Rate Limit] Blocked IP: ${rateLimitResult.ip}, Retry after: ${rateLimitResult.retryAfter}s`
      )

      return createRateLimitResponse(
        rateLimitResult.retryAfter!,
        "ØªØ¬Ø§ÙˆØ²Øª Ø§Ù„Ø­Ø¯ Ø§Ù„Ù…Ø³Ù…ÙˆØ­ Ù…Ù† Ø§Ù„Ø·Ù„Ø¨Ø§Øª. ÙŠÙØ±Ø¬Ù‰ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ø¨Ø¹Ø¯ Ù‚Ù„ÙŠÙ„."
      )
    }

    // Ù‚Ø±Ø§Ø¡Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª
    const json = await request.json()
    const {
      messages,
      temperature = DEFAULT_CHAT_TEMPERATURE,
      max_tokens = DEFAULT_CHAT_MAX_TOKENS,
      use_tools = true,
      forced_source,
      preferredDomain: rawPreferredDomain
    } = json as ChatRequest

    // ØªÙˆØ­ÙŠØ¯ Ø§Ù„Ø³Ù„ÙˆÙƒ Ø¨ÙŠÙ† Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© ÙˆØ§Ù„Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª Ø¹Ø¨Ø± Ø¶Ø¨Ø· Ø­Ø¯ÙˆØ¯ Ø§Ù„Ù…Ø¹Ù„Ù…Ø§Øª.
    const boundedTemperature = Number.isFinite(temperature)
      ? Math.max(0, Math.min(0.3, temperature))
      : DEFAULT_CHAT_TEMPERATURE
    const boundedMaxTokens = Number.isFinite(max_tokens)
      ? Math.max(256, Math.min(DEFAULT_CHAT_MAX_TOKENS, Math.trunc(max_tokens)))
      : DEFAULT_CHAT_MAX_TOKENS

    // Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† ÙˆØ¬ÙˆØ¯ Ø±Ø³Ø§Ø¦Ù„
    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({
          error: "ÙŠØ¬Ø¨ Ø¥Ø±Ø³Ø§Ù„ Ø±Ø³Ø§Ù„Ø© ÙˆØ§Ø­Ø¯Ø© Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„"
        }),
        { status: 400, headers: securityHeaders }
      )
    }

    // âœ… Phase 4.2: Data Sanitization - ØªÙ†Ø¸ÙŠÙ Ø§Ù„Ù…Ø¯Ø®Ù„Ø§Øª
    // ØªØ­ÙˆÙŠÙ„ messages Ù„Ù†ÙˆØ¹ Ø¨Ø³ÙŠØ· Ù„Ù„ØªÙ†Ø¸ÙŠÙ
    const simpleMessages = messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    }))
    
    const sanitizedMessages = sanitizeMessages(simpleMessages)
    const boundedMessages = sanitizedMessages.slice(-MAX_CONTEXT_MESSAGES)

    if (boundedMessages.length === 0) {
      return new Response(
        JSON.stringify({
          error: "Ø§Ù„Ø±Ø³Ø§Ø¦Ù„ ØºÙŠØ± ØµØ§Ù„Ø­Ø© Ø¨Ø¹Ø¯ Ø§Ù„ØªÙ†Ø¸ÙŠÙ"
        }),
        { status: 400, headers: securityHeaders }
      )
    }

    // Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† ØµØ­Ø© Ø¢Ø®Ø± Ø±Ø³Ø§Ù„Ø© (Ù…Ù† Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…)
    const lastMessage = boundedMessages[boundedMessages.length - 1]
    const requestUnderstanding = await understandQueryWithFallback(
      lastMessage?.content || "",
      process.env.OPENAI_API_KEY,
    )

    // أولوية بحث بناءً على ما اختاره المستخدم (preferredDomain — ليس فلتراً صارماً)
    const validatedDomain = normalizeChatDomain(rawPreferredDomain)
    if (validatedDomain !== "general") {
      const domainSources = getDomainPreferredSources(validatedDomain)
      // اضبط hinted_sources + allowed_sources بمصادر المجال فقط
      // allowed_sources يمنع الأوركيستريتور من الخروج لمصادر خارج المجال
      requestUnderstanding.hinted_sources   = [...domainSources, "auto"]
      requestUnderstanding.allowed_sources  = [...domainSources, "auto"]
      // اضبط content_intent ليتطابق مع المجال دائماً (ليس فقط عند "generic")
      // هذا يتجاوز مسار underspecified في الأوركيستريتور
      const domainIntentMap: Record<string, QueryContentIntent> = {
        news:      "news",
        videos:    "video",
        sermons:   "sermon",
        history:   "history",
        abbas_bio: "biography",
      }
      const mappedIntent = domainIntentMap[validatedDomain]
      if (mappedIntent) {
        requestUnderstanding.content_intent = mappedIntent
      }
      // إذا كان الاستعلام غير واضح، نعتبره "clear" لأن المجال المختار يُوضح النية
      if (requestUnderstanding.clarity === "underspecified") {
        requestUnderstanding.clarity = "clear"
      }
    }
    // الدعم القديم: forced_source (legacy API)
    if (!rawPreferredDomain && forced_source && typeof forced_source === "string") {
      requestUnderstanding.hinted_sources = [forced_source]
      requestUnderstanding.allowed_sources = [forced_source]
    }
    const keepConversationContext =
      lastMessage?.role === "user" &&
      requiresPriorConversationContext(lastMessage.content || "", requestUnderstanding)
    const effectiveMessages = keepConversationContext
      ? boundedMessages
      : boundedMessages.slice(-1)

    // إذا اختار المستخدم مجالاً محدداً (غير "general") نتجاوز أسئلة التوضيح التلقائية
    // لأن المجال المختار يُوضح نية المستخدم بشكل كافٍ — نبحث مباشرةً
    const userChoseDomain = validatedDomain !== "general"

    if (
      !userChoseDomain &&
      lastMessage?.role === "user" &&
      keepConversationContext &&
      !boundedMessages.some(message => message.role === "assistant") &&
      isStandaloneReferentialQuestion(lastMessage.content || "")
    ) {
      const clarification = "Ù‡Ø°Ø§ Ø§Ù„Ø³Ø¤Ø§Ù„ ÙŠØ¹ØªÙ…Ø¯ Ø¹Ù„Ù‰ Ø§Ù„Ø³ÙŠØ§Ù‚ Ø§Ù„Ø³Ø§Ø¨Ù‚. Ø§Ø°ÙƒØ± Ø§Ù„Ø§Ø³Ù… Ø£Ùˆ Ø§Ù„Ù…ÙˆØ¶ÙˆØ¹ Ø§Ù„Ù…Ù‚ØµÙˆØ¯ Ø£ÙˆÙ„Ø§Ù‹ Ø«Ù… Ø³Ø£Ø¬ÙŠØ¨Ùƒ Ø¨Ø¯Ù‚Ø©."
      return new Response(clarification, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          ...securityHeaders
        },
        status: 200
      })
    }

    if (
      !userChoseDomain &&
      lastMessage?.role === "user" &&
      requestUnderstanding.needs_clarification === true &&
      typeof requestUnderstanding.clarification_question === "string" &&
      requestUnderstanding.clarification_question.trim().length > 0 &&
      (requestUnderstanding.ai_confidence ?? 1) < 0.6
    ) {
      return new Response(requestUnderstanding.clarification_question.trim(), {
        headers: { "Content-Type": "text/plain; charset=utf-8", ...securityHeaders },
        status: 200,
      })
    }

    startRuntimeRequestMetrics({
      traceId,
      queryClass: getQueryClassKey(requestUnderstanding)
    })
    const normalizedQuery = normalizeQueryForTrace(lastMessage?.content || "")
    logChatTrace({
      trace_id: traceId,
      stage: "request_received",
      normalized_query: normalizedQuery,
      details: {
        use_tools,
        message_count: effectiveMessages.length,
        original_message_count: sanitizedMessages.length,
        conversation_context_mode: keepConversationContext ? "preserved" : "isolated_latest_turn",
        model: getOpenAIModel()
      }
    })

    if (lastMessage.role === "user") {
      const validation = validateAndSanitize(lastMessage.content)

      if (!validation.valid) {
        logSecurityIssue(
          "Invalid Input",
          { error: validation.error, original: lastMessage.content },
          rateLimitResult.ip
        )

        return new Response(
          JSON.stringify({
            error: "Ø§Ù„Ù…Ø¯Ø®Ù„Ø§Øª ØºÙŠØ± ØµØ§Ù„Ø­Ø©",
            details: validation.error
          }),
          { status: 400, headers: securityHeaders }
        )
      }

      // Ø§Ø³ØªØ®Ø¯Ø§Ù… Ø§Ù„Ù†Øµ Ø§Ù„Ù†Ø¸ÙŠÙ
      lastMessage.content = validation.sanitized!
    }

    // Ø§Ù„Ø­ØµÙˆÙ„ Ø¹Ù„Ù‰ OpenAI API Key Ù…Ù† Ø§Ù„Ø¨ÙŠØ¦Ø© (Ù„Ø§ Ù†Ø­ØªØ§Ø¬ Supabase Ù„Ù€ site API)
    const openaiApiKey = process.env.OPENAI_API_KEY
    if (!openaiApiKey) {
      throw new Error("OPENAI_API_KEY not found in environment")
    }

    // Ø§Ù„Ø­ØµÙˆÙ„ Ø¹Ù„Ù‰ Ø§Ù„Ù†Ù…ÙˆØ°Ø¬ Ù…Ù† Ø§Ù„Ø¨ÙŠØ¦Ø©
    const model = getOpenAIModel()

    // Ø¥Ù†Ø´Ø§Ø¡ Ø¹Ù…ÙŠÙ„ OpenAI
    const openai = new OpenAI({
      apiKey: openaiApiKey
    })

    // Ø­Ù‚Ù† System Prompt Ù…Ø¹ ÙÙ‡Ø±Ø³ Ø§Ù„ÙƒÙŠØ§Ù†Ø§Øª Ø§Ù„Ø¯ÙŠÙ†Ø§Ù…ÙŠÙƒÙŠ
    const entityCatalog = await buildEntityCatalogSnippet()
    // أبلغ الذكاء الاصطناعي بالمجال المختار حتى يكيّف إجابته وفقه.
    const domainInstruction =
      validatedDomain !== "general"
        ? `\n\n## تفضيل المجال:\nاختار المستخدم مجال \"${getChatDomainLabel(validatedDomain)}\".، ابدأ بالبحث في مصادر هذا المجال أولاً، وعند عدم كفاية النتائج لا تتردد في استخدام مصادر أخرى. المجال المختار أولوية وليس قيدًا صارماً.`
        : ""
    const systemPrompt = getSiteSystemPrompt(entityCatalog, domainInstruction || undefined)
    const messagesWithSystem: ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: systemPrompt
      },
      ...effectiveMessages.map(msg => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content
      }))
    ]

    // ===== Streaming Function Calling =====
    if (use_tools) {
      console.log(`[Chat API] Streaming FC (${effectiveMessages.length} msgs)`)
      let toolResult: Awaited<ReturnType<typeof resolveToolCalls>> | null = null

      try {
        logChatTrace({
          trace_id: traceId,
          stage: "tool_resolution_started",
          normalized_query: normalizedQuery,
          details: {
            max_iterations: 3,
            tools_count: ALL_SITE_TOOLS.length
          }
        })

        // Ø§Ù„Ø®Ø·ÙˆØ© 1: Ø­Ù„ Ø¬Ù…ÙŠØ¹ tool calls (Ø¨Ø¯ÙˆÙ† stream)
        // Pass { traceId } and the pre-computed understanding to the handler.
        const traceOpts = { traceId }
        toolResult = await resolveToolCalls(
          openai,
          model,
          messagesWithSystem,
          ALL_SITE_TOOLS,
          3,
          { ...traceOpts, queryUnderstanding: requestUnderstanding }
        )

        logChatTrace({
          trace_id: traceId,
          stage: "tools_resolved",
          normalized_query: normalizedQuery,
          routed_source: toolResult.trace?.routed_source,
          retry_attempts: toolResult.trace?.retry_attempts || 0,
          result_counts: toolResult.trace?.result_counts,
          top_score: toolResult.trace?.top_score,
          unavailable_reason: toolResult.trace?.unavailable_reason,
          details: {
            iterations: toolResult.iterations,
            needs_final_call: toolResult.needsFinalCall,
            has_direct_answer: Boolean(toolResult.directAnswer)
          }
        })
        logChatTrace({
          trace_id: traceId,
          stage: "tool_resolution_finished",
          normalized_query: normalizedQuery,
          routed_source: toolResult.trace?.routed_source,
          retry_attempts: toolResult.trace?.retry_attempts || 0,
          result_counts: toolResult.trace?.result_counts,
          top_score: toolResult.trace?.top_score,
          unavailable_reason: toolResult.trace?.unavailable_reason,
          details: {
            iterations: toolResult.iterations,
            needs_final_call: toolResult.needsFinalCall,
            has_direct_answer: Boolean(toolResult.directAnswer)
          }
        })

        console.log(`[Chat API] Tools resolved in ${toolResult.iterations} iteration(s), needsFinalCall: ${toolResult.needsFinalCall}`)

        // Ø¥Ø°Ø§ ÙƒØ§Ù† Ù‡Ù†Ø§Ùƒ Ø¥Ø¬Ø§Ø¨Ø© Ù…Ø¨Ø§Ø´Ø±Ø© (Ù…Ù† evidence Ø¹Ø§Ù„ÙŠ Ø§Ù„Ø«Ù‚Ø©) â†’ Ø£Ø±Ø¬Ø¹Ù‡Ø§ ÙÙˆØ±Ø§Ù‹
        if (toolResult.directAnswer) {
          const directAnswerText = toolResult.directAnswer
          console.log(`[Chat API] Returning direct grounded answer (bypassing final LLM call)`)
          logChatTrace({
            trace_id: traceId,
            stage: "direct_answer_returned",
            normalized_query: normalizedQuery,
            answer_mode: "direct_grounded",
            routed_source: toolResult.trace?.routed_source,
            retry_attempts: toolResult.trace?.retry_attempts || 0,
            result_counts: toolResult.trace?.result_counts,
            top_score: toolResult.trace?.top_score
          })
          logChatTrace({
            trace_id: traceId,
            stage: "response_ready",
            normalized_query: normalizedQuery,
            answer_mode: "direct_grounded",
            routed_source: toolResult.trace?.routed_source,
            retry_attempts: toolResult.trace?.retry_attempts || 0,
            result_counts: toolResult.trace?.result_counts,
            top_score: toolResult.trace?.top_score
          })
          const directStream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(directAnswerText))
              controller.close()
            }
          })
          finalizeMetrics({
            answerMode: "direct_grounded",
            unavailableReason: toolResult.trace?.unavailable_reason,
            routedSource: toolResult.trace?.routed_source
          })
          return new Response(directStream, {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              ...securityHeaders
            }
          })
        }

        // âœ… Ø§Ù„Ø®Ø·ÙˆØ© 2: streaming Ø­Ù‚ÙŠÙ‚ÙŠ Ù…Ù† OpenAI (ÙŠØ´ØªØºÙ„ Ø¹Ù„Ù‰ Vercel)
        // Ø³ÙˆØ§Ø¡ ÙƒØ§Ù† Ø±Ø¯ Ù…Ø¨Ø§Ø´Ø± Ø£Ùˆ Ø¨Ø¹Ø¯ tool calls â€” Ø¯Ø§Ø¦Ù…Ø§Ù‹ Ù†Ø³ØªØ®Ø¯Ù… stream Ø­Ù‚ÙŠÙ‚ÙŠ
        const streamMessages = toolResult.needsFinalCall
          ? toolResult.resolvedMessages  // Ø¨Ø¹Ø¯ tool calls
          : messagesWithSystem           // Ø³Ø¤Ø§Ù„ Ø¨Ø³ÙŠØ· Ø¨Ø¯ÙˆÙ† Ø£Ø¯ÙˆØ§Øª

        logChatTrace({
          trace_id: traceId,
          stage: "final_stream_started",
          normalized_query: normalizedQuery,
          routed_source: toolResult.trace?.routed_source,
          retry_attempts: toolResult.trace?.retry_attempts || 0,
          details: {
            grounded_temperature: 0.0,
            grounded: true,
            final_call_required: toolResult.needsFinalCall
          }
        })
        logChatTrace({
          trace_id: traceId,
          stage: "grounded_stream_started",
          normalized_query: normalizedQuery,
          routed_source: toolResult.trace?.routed_source,
          retry_attempts: toolResult.trace?.retry_attempts || 0,
          details: {
            grounded_temperature: 0.0,
            grounded: true,
            final_call_required: toolResult.needsFinalCall
          }
        })

        const finalStream = await openai.chat.completions.create({
          model,
          messages: streamMessages,
          temperature: 0.0,
          max_tokens: 1200,
          stream: true
        })

        logChatTrace({
          trace_id: traceId,
          stage: "response_ready",
          normalized_query: normalizedQuery,
          answer_mode: "llm_stream",
          routed_source: toolResult.trace?.routed_source,
          retry_attempts: toolResult.trace?.retry_attempts || 0,
          result_counts: toolResult.trace?.result_counts,
          top_score: toolResult.trace?.top_score,
          unavailable_reason: toolResult.trace?.unavailable_reason
        })

        const stream = new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of finalStream) {
                const content = chunk.choices[0]?.delta?.content || ""
                if (content) {
                  controller.enqueue(new TextEncoder().encode(content))
                }
              }
              controller.close()
            } catch (error) {
              controller.error(error)
            }
          }
        })

        finalizeMetrics({
          answerMode: "llm_stream",
          unavailableReason: toolResult.trace?.unavailable_reason,
          routedSource: toolResult.trace?.routed_source
        })

        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            ...securityHeaders
          }
        })
      } catch (fcError: any) {
        console.error("[Chat API] Streaming FC Error:", fcError)
        if (toolResult?.fallbackAnswer) {
          logChatTrace({
            trace_id: traceId,
            stage: "tool_runtime_grounded_fallback",
            normalized_query: normalizedQuery,
            answer_mode: "direct_grounded",
            routed_source: toolResult.trace?.routed_source,
            retry_attempts: toolResult.trace?.retry_attempts || 0,
            unavailable_reason: fcError?.message || String(fcError || "tool_runtime_failed")
          })
          finalizeMetrics({
            answerMode: "direct_grounded",
            unavailableReason: fcError?.message || String(fcError || "tool_runtime_failed"),
            routedSource: toolResult.trace?.routed_source
          })
          return new Response(toolResult.fallbackAnswer, {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              ...securityHeaders
            },
            status: 200
          })
        }

        const failureKind = classifyRuntimeFailure(fcError)
        const failureMessage = buildRuntimeFailureMessage(failureKind, traceId)
        logChatTrace({
          trace_id: traceId,
          stage: "tool_runtime_degraded",
          normalized_query: normalizedQuery,
          answer_mode: "tool_failure_message",
          unavailable_reason: fcError?.message || String(fcError || "tool_runtime_failed"),
          details: {
            failure_kind: failureKind
          }
        })
        finalizeMetrics({
          answerMode: "tool_failure_message",
          unavailableReason: fcError?.message || String(fcError || "tool_runtime_failed")
        })
        return new Response(failureMessage, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            ...securityHeaders
          },
          status: 200
        })
      }
    }

    // ===== Fallback: Ø¨Ø¯ÙˆÙ† Ø£Ø¯ÙˆØ§Øª =====
    console.log("[Chat API] Standard mode (no tools)")

    const response = await openai.chat.completions.create({
      model,
      messages: messagesWithSystem,
      temperature: boundedTemperature,
      max_tokens: boundedMaxTokens,
      stream: true
    })

    logChatTrace({
      trace_id: traceId,
      stage: "response_ready",
      answer_mode: "fallback_stream"
    })

    const fallbackStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of response) {
            const content = chunk.choices[0]?.delta?.content || ""
            if (content) {
              controller.enqueue(new TextEncoder().encode(content))
            }
          }
          controller.close()
        } catch (error) {
          controller.error(error)
        }
      }
    })

    finalizeMetrics({ answerMode: "fallback_stream" })

    return new Response(fallbackStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...securityHeaders
      }
    })
  } catch (error: any) {
    console.error("Chat API Error:", error)
    finalizeMetrics({
      answerMode: "error",
      unavailableReason: error?.message || "unknown_error"
    })
    logChatTrace({
      trace_id: traceId,
      stage: "runtime_error",
      answer_mode: "error",
      normalized_query: normalizeQueryForTrace(""),
      unavailable_reason: error?.message || "unknown_error"
    })
    logChatTrace({
      trace_id: traceId,
      stage: "request_error",
      answer_mode: "error",
      normalized_query: normalizeQueryForTrace(""),
      unavailable_reason: error?.message || "unknown_error"
    })

    // الحصول على origin للـ security headers
    const errorSecurityHeaders = getSecurityHeaders()

    // معالجة أنواع الأخطاء المختلفة
    const underDevelopmentErrorMessage = `خدمة الرد الآلي قيد التطوير حالياً وقد لا تتوفر الإجابة في هذه اللحظة. يرجى المحاولة بعد قليل.\n\nرقم التتبع: ${traceId}`
    let errorMessage = underDevelopmentErrorMessage
    let statusCode = 500
    let fallbackType: "api_error" | "api_quota_exceeded" = "api_error"

    if (error.message?.toLowerCase().includes("api key not found")) {
      errorMessage = underDevelopmentErrorMessage
      statusCode = 401
    } else if (error.message?.toLowerCase().includes("incorrect api key")) {
      errorMessage = underDevelopmentErrorMessage
      statusCode = 401
    } else if (error.code === "insufficient_quota" || error.message?.toLowerCase().includes("insufficient_quota") || error.message?.toLowerCase().includes("exceeded your current quota")) {
      errorMessage = underDevelopmentErrorMessage
      statusCode = 429
      fallbackType = "api_quota_exceeded"
    } else if (error.message?.toLowerCase().includes("rate limit")) {
      errorMessage = underDevelopmentErrorMessage
      statusCode = 429
    } else if (error.message?.toLowerCase().includes("model")) {
      errorMessage = underDevelopmentErrorMessage
      statusCode = 503
    } else if (error.status) {
      statusCode = error.status
      errorMessage = underDevelopmentErrorMessage
    }

    // Ø¥Ø±Ø¬Ø§Ø¹ Ø±Ø¯ fallback
    return new Response(
      JSON.stringify({
        error: errorMessage,
        fallback: getFallbackResponse(fallbackType)
      }),
      {
        status: statusCode,
        headers: {
          "Content-Type": "application/json",
          ...errorSecurityHeaders
        }
      }
    )
  }
}

