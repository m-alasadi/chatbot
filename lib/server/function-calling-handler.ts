/**
 * Function Calling Handler
 * 
 * يدير تدفق Function Calling من OpenAI:
 * 1. يستقبل function call من OpenAI
 * 2. يتحقق من أن الأداة مسموحة (Whitelist)
 * 3. ينفذ الأداة عبر Service Layer
 * 4. يُرجع النتيجة لـ OpenAI
 */

import OpenAI from "openai"
import { ChatCompletionMessageParam } from "openai/resources/chat/completions"
import {
  isAllowedTool,
  type AllowedToolName
} from "./site-tools-definitions"
import { executeToolByName, type APICallResult } from "./site-api-service"
import { getFallbackResponse } from "./system-prompts"
import {
  isEmptyAPIResponse,
  generateNoResultsSuggestions,
  generateAPIErrorSuggestions,
  extractQueryFromMessage,
  formatSuggestionsForResponse
} from "./smart-suggestions"

/**
 * تنظيف بيانات المشروع لتكون مختصرة ومفيدة لـ GPT
 * يشمل الخصائص المهمة مثل المكان والمواصفات والجهة المنفذة
 */
/** قص نص طويل مع الحفاظ على المعلومات المهمة */
function truncate(text: string, max: number): string {
  if (!text || text.length <= max) return text
  return text.substring(0, max) + "…"
}

function cleanProject(project: any, detailed: boolean = false): any {
  if (!project || typeof project !== "object") return project
  
  const sectionNames = Array.isArray(project.sections)
    ? project.sections.map((s: any) => s.name).filter(Boolean)
    : []

  // استخراج الخصائص المهمة — قص النصوص الطويلة في البحث، كاملة في التفاصيل
  const maxPropLen = detailed ? 2000 : 300
  const properties: Record<string, string> = {}
  if (Array.isArray(project.properties)) {
    for (const prop of project.properties) {
      const val = prop.pivot?.value || prop.value
      if (prop.name && val && typeof val === "string") {
        properties[prop.name] = truncate(val, maxPropLen)
      }
    }
  }

  return {
    id: project.id,
    name: project.name,
    description: truncate(project.description || "", detailed ? 500 : 150),
    sections: sectionNames,
    properties: Object.keys(properties).length > 0 ? properties : undefined,
    url: project.id ? `https://projects.alkafeel.net/project/${project.id}` : null,
  }
}

/**
 * تنظيف نتائج الـ API قبل إرسالها لـ GPT
 */
function cleanResultForGPT(result: APICallResult): any {
  if (!result.success) return result

  const data = result.data
  
  // إذا كانت نتائج بحث (results array) — مختصرة
  if (data?.results && Array.isArray(data.results)) {
    return {
      success: true,
      data: {
        results: data.results.map((p: any) => cleanProject(p, false)),
        total: data.total,
        query: data.query
      }
    }
  }

  // إذا كان مشروع واحد — تفاصيل كاملة
  if (data?.id && data?.name) {
    return {
      success: true,
      data: cleanProject(data, true)
    }
  }

  // فئات أو إحصائيات — إرجاع كما هي
  return result
}

/**
 * نتيجة معالجة Function Calling
 */
export interface FunctionCallResult {
  shouldContinue: boolean // هل نحتاج لإرسال طلب آخر لـ OpenAI؟
  messages: ChatCompletionMessageParam[] // الرسائل لإضافتها للمحادثة
  finalResponse?: string // الرد النهائي (إذا اكتمل)
  error?: string
}

/**
 * معالجة tool call واحد
 * 
 * @param toolCall - معلومات الأداة المراد استدعاءها
 */
