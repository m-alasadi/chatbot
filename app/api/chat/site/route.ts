import {
  getSiteSystemPrompt,
  getFallbackResponse
} from "@/lib/server/system-prompts"
import { getOpenAIModel } from "@/lib/server/site-api-config"
import { ALL_SITE_TOOLS } from "@/lib/server/site-tools-definitions"
import { resolveToolCalls } from "@/lib/server/function-calling-handler"
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
import { ServerRuntime } from "next"
import OpenAI from "openai"
import { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs"

export const runtime: ServerRuntime = "edge"

/**
 * CORS Headers - السماح فقط من دومين محدد
 */
const ALLOWED_ORIGINS = [
  process.env.SITE_DOMAIN || "https://alkafeel.net",
  "http://localhost:3000", // للتطوير
  "http://localhost:3001", // للتطوير (بديل)
  "null" // للـ file:// protocol (HTML files)
]

/**
 * Security Headers
 */
function getSecurityHeaders(origin?: string | null): HeadersInit {
  // السماح لأي origin لأن الودجت يُضمّن في مواقع خارجية
  return {
    "Access-Control-Allow-Origin": origin || "*",
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

/**
 * معالجة OPTIONS request (CORS Preflight)
 */
export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: getSecurityHeaders(request.headers.get("origin"))
  })
}

interface ChatRequest {
  messages: ChatCompletionMessageParam[]
  temperature?: number
  max_tokens?: number
  use_tools?: boolean // خيار لتفعيل/تعطيل الأدوات
}

/**
 * Endpoint موحد للشات مع دعم Function Calling - المرحلة 2 + 4
 * 
 * التطويرات:
 * ✅ Phase 2: دعم Function Calling مع REST API
 * ✅ Phase 3: منع الهلوسة والاقتراحات الذكية
 * ✅ Phase 4: Rate Limiting + Security + Data Sanitization
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin")
  const securityHeaders = getSecurityHeaders(origin)
  const traceId = buildTraceId()

  try {
    // ✅ Phase 4.1: Rate Limiting - حماية من Spam
    const rateLimitResult = applyRateLimit(request, {
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
      temperature = 0.5,
      max_tokens = 1200,
      use_tools = true
    } = json as ChatRequest

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

    // التحقق من صحة آخر رسالة (من المستخدم)
    const lastMessage = sanitizedMessages[sanitizedMessages.length - 1]
    const normalizedQuery = normalizeQueryForTrace(lastMessage?.content || "")
    logChatTrace({
      trace_id: traceId,
      stage: "request_received",
      normalized_query: normalizedQuery,
      details: {
        use_tools,
        message_count: sanitizedMessages.length,
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

    // حقن System Prompt الثابت في بداية المحادثة
    // ✅ نستخدم sanitizedMessages (الرسائل المنظفة) وليس messages الخام
    const systemPrompt = getSiteSystemPrompt()
    const messagesWithSystem: ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: systemPrompt
      },
      ...sanitizedMessages.map(msg => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content
      }))
    ]

    // ===== Streaming Function Calling =====
    if (use_tools) {
      console.log(`[Chat API] Streaming FC (${sanitizedMessages.length} msgs)`)

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
        const toolResult = await resolveToolCalls(
          openai,
          model,
          messagesWithSystem,
          ALL_SITE_TOOLS,
          3,
          { traceId }
        )

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
          console.log(`[Chat API] Returning direct grounded answer (bypassing final LLM call)`)
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
              controller.enqueue(new TextEncoder().encode(toolResult.directAnswer!))
              controller.close()
            }
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
          stage: "grounded_stream_started",
          normalized_query: normalizedQuery,
          routed_source: toolResult.trace?.routed_source,
          retry_attempts: toolResult.trace?.retry_attempts || 0,
          details: {
            grounded_temperature: 0.1,
            grounded: true,
            final_call_required: toolResult.needsFinalCall
          }
        })

        const finalStream = await openai.chat.completions.create({
          model,
          messages: streamMessages,
          temperature: 0.1,
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

        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            ...securityHeaders
          }
        })
      } catch (fcError: any) {
        console.error("[Chat API] Streaming FC Error:", fcError)
        console.log("[Chat API] Falling back to standard mode")
      }
    }

    // ===== Fallback: بدون أدوات =====
    console.log("[Chat API] Standard mode (no tools)")

    const response = await openai.chat.completions.create({
      model,
      messages: messagesWithSystem,
      temperature,
      max_tokens,
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

    return new Response(fallbackStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...securityHeaders
      }
    })
  } catch (error: any) {
    console.error("Chat API Error:", error)
    logChatTrace({
      trace_id: traceId,
      stage: "request_error",
      answer_mode: "error",
      unavailable_reason: error?.message || "unknown_error"
    })

    // الحصول على origin للـ security headers
    const origin = request.headers.get("origin")
    const errorSecurityHeaders = getSecurityHeaders(origin)

    // معالجة أنواع الأخطاء المختلفة
    let errorMessage = "حدث خطأ غير متوقع"
    let statusCode = 500

    if (error.message?.toLowerCase().includes("api key not found")) {
      errorMessage =
        "لم يتم العثور على مفتاح OpenAI API. يرجى التواصل مع المسؤول."
      statusCode = 401
    } else if (error.message?.toLowerCase().includes("incorrect api key")) {
      errorMessage = "مفتاح OpenAI API غير صحيح. يرجى التواصل مع المسؤول."
      statusCode = 401
    } else if (error.message?.toLowerCase().includes("rate limit")) {
      errorMessage = "تم تجاوز الحد المسموح من الطلبات. يرجى المحاولة بعد قليل."
      statusCode = 429
    } else if (error.message?.toLowerCase().includes("model")) {
      errorMessage = `النموذج غير متاح حالياً. يرجى المحاولة لاحقاً.`
      statusCode = 503
    } else if (error.status) {
      statusCode = error.status
      errorMessage = error.message || errorMessage
    }

    // إرجاع رد fallback
    return new Response(
      JSON.stringify({
        error: errorMessage,
        fallback: getFallbackResponse("api_error")
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
