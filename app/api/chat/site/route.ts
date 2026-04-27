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
import { understandQuery, understandQueryWithFallback, getQueryClassKey } from "@/lib/server/query-understanding"
import { requiresPriorConversationContext } from "@/lib/server/runtime/dialog-context-policy"
import type { ServerRuntime } from "next"
import OpenAI from "openai"
import { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs"

export const runtime: ServerRuntime = "edge"

/**
 * Security Headers
 */
function getSecurityHeaders(): HeadersInit {
  // السماح لأي origin لأن الودجت يُضمّن في مواقع خارجية متعددة
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
  const underDevelopmentMessage = `خدمة الرد الآلي قيد التطوير حاليًا وقد لا تتوفر الإجابة في هذه اللحظة. يرجى المحاولة بعد قليل.${traceSuffix}`
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
 * معالجة OPTIONS request (CORS Preflight)
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
  use_tools?: boolean // خيار لتفعيل/تعطيل الأدوات
}

const DEFAULT_CHAT_TEMPERATURE = 0.2
const DEFAULT_CHAT_MAX_TOKENS = 1200
const MAX_CONTEXT_MESSAGES = 12

/**
 * Endpoint موحد للشات مع دعم Function Calling - المرحلة 2 + 4
 * 
 * التطويرات:
 * ✅ Phase 2: دعم Function Calling مع REST API
 * ✅ Phase 3: منع الهلوسة والاقتراحات الذكية
 * ✅ Phase 4: Rate Limiting + Security + Data Sanitization
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

    // ✅ Phase 4.1: Rate Limiting - حماية من Spam
    const rateLimitResult = isLocalLoopbackRequest
      ? { allowed: true, ip: "loopback" as string, retryAfter: undefined }
      : applyRateLimit(request, {
          maxRequests: 20, // 20 طلب
          windowMs: 60 * 1000, // لكل دقيقة
          blockDurationMs: 5 * 60 * 1000 // حظر 5 دقائق عند التجاوز
        })

    if (!rateLimitResult.allowed) {
      console.warn(
        `[Rate Limit] Blocked IP: ${rateLimitResult.ip}, Retry after: ${rateLimitResult.retryAfter}s`
      )

      return createRateLimitResponse(
        rateLimitResult.retryAfter!,
        "تجاوزت الحد المسموح من الطلبات. يُرجى المحاولة بعد قليل."
      )
    }

    // قراءة البيانات
    const json = await request.json()
    const {
      messages,
      temperature = DEFAULT_CHAT_TEMPERATURE,
      max_tokens = DEFAULT_CHAT_MAX_TOKENS,
      use_tools = true
    } = json as ChatRequest

    // توحيد السلوك بين الواجهة والاختبارات عبر ضبط حدود المعلمات.
    const boundedTemperature = Number.isFinite(temperature)
      ? Math.max(0, Math.min(0.3, temperature))
      : DEFAULT_CHAT_TEMPERATURE
    const boundedMaxTokens = Number.isFinite(max_tokens)
      ? Math.max(256, Math.min(DEFAULT_CHAT_MAX_TOKENS, Math.trunc(max_tokens)))
      : DEFAULT_CHAT_MAX_TOKENS

    // التحقق من وجود رسائل
    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({
          error: "يجب إرسال رسالة واحدة على الأقل"
        }),
        { status: 400, headers: securityHeaders }
      )
    }

    // ✅ Phase 4.2: Data Sanitization - تنظيف المدخلات
    // تحويل messages لنوع بسيط للتنظيف
    const simpleMessages = messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    }))
    
    const sanitizedMessages = sanitizeMessages(simpleMessages)
    const boundedMessages = sanitizedMessages.slice(-MAX_CONTEXT_MESSAGES)

    if (boundedMessages.length === 0) {
      return new Response(
        JSON.stringify({
          error: "الرسائل غير صالحة بعد التنظيف"
        }),
        { status: 400, headers: securityHeaders }
      )
    }

    // التحقق من صحة آخر رسالة (من المستخدم)
    const lastMessage = boundedMessages[boundedMessages.length - 1]
    const requestUnderstanding = await understandQueryWithFallback(
      lastMessage?.content || "",
      process.env.OPENAI_API_KEY,
    )
    const keepConversationContext =
      lastMessage?.role === "user" &&
      requiresPriorConversationContext(lastMessage.content || "", requestUnderstanding)
    const effectiveMessages = keepConversationContext
      ? boundedMessages
      : boundedMessages.slice(-1)

    if (
      lastMessage?.role === "user" &&
      keepConversationContext &&
      !boundedMessages.some(message => message.role === "assistant") &&
      isStandaloneReferentialQuestion(lastMessage.content || "")
    ) {
      const clarification = "هذا السؤال يعتمد على السياق السابق. اذكر الاسم أو الموضوع المقصود أولاً ثم سأجيبك بدقة."
      return new Response(clarification, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          ...securityHeaders
        },
        status: 200
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
            error: "المدخلات غير صالحة",
            details: validation.error
          }),
          { status: 400, headers: securityHeaders }
        )
      }

      // استخدام النص النظيف
      lastMessage.content = validation.sanitized!
    }

    // الحصول على OpenAI API Key من البيئة (لا نحتاج Supabase لـ site API)
    const openaiApiKey = process.env.OPENAI_API_KEY
    if (!openaiApiKey) {
      throw new Error("OPENAI_API_KEY not found in environment")
    }

    // الحصول على النموذج من البيئة
    const model = getOpenAIModel()

    // إنشاء عميل OpenAI
    const openai = new OpenAI({
      apiKey: openaiApiKey
    })

    // حقن System Prompt مع فهرس الكيانات الديناميكي
    const entityCatalog = await buildEntityCatalogSnippet()
    const systemPrompt = getSiteSystemPrompt(entityCatalog)
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

        // الخطوة 1: حل جميع tool calls (بدون stream)
        toolResult = await resolveToolCalls(
          openai,
          model,
          messagesWithSystem,
          ALL_SITE_TOOLS,
          3,
          {
            traceId,
            queryUnderstanding: requestUnderstanding
          }
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

        // إذا كان هناك إجابة مباشرة (من evidence عالي الثقة) → أرجعها فوراً
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

        // ✅ الخطوة 2: streaming حقيقي من OpenAI (يشتغل على Vercel)
        // سواء كان رد مباشر أو بعد tool calls — دائماً نستخدم stream حقيقي
        const streamMessages = toolResult.needsFinalCall
          ? toolResult.resolvedMessages  // بعد tool calls
          : messagesWithSystem           // سؤال بسيط بدون أدوات

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

    // ===== Fallback: بدون أدوات =====
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
    const underDevelopmentErrorMessage = `خدمة الرد الآلي قيد التطوير حاليًا وقد لا تتوفر الإجابة في هذه اللحظة. يرجى المحاولة بعد قليل.\n\nرقم التتبع: ${traceId}`
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

    // إرجاع رد fallback
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