async function processToolCall(
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall
): Promise<{
  tool_call_id: string
  role: "tool"
  content: string
}> {
  const toolName = toolCall.function.name
  const toolCallId = toolCall.id

  console.log(`[Function Call] Tool: ${toolName}, ID: ${toolCallId}`)

  // التحقق من Whitelist
  if (!isAllowedTool(toolName)) {
    console.error(`[Function Call] Rejected: ${toolName} not in whitelist`)
    return {
      tool_call_id: toolCallId,
      role: "tool",
      content: JSON.stringify({
        success: false,
        error: `الأداة "${toolName}" غير مسموحة`,
        message: "هذه الأداة غير متاحة حالياً في النظام."
      })
    }
  }

  // تحليل المعاملات
  let args: Record<string, any>
  try {
    args = JSON.parse(toolCall.function.arguments || "{}")
  } catch (error) {
    console.error(`[Function Call] Invalid arguments:`, error)
    return {
      tool_call_id: toolCallId,
      role: "tool",
      content: JSON.stringify({
        success: false,
        error: "معاملات غير صالحة",
        message: "حدث خطأ في تحليل المعاملات."
      })
    }
  }

  // تنفيذ الأداة
  const result: APICallResult = await executeToolByName(
    toolName as AllowedToolName,
    args
  )

  // ✅ Phase 3: معالجة النتائج الفارغة مع اقتراحات ذكية
  if (result.success && isEmptyAPIResponse(result.data)) {
    console.log(`[Function Call] Empty results detected, generating suggestions`)
    
    // استخرج query من المعاملات
    const query = args.query || args.searchTerm || args.keyword || ""
    const category = args.category || undefined
    
    // توليد الاقتراحات الذكية
    const suggestionsResponse = generateNoResultsSuggestions(query, {
      searchedCategory: category,
      attemptedAction: toolName
    })
    
    // إرجاع النتيجة مع الاقتراحات
    return {
      tool_call_id: toolCallId,
      role: "tool",
      content: JSON.stringify({
        success: false,
        empty_results: true,
        message: suggestionsResponse.message,
        suggestions: suggestionsResponse.suggestions,
        context: suggestionsResponse.context,
        original_query: query
      })
    }
  }

  // معالجة الأخطاء مع اقتراحات
  if (!result.success) {
    console.error(`[Function Call] API Error:`, result.error)
    
    const errorSuggestions = generateAPIErrorSuggestions()
    
    return {
      tool_call_id: toolCallId,
      role: "tool",
      content: JSON.stringify({
        success: false,
        error: result.error,
        message: errorSuggestions.message,
        suggestions: errorSuggestions.suggestions,
        context: errorSuggestions.context
      })
    }
  }

  // صياغة الرد العادي (نتائج موجودة)
  // تنظيف البيانات لتكون مختصرة ومفيدة لـ GPT
  const cleanedResult = cleanResultForGPT(result)

  const toolResponse = {
    tool_call_id: toolCallId,
    role: "tool" as const,
    content: JSON.stringify(cleanedResult)
  }

  console.log(
    `[Function Call] Result:`,
    result.success ? "Success" : "Failed"
  )

  return toolResponse
}

/**
 * معالجة مجموعة tool calls من OpenAI
 * 
 * @param toolCalls - قائمة الأدوات المطلوب استدعاءها
 */
export async function handleToolCalls(
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
): Promise<ChatCompletionMessageParam[]> {
  const toolResponses: ChatCompletionMessageParam[] = []

  // معالجة كل أداة
  for (const toolCall of toolCalls) {
    const response = await processToolCall(toolCall)
    toolResponses.push(response)
  }

  return toolResponses
}

/**
 * تدفق كامل لـ Function Calling
 * 
 * يدير التواصل المتكرر مع OpenAI حتى الحصول على رد نهائي
 * 
 * @param openai - عميل OpenAI
 * @param model - نموذج OpenAI
 * @param messages - رسائل المحادثة
 * @param tools - الأدوات المتاحة
 * @param maxIterations - الحد الأقصى للتكرار (لمنع حلقات لا نهائية)
 */
/**
 * تنفيذ tool calls فقط وإرجاع الرسائل الجاهزة للاستدعاء النهائي (streaming)
 * 
 * الفكرة: ننفذ كل tool calls بدون stream، ثم نرجع الرسائل
 * الجاهزة ليقوم route.ts بالاستدعاء الأخير كـ stream مباشرة للمستخدم
 */
export async function resolveToolCalls(
  openai: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  maxIterations: number = 3
): Promise<{
  resolvedMessages: ChatCompletionMessageParam[]
  needsFinalCall: boolean
  iterations: number
  directAnswer?: string
}> {
  let currentMessages = [...messages]
  let iterations = 0
  let toolsWereCalled = false

  while (iterations < maxIterations) {
    iterations++
    console.log(`[Tool Resolution] Iteration ${iterations}`)

    const response = await openai.chat.completions.create({
      model,
      messages: currentMessages,
      tools,
      tool_choice: "auto",
      temperature: 0.5,
      max_tokens: 1200
    })

    const assistantMessage = response.choices[0].message
    currentMessages.push(assistantMessage)

    // إذا لم يستدعِ أدوات
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      if (toolsWereCalled) {
        // ✅ أدوات استُدعيت سابقاً → حذف الرد غير المتدفق
        // route.ts سيعمل streaming حقيقي من OpenAI
        currentMessages.pop()
        console.log(`[Tool Resolution] Tools done, popped answer for streaming`)
        return {
          resolvedMessages: currentMessages,
          needsFinalCall: true,
          iterations
        }
      }
      // سؤال بسيط بدون أدوات → نرجعه كـ directAnswer
      return {
        resolvedMessages: currentMessages,
        needsFinalCall: false,
        iterations,
        directAnswer: assistantMessage.content || ""
      }
    }

    // معالجة tool calls
    toolsWereCalled = true
    console.log(`[Tool Resolution] Processing ${assistantMessage.tool_calls.length} tool call(s)`)
    const toolResponses = await handleToolCalls(assistantMessage.tool_calls)
    currentMessages.push(...toolResponses)
  }

  // وصلنا هنا = tool calls تمت معالجتها → نحتاج streaming call
  return {
    resolvedMessages: currentMessages,
    needsFinalCall: true,
    iterations
  }
}

/**
 * [Legacy] تدفق كامل بدون streaming — يُستخدم كـ fallback
 */
export async function executeFunctionCallingFlow(
  openai: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  maxIterations: number = 3
): Promise<{
  finalMessage: string
  allMessages: ChatCompletionMessageParam[]
  iterations: number
}> {
  let currentMessages = [...messages]
  let iterations = 0
  let finalResponse = ""

  while (iterations < maxIterations) {
    iterations++

    const response = await openai.chat.completions.create({
      model,
      messages: currentMessages,
      tools,
      tool_choice: "auto",
      temperature: 0.5,
      max_tokens: 1200
    })

    const assistantMessage = response.choices[0].message
    currentMessages.push(assistantMessage)

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      finalResponse = assistantMessage.content || ""
      break
    }

    const toolResponses = await handleToolCalls(assistantMessage.tool_calls)
    currentMessages.push(...toolResponses)
  }

  if (!finalResponse && iterations >= maxIterations) {
    finalResponse = getFallbackResponse("api_error")
  }

  return {
    finalMessage: finalResponse,
    allMessages: currentMessages,
    iterations
  }
}

/**
 * تبسيط: معالجة سريعة لـ Function Call واحد فقط
 * (للحالات البسيطة)
 * 
 * @param openai - عميل OpenAI
 * @param model - نموذج OpenAI
 * @param messages - رسائل المحادثة
 * @param tools - الأدوات المتاحة
 */
export async function executeSimpleFunctionCall(
  openai: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[]
): Promise<string> {
  try {
    // استدعاء أول
    const firstResponse = await openai.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.7
    })

    const firstMessage = firstResponse.choices[0].message

    // إذا لم يكن هناك tool call، نرجع الرد مباشرة
    if (!firstMessage.tool_calls || firstMessage.tool_calls.length === 0) {
      return firstMessage.content || ""
    }

    // تنفيذ tool call
    const toolResponses = await handleToolCalls(firstMessage.tool_calls)

    // استدعاء ثاني مع نتائج الأدوات
    const secondResponse = await openai.chat.completions.create({
      model,
      messages: [
        ...messages,
        firstMessage,
        ...toolResponses
      ],
      temperature: 0.7
    })

    return secondResponse.choices[0].message.content || ""
  } catch (error: any) {
    console.error("[Simple Function Call] Error:", error)
    return getFallbackResponse("api_error")
  }
}
