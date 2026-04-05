# مساعد العتبة العباسية المقدسة 

> مساعد ذكي متقدم للاستعلام عن العتبة العباسية المقدسة  باستخدام الذكاء الاصطناعي  
> **✨ الآن كـ Widget قابل للتضمين في أي موقع!**

[![Next.js](https://img.shields.io/badge/Next.js-14.1.0-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o-green)](https://openai.com/)
[![License](https://img.shields.io/badge/License-Proprietary-red)](./license)

---

## 🚀 تضمين سريع (Quick Integration)

**سطرين فقط! أضف هذا الكود في موقعك قبل `</body>`:**

```html
<script src="https://YOUR-VERCEL-DOMAIN/api/widget"></script>
<script>
  AlkafeelWidget.init({
    apiEndpoint: 'https://YOUR-VERCEL-DOMAIN/api/chat/site',
    title: 'مساعدك في المشاريع',
    position: 'left'
  });
</script>
```

✨ **بدون dependencies، 22KB فقط، يعمل مع أي موقع!**

📖 **[دليل التضمين الكامل](WIDGET_INTEGRATION.md)** | 🚀 **[دليل النشر](DEPLOY_GUIDE.md)** | 📝 **[Laravel Integration](QUICK_START.md)**

---

## 📋 جدول المحتويات

- [تضمين سريع](#-تضمين-سريع-quick-integration)
- [نظرة عامة](#-نظرة-عامة)
- [Widget Mode](#-widget-mode)
- [المميزات الرئيسية](#-المميزات-الرئيسية)
- [البنية التقنية](#-البنية-التقنية)
- [هيكل المشروع](#-هيكل-المشروع)
- [التقنيات المستخدمة](#-التقنيات-المستخدمة)
- [نظام Function Calling](#-نظام-function-calling)
- [الأمان والحماية](#-الأمان-والحماية)
- [التثبيت والإعداد](#-التثبيت-والإعداد)
- [المتغيرات البيئية](#-المتغيرات-البيئية)
- [التطوير](#-التطوير)
- [النشر](#-النشر)
- [API Documentation](#-api-documentation)

---

## 🎯 نظرة عامة

**مساعد العتبة العباسية المقدسة** هو تطبيق ويب ذكي مبني بتقنية Next.js 14 يستخدم نماذج OpenAI GPT-4o للإجابة على استفسارات المستخدمين حول مشاريع وأنشطة العتبة العباسية المقدسة.

### 🎁 الجديد: Embeddable Widget Mode

الآن يمكن تضمين المساعد كـ **Widget عائم** في أي موقع!

**Widget Specs:**
- 📦 **حجم صغير**: 22KB فقط (gzipped: ~8KB)
- ⚡ **صفر Dependencies**: Vanilla JavaScript بدون React/Vue
- 🎨 **Style Isolation**: جميع الـ CSS prefixed بـ `alkw-*`
- 🔒 **Secure**: CORS headers + Rate limiting + XSS protection
- 📱 **Responsive**: يعمل على Mobile & Desktop
- 🌍 **RTL Support**: دعم كامل للعربية
- 🚀 **Fast**: يُحمل async، لا يؤثر على سرعة الموقع

**Integration Methods:**
- ✅ Laravel Blade Templates
- ✅ Static HTML
- ✅ WordPress / Drupal
- ✅ أي موقع يدعم JavaScript

### الهدف

توفير واجهة محادثة طبيعية باللغة العربية تمكّن الزوار من:
- البحث عن المشاريع والبرامج
- الاستعلام عن تفاصيل المشاريع
- الحصول على إحصائيات وتقارير
- استكشاف أقسام وفئات المشاريع

### الجمهور المستهدف

- زوار موقع alkafeel.net
- الباحثون عن معلومات حول العتبة العباسية المقدسة
- المهتمون بأنشطة وخدمات العتبة المقدسة

---

## ✨ المميزات الرئيسية

### 🤖 ذكاء اصطناعي متقدم

- **نموذج GPT-4o**: استخدام أحدث نماذج OpenAI للفهم العميق للغة العربية
- **Function Calling**: تكامل ذكي مع REST API للحصول على بيانات حقيقية ودقيقة
- **Context Awareness**: الحفاظ على سياق المحادثة عبر الرسائل المتعددة
- **منع الهلوسة**: النظام يعتمد فقط على البيانات الحقيقية من API ولا يخترع معلومات

### 🔍 البحث والاستعلام

- **بحث عميق**: البحث في جميع محتويات المشاريع (الاسم، الوصف، المواصفات، المكان)
- **فلترة ذكية**: تصفية المشاريع حسب الأقسام والفئات
- **نتائج مرتبة**: النتائج مرتبة حسب درجة التطابق
- **اقتراحات ذكية**: توليد اقتراحات بديلة عند عدم وجود نتائج

### 🛡️ الأمان والحماية

- **Rate Limiting**: حماية من إساءة الاستخدام والـ DDoS
- **Data Sanitization**: تنظيف المدخلات من المحتوى الضار
- **CORS Protection**: قيود صارمة على المصادر المسموح بها
- **Sensitive Data Removal**: إزالة البيانات الحساسة من الاستجابات
- **Security Headers**: رؤوس أمان شاملة (CSP, XSS Protection, etc.)

### 🌐 دعم متعدد اللغات

- **i18n Support**: دعم كامل للغة العربية مع إمكانية التوسع
- **RTL Support**: واجهة مخصصة للكتابة من اليمين لليسار
- **Dynamic Routing**: مسارات ديناميكية حسب اللغة

### 📱 Progressive Web App (PWA)

- **Offline Support**: عمل التطبيق بدون إنترنت (محدود)
- **Install on Device**: إمكانية تثبيت التطبيق على الجهاز
- **Service Worker**: تحسين الأداء والتخزين المؤقت

### 🎨 واجهة مستخدم حديثة

- **Responsive Design**: تصميم متجاوب يعمل على جميع الأجهزة
- **Dark/Light Mode**: دعم الوضع الداكن والفاتح
- **Smooth Animations**: حركات سلسة ومريحة للعين
- **Modern UI Components**: استخدام Radix UI و Tailwind CSS

---

## 🏗️ البنية التقنية

### Architecture Overview

```
┌─────────────────┐
│   User Browser  │
│   (Client)      │
└────────┬────────┘
         │ HTTP Request
         ▼
┌─────────────────────────────────────────────┐
│           Next.js 14 App                     │
│                                              │
│  ┌────────────────────────────────────┐    │
│  │  Middleware                         │    │
│  │  - Route to /ar by default          │    │
│  │  - Locale detection                 │    │
│  └────────────────────────────────────┘    │
│                                              │
│  ┌────────────────────────────────────┐    │
│  │  API Route: /api/chat/site          │    │
│  │                                      │    │
│  │  1. Rate Limiter                    │    │
│  │  2. Data Sanitizer                  │    │
│  │  3. OpenAI Client                   │    │
│  │  4. Function Calling Handler        │    │
│  └────────────┬───────────────────────┘    │
│               │                              │
└───────────────┼──────────────────────────────┘
                │
                ▼
   ┌────────────────────────┐
   │   OpenAI GPT-4o API    │
   │   - Chat Completion    │
   │   - Function Calling   │
   └────────────┬───────────┘
                │
                ▼
   ┌────────────────────────┐
   │  Function Execution    │
   │  - search_projects     │
   │  - get_project_by_id   │
   │  - get_latest_projects │
   │  - filter_projects     │
   │  - get_statistics      │
   └────────────┬───────────┘
                │
                ▼
   ┌────────────────────────┐
   │  Site REST API         │
   │  (projects.alkafeel)   │
   └────────────────────────┘
```

### Request Flow

1. **User Input**: المستخدم يكتب سؤال في واجهة الشات
2. **Client Request**: إرسال POST request إلى `/api/chat/site`
3. **Rate Limiting**: التحقق من عدد الطلبات من نفس IP
4. **Data Sanitization**: تنظيف المدخلات من المحتوى الضار
5. **System Prompt Injection**: حقن تعليمات النظام الثابتة
6. **OpenAI Request**: إرسال الرسائل إلى GPT-4o مع تعريف الأدوات
7. **Function Calling**: إذا قرر GPT استدعاء أداة:
   - التحقق من أن الأداة مسموحة (Whitelist)
   - تنفيذ الأداة عبر API Service
   - إرجاع النتيجة لـ GPT
   - تكرار العملية حتى 5 مرات
8. **Response Generation**: GPT يولد رد نهائي بناءً على البيانات
9. **Data Sanitization**: تنظيف الاستجابة من البيانات الحساسة
10. **Client Response**: إرسال الرد للمستخدم

---

## 📁 هيكل المشروع

```
chatbot/
│
├── 📁 app/                          # Next.js App Directory
│   ├── 📁 [locale]/                # Dynamic locale routes (Arabic)
│   │   ├── 📄 layout.tsx           # Root layout with RTL support
│   │   ├── 📄 page.tsx             # Homepage with chat interface
│   │   └── 📄 globals.css          # Global styles
│   │
│   └── 📁 api/                     # API Routes
│       └── 📁 chat/
│           └── 📁 site/
│               └── 📄 route.ts     # Main chat endpoint
│
├── 📁 lib/                          # Shared libraries
│   └── 📁 server/                  # Server-side only modules
│       ├── 📄 system-prompts.ts          # System prompts (Arabic)
│       ├── 📄 site-api-config.ts         # API configuration
│       ├── 📄 site-api-service.ts        # API service layer
│       ├── 📄 site-tools-definitions.ts  # Function calling tools
│       ├── 📄 function-calling-handler.ts # Function calling logic
│       ├── 📄 rate-limiter.ts            # Rate limiting
│       ├── 📄 data-sanitizer.ts          # Data sanitization
│       ├── 📄 smart-suggestions.ts       # Smart suggestions
│       └── 📄 site-categories.ts         # Site categories data
│
├── 📁 public/                       # Static assets
│   ├── 📄 manifest.json            # PWA manifest
│   ├── 📄 sw.js                    # Service worker
│   └── 📄 workbox-*.js             # Workbox for PWA
│
├── 📄 middleware.ts                 # Next.js middleware (routing)
├── 📄 next.config.js                # Next.js configuration
├── 📄 tsconfig.json                 # TypeScript configuration
├── 📄 package.json                  # Dependencies
├── 📄 .env.local                    # Environment variables (not in git)
└── 📄 README.md                     # Documentation (هذا الملف)
```

### Core Modules Breakdown

#### 🎯 App Directory (`app/`)

**Purpose**: Next.js 14 App Router structure

##### `[locale]/page.tsx` - Homepage Component
- واجهة المحادثة الرئيسية
- إدارة حالة الرسائل
- التعامل مع إرسال واستقبال الرسائل
- عرض الرسائل بتنسيق Markdown

##### `api/chat/site/route.ts` - Main API Endpoint
- نقطة النهاية الرئيسية للشات
- تطبيق Rate Limiting
- تطبيق Data Sanitization
- إرسال الطلبات لـ OpenAI
- معالجة Function Calling

#### 🛠️ Server Library (`lib/server/`)

**Purpose**: Server-side only logic (never exposed to client)

##### `system-prompts.ts` - AI Instructions
```typescript
// System prompt ثابت لا يمكن تعديله من المستخدم
export const SITE_BOT_SYSTEM_PROMPT = `...`

// Fallback responses
export const FALLBACK_NO_RESULTS = `...`
export const FALLBACK_API_ERROR = `...`
export const FALLBACK_OUT_OF_SCOPE = `...`

// Helper functions
getSiteSystemPrompt(customInstructions?)
getFallbackResponse(type)
```

**Key Features**:
- تعليمات واضحة للبوت بالعربية
- قواعد صارمة لمنع الهلوسة
- استراتيجيات الإجابة على الأسئلة
- رسائل fallback جاهزة

##### `site-tools-definitions.ts` - Function Calling Tools
```typescript
// أدوات متاحة للبوت
export const TOOL_SEARCH_PROJECTS: ChatCompletionTool
export const TOOL_GET_PROJECT_BY_ID: ChatCompletionTool
export const TOOL_FILTER_PROJECTS: ChatCompletionTool
export const TOOL_GET_LATEST_PROJECTS: ChatCompletionTool
export const TOOL_GET_STATISTICS: ChatCompletionTool

// All tools array
export const ALL_SITE_TOOLS: ChatCompletionTool[]

// Whitelist check
export function isAllowedTool(name: string): boolean
export type AllowedToolName = 'search_projects' | 'get_project_by_id' | ...
```

**Key Features**:
- تعريف كامل لكل أداة للـ OpenAI
- وصف دقيق بالعربية
- معاملات مع validation
- Whitelist للأدوات المسموحة فقط

##### `function-calling-handler.ts` - Function Calling Logic
```typescript
// Main execution flow
export async function executeFunctionCallingFlow(
  openai: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[],
  maxIterations: number = 5
): Promise<FunctionCallingResult>

// Helper functions
function cleanProject(project: any): any
function cleanResultForGPT(result: APICallResult): any
```

**Key Features**:
- إدارة تدفق Function Calling الكامل
- معالجة متعددة (حتى 5 تكرارات)
- تنظيف البيانات قبل إرسالها لـ GPT
- معالجة الأخطاء

##### `site-api-service.ts` - API Communication Layer
```typescript
// Main API call function
export async function callSiteAPI(
  endpoint: string,
  options?: APIRequestOptions
): Promise<APICallResult>

// Tool execution
export async function executeToolByName(
  toolName: AllowedToolName,
  args: Record<string, any>
): Promise<APICallResult>

// Helper functions
async function fetchWithTimeout(...)
async function retryOperation(...)
```

**Key Features**:
- طبقة موحدة للتواصل مع REST API
- Timeout و Retry logic
- معالجة الأخطاء
- تنفيذ الأدوات بأمان

##### `rate-limiter.ts` - Rate Limiting
```typescript
export interface RateLimiterConfig {
  maxRequests: number      // مثلاً: 20
  windowMs: number          // مثلاً: 60000 (1 دقيقة)
  blockDurationMs: number   // مثلاً: 300000 (5 دقائق)
}

export function applyRateLimit(req: Request, config?: RateLimiterConfig)
export function getClientIP(req: Request): string
export function createRateLimitResponse(retryAfter: number, message?: string)
```

**Key Features**:
- حماية من Spam و DDoS
- تتبع الطلبات بناءً على IP
- حظر مؤقت عند التجاوز
- تنظيف تلقائي للبيانات القديمة

##### `data-sanitizer.ts` - Security & Data Cleaning
```typescript
// Input validation
export function validateAndSanitize(input: string): ValidationResult
export function sanitizeMessages(messages: any[]): any[]

// Output sanitization
export function removeSensitiveFields(data: any): any
export function sanitizeAPIResponse(response: any): any

// XSS protection
export function stripHTMLTags(str: string): string
export function escapeHTML(str: string): string
```

**Key Features**:
- التحقق من صحة المدخلات
- إزالة HTML tags و scripts
- حذف البيانات الحساسة
- حماية من XSS و Injection attacks

##### `smart-suggestions.ts` - Intelligent Suggestions
```typescript
export function generateNoResultsSuggestions(query: string): SuggestionResponse
export function generateAPIErrorSuggestions(): SuggestionResponse
export function generateOutOfScopeSuggestions(query: string): SuggestionResponse
export function extractQueryFromMessage(message: string): string
```

**Key Features**:
- توليد اقتراحات عند عدم وجود نتائج
- اقتراح أقسام وفئات ذات صلة
- اقتراحات عند الأخطاء
- توجيه المستخدم داخل النطاق

##### `site-categories.ts` - Categories Data
```typescript
export interface SiteCategory {
  id: string
  name: string
  nameAr: string
  examples: string[]
  keywords: string[]
}

export const SITE_CATEGORIES: SiteCategory[]
export const COMMON_SEARCH_TERMS: string[]
export const SUGGESTED_QUESTIONS: string[]

export function findCategoryByKeywords(query: string): SiteCategory | null
```

**Key Features**:
- قائمة شاملة بأقسام الموقع
- كلمات مفتاحية للبحث
- أسئلة مقترحة شائعة
- مطابقة الاستعلامات مع الفئات

---

## 🔧 التقنيات المستخدمة

### Frontend/Backend Framework

#### Next.js 14.1.0
- **App Router**: البنية الجديدة لـ Next.js
- **Server Components**: تحسين الأداء
- **Edge Runtime**: تشغيل API routes على الحافة
- **File-based Routing**: توجيه تلقائي بناءً على الملفات

### Language & Type Safety

#### TypeScript 5.0
- **Type Safety**: أمان نوعي كامل
- **IntelliSense**: دعم أفضل في IDEs
- **Interfaces**: تعريف واضح للبيانات
- **Compile-time Errors**: اكتشاف الأخطاء قبل التشغيل

### AI & Machine Learning

#### OpenAI SDK (^0.18.0)
- **GPT-4o Model**: أحدث نماذج OpenAI
- **Chat Completions API**: محادثة متقدمة
- **Function Calling**: تكامل مع APIs خارجية
- **Streaming Support**: استجابة تدريجية (متاح)

#### Alternative AI Providers (مدعومة)
- **Anthropic Claude** (@anthropic-ai/sdk)
- **Google Gemini** (@google/generative-ai)
- **Azure OpenAI** (@azure/openai)
- **Mistral AI** (@mistralai/mistralai)

### UI Framework & Styling

#### React 18
- **Hooks**: useState, useEffect, useRef
- **Client Components**: تفاعل ديناميكي
- **Server Components**: أداء محسّن

#### Tailwind CSS 3.3.5
- **Utility-first CSS**: تصميم سريع
- **Responsive Design**: تصميم متجاوب
- **Dark Mode Support**: دعم الوضع الداكن
- **Custom Animations**: حركات مخصصة

#### Radix UI
مكتبة مكونات React شاملة:
- `@radix-ui/react-dialog`: نوافذ منبثقة
- `@radix-ui/react-dropdown-menu`: قوائم منسدلة
- `@radix-ui/react-select`: حقول اختيار
- `@radix-ui/react-toast`: إشعارات
- `@radix-ui/react-tooltip`: تلميحات
- وغيرها... (20+ مكون)

### Content Rendering

#### React Markdown (^9.0.1)
- **Markdown Support**: عرض Markdown في الردود
- **Syntax Highlighting**: تلوين الكود
- **Math Support**: معادلات رياضية (KaTeX)
- **GFM Support**: GitHub Flavored Markdown

```typescript
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
```

### Internationalization (i18n)

#### i18next (^23.7.16)
- **Multiple Languages**: دعم عدة لغات
- **Dynamic Loading**: تحميل ديناميكي للترجمات
- **Next.js Integration**: تكامل مع Next.js

#### next-i18n-router (^5.2.0)
- **Automatic Routing**: توجيه تلقائي حسب اللغة
- **Locale Detection**: اكتشاف لغة المستخدم

### Progressive Web App (PWA)

#### next-pwa (5.6.0)
- **Service Worker**: تخزين مؤقت
- **Offline Support**: عمل بدون إنترنت
- **Install Prompt**: تثبيت على الجهاز
- **Background Sync**: مزامنة خلفية

### State Management & Forms

#### React Hook Form (^7.48.2)
- **Form Validation**: التحقق من النماذج
- **TypeScript Support**: دعم كامل لـ TypeScript
- **Performance**: أداء محسّن

#### Zod (^3.22.4)
- **Schema Validation**: التحقق من البيانات
- **TypeScript Integration**: تكامل مع TypeScript

### Other Libraries

#### Vercel Tools
- `@vercel/analytics`: تحليلات الموقع
- `@vercel/edge-config`: إعدادات Edge

#### Icons & UI Enhancements
- `@tabler/icons-react`: أيقونات جميلة
- `lucide-react`: أيقونات إضافية
- `sonner`: إشعارات Toast جميلة

#### Utilities
- `uuid`: توليد معرفات فريدة
- `clsx` / `tailwind-merge`: دمج CSS classes
- `date-fns`: معالجة التواريخ
- `gpt-tokenizer`: عد الـ tokens

### Development Tools

#### ESLint & Prettier
- **Code Quality**: جودة الكود
- **Formatting**: تنسيق تلقائي
- **Linting**: اكتشاف الأخطاء

#### Testing (متاح)
- `@testing-library/react`
- `@testing-library/jest-dom`
- `jest`

#### Bundle Analyzer
- `@next/bundle-analyzer`: تحليل حجم البناء

---

## 🔌 نظام Function Calling

Function Calling هو تقنية من OpenAI تسمح لنماذج GPT باستدعاء دوال خارجية والحصول على بيانات حقيقية.

### كيف يعمل؟

#### 1. تعريف الأدوات

نقوم بتعريف الأدوات المتاحة للبوت في `site-tools-definitions.ts`:

```typescript
export const TOOL_SEARCH_PROJECTS: ChatCompletionTool = {
  type: "function",
  function: {
    name: "search_projects",
    description: "البحث العميق في مشاريع موقع alkafeel.net...",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "كلمة البحث بالعربية"
        },
        section: {
          type: "string",
          enum: ["المشاريع الطبية", "المشاريع التعليمية", ...]
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 50
        }
      },
      required: ["query"]
    }
  }
}
```

#### 2. إرسال الأدوات لـ OpenAI

```typescript
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: messagesWithSystem,
  tools: ALL_SITE_TOOLS,  // جميع الأدوات
  tool_choice: "auto"      // GPT يقرر متى يستخدمها
})
```

#### 3. معالجة Function Call

عندما يقرر GPT استدعاء أداة:

```typescript
if (response.choices[0].finish_reason === "tool_calls") {
  const toolCalls = response.choices[0].message.tool_calls!
  
  for (const toolCall of toolCalls) {
    const toolName = toolCall.function.name
    const args = JSON.parse(toolCall.function.arguments)
    
    // 1. التحقق من أن الأداة مسموحة
    if (!isAllowedTool(toolName)) {
      throw new Error(`Unauthorized tool: ${toolName}`)
    }
    
    // 2. تنفيذ الأداة
    const result = await executeToolByName(toolName, args)
    
    // 3. إرجاع النتيجة لـ GPT
    messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(result)
    })
  }
  
  // 4. إعادة استدعاء GPT مع النتائج
  const nextResponse = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: messages,
    tools: ALL_SITE_TOOLS
  })
}
```

#### 4. الاستجابة النهائية

بعد معالجة Function Calls، GPT يولد رد نهائي بناءً على البيانات:

```typescript
if (response.choices[0].finish_reason === "stop") {
  return {
    success: true,
    message: response.choices[0].message.content,
    iterations: iterationCount
  }
}
```

### الأدوات المتاحة

| الأداة | الوصف | المعاملات |
|--------|-------|-----------|
| `search_projects` | البحث في المشاريع | `query`, `section?`, `limit?` |
| `get_project_by_id` | تفاصيل مشروع محدد | `id` |
| `filter_projects` | قائمة الفئات | `include_counts?` |
| `get_latest_projects` | أحدث المشاريع | `limit?`, `section?` |
| `get_statistics` | إحصائيات عامة | - |

### Whitelist System

لحماية النظام، نستخدم Whitelist للأدوات المسموحة فقط:

```typescript
const ALLOWED_TOOLS = [
  "search_projects",
  "get_project_by_id",
  "filter_projects",
  "get_latest_projects",
  "get_statistics"
] as const

export function isAllowedTool(toolName: string): toolName is AllowedToolName {
  return ALLOWED_TOOLS.includes(toolName as AllowedToolName)
}
```

### مثال على التدفق الكامل

```
User: "أريد مشاريع طبية"
  ↓
GPT: يقرر استدعاء search_projects
  ↓
Function Call: search_projects({ query: "طبية", section: "المشاريع الطبية", limit: 5 })
  ↓
API Service: يستدعي REST API
  ↓
REST API: يرجع 5 مشاريع طبية
  ↓
Function Result: يعيد النتائج لـ GPT
  ↓
GPT: يولد رد طبيعي بالعربية مع روابط المشاريع
  ↓
User: يحصل على رد منسق وجميل
```

---

## 🛡️ الأمان والحماية

الأمان في المقدمة. النظام يحتوي على طبقات حماية متعددة:

### 1. Rate Limiting

**الهدف**: منع إساءة الاستخدام والـ DDoS attacks

**الآلية**:
```typescript
const rateLimitResult = applyRateLimit(request, {
  maxRequests: 20,           // 20 طلب
  windowMs: 60 * 1000,       // في الدقيقة
  blockDurationMs: 5 * 60 * 1000  // حظر 5 دقائق
})
```

**كيف يعمل**:
1. تتبع عدد الطلبات لكل IP
2. إذا تجاوز الحد المسموح، يتم الحظر المؤقت
3. تنظيف تلقائي للبيانات القديمة كل 5 دقائق

**Storage**: In-memory (للإنتاج يُفضل Redis)

### 2. Data Sanitization

**الهدف**: تنظيف المدخلات والمخرجات من المحتوى الضار

#### Input Sanitization
```typescript
// التحقق من المدخلات
const validation = validateAndSanitize(userInput)

if (!validation.valid) {
  return { error: validation.error }
}

// استخدام النص النظيف
const cleanInput = validation.sanitized
```

**ما يتم فحصه**:
- ✅ Length validation (max 4000 chars)
- ✅ Empty input detection
- ✅ HTML tags removal
- ✅ Script injection detection
- ✅ SQL/NoSQL injection patterns

#### Output Sanitization
```typescript
// إزالة البيانات الحساسة
const cleanData = removeSensitiveFields(apiResponse)
```

**ما يتم إزالته**:
- 🔒 Passwords
- 🔒 API Keys & Tokens
- 🔒 Credit Card Numbers
- 🔒 SSN & National IDs
- 🔒 Private Keys
- 🔒 Email addresses (optional)
- 🔒 Phone numbers (optional)

### 3. CORS Protection

**الهدف**: السماح فقط للنطاقات الموثوقة

```typescript
const ALLOWED_ORIGINS = [
  "https://alkafeel.net",  // Production
  "http://localhost:3000",          // Development
  "http://localhost:3001"           // Development (alternative)
]

function getSecurityHeaders(origin?: string): HeadersInit {
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0]

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  }
}
```

### 4. Security Headers

**الهدف**: حماية من مختلف الهجمات

```typescript
{
  "X-Content-Type-Options": "nosniff",       // منع MIME sniffing
  "X-Frame-Options": "DENY",                  // منع Clickjacking
  "X-XSS-Protection": "1; mode=block",        // حماية XSS
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'self'"
}
```

### 5. Function Calling Whitelist

**الهدف**: السماح فقط بالأدوات المعرّفة مسبقاً

```typescript
// تحقق قبل تنفيذ أي أداة
if (!isAllowedTool(toolName)) {
  logSecurityIssue("Unauthorized Tool", { toolName }, clientIP)
  throw new Error(`Unauthorized tool: ${toolName}`)
}
```

### 6. Environment Variables Protection

**الهدف**: عدم تسريب البيانات الحساسة

- ✅ جميع API Keys في `.env.local` (not in git)
- ✅ Server-side only access
- ✅ No exposure to client
- ✅ Validation on startup

### 7. System Prompt Protection

**الهدف**: منع المستخدم من تعديل تعليمات البوت

```typescript
// System prompt ثابت في السيرفر
const systemPrompt = getSiteSystemPrompt()

// يُحقن في بداية كل محادثة
const messagesWithSystem = [
  { role: "system", content: systemPrompt },
  ...userMessages
]
```

المستخدم **لا يمكنه**:
- تعديل System Prompt
- حقن تعليمات جديدة
- تجاوز القواعد المحددة

### 8. API Timeout & Retry

**الهدف**: منع تعليق الطلبات

```typescript
const API_TIMEOUT_MS = 30000  // 30 ثانية
const MAX_RETRIES = 1          // محاولة واحدة فقط

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    return response
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Timeout after ${timeoutMs}ms`)
    }
    throw error
  }
}
```

### 9. Logging & Monitoring

```typescript
export function logSecurityIssue(
  type: string,
  details: any,
  ip?: string
) {
  console.warn(`[Security Alert] ${type}`, {
    timestamp: new Date().toISOString(),
    ip,
    details
  })
  
  // في Production: إرسال لخدمة monitoring
}
```

### Security Checklist

| الميزة | الحالة |
|--------|--------|
| Rate Limiting | ✅ Implemented |
| Input Sanitization | ✅ Implemented |
| Output Sanitization | ✅ Implemented |
| CORS Protection | ✅ Implemented |
| Security Headers | ✅ Implemented |
| XSS Protection | ✅ Implemented |
| SQL Injection Protection | ✅ Implemented |
| Function Whitelist | ✅ Implemented |
| API Timeout | ✅ Implemented |
| Sensitive Data Removal | ✅ Implemented |
| HTTPS Only | ⚠️ Production Only |
| API Key Rotation | ⚠️ Manual |
| Logging & Monitoring | ⚠️ Basic |

---

## 💻 التثبيت والإعداد

### المتطلبات

قبل البدء، تأكد من تثبيت:

- **Node.js**: 20.x أو أحدث
- **npm** أو **yarn** أو **pnpm**
- **Git**: لإدارة النسخ

### خطوات التثبيت

#### 1. استنساخ المشروع

```bash
git clone <repository-url>
cd chatbot
```

#### 2. تثبيت التبعيات

```bash
# باستخدام npm
npm install

# أو باستخدام yarn
yarn install

# أو باستخدام pnpm
pnpm install
```

#### 3. إعداد المتغيرات البيئية

أنسخ ملف `.env.local.example` إلى `.env.local`:

```bash
cp .env.local.example .env.local
```

أو في Windows PowerShell:

```powershell
Copy-Item .env.local.example .env.local
```

#### 4. تعبئة المتغيرات البيئية

افتح `.env.local` وأضف القيم المطلوبة:

```env
# OpenAI Configuration
OPENAI_API_KEY=sk-...                    # مطلوب
OPENAI_MODEL=gpt-4o                       # اختياري (افتراضي: gpt-4o)

# Site API Configuration
SITE_API_BASE_URL=https://alkafeel.net/v1    # مطلوب
SITE_API_TOKEN=your-api-token-here       # اختياري
SITE_DOMAIN=https://alkafeel.net # اختياري

# Optional: Alternative AI Providers
ANTHROPIC_API_KEY=sk-ant-...             # لاستخدام Claude
GOOGLE_API_KEY=...                        # لاستخدام Gemini
AZURE_OPENAI_ENDPOINT=...                 # لاستخدام Azure OpenAI
MISTRAL_API_KEY=...                       # لاستخدام Mistral
```

#### 5. تشغيل التطوير

```bash
npm run dev
# أو
yarn dev
# أو
pnpm dev
```

افتح المتصفح على [http://localhost:3000](http://localhost:3000)

#### 6. البناء للإنتاج

```bash
npm run build
npm run start
```

---

## 🔐 المتغيرات البيئية

### المتغيرات المطلوبة

| المتغير | الوصف | مثال |
|---------|-------|------|
| `OPENAI_API_KEY` | مفتاح OpenAI API | `sk-proj-...` |
| `SITE_API_BASE_URL` | رابط REST API للموقع | `https://alkafeel.net/v1` |

### المتغيرات الاختيارية

| المتغير | الوصف | القيمة الافتراضية |
|---------|-------|-------------------|
| `OPENAI_MODEL` | نموذج OpenAI المستخدم | `gpt-4o` |
| `SITE_API_TOKEN` | توكن مصادقة للـ API | `null` (بدون مصادقة) |
| `SITE_DOMAIN` | نطاق الموقع الأساسي | `https://alkafeel.net` |
| `NODE_ENV` | بيئة التشغيل | `development` |
| `NEXT_PUBLIC_APP_URL` | رابط التطبيق (للـ PWA) | `http://localhost:3000` |

### مقدمي AI البديلين (اختياري)

```env
# Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-...

# Google Gemini
GOOGLE_API_KEY=...

# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://...
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_DEPLOYMENT_NAME=...

# Mistral AI
MISTRAL_API_KEY=...
```

### Security Notes

⚠️ **مهم جداً**:
- لا ترفع ملف `.env.local` إلى Git أبداً
- احفظ المفاتيح في مكان آمن
- استخدم مفاتيح مختلفة للتطوير والإنتاج
- قم بتدوير المفاتيح بشكل دوري

---

## 🚀 التطوير

### Structure النموذجية

```bash
# تشغيل Dev Server
npm run dev

# Build للإنتاج
npm run build

# تشغيل Production Build محلياً
npm run start

# Linting
npm run lint
```

### Scripts المتاحة

| الأمر | الوصف |
|-------|-------|
| `npm run dev` | تشغيل Development Server على port 3000 |
| `npm run build` | بناء التطبيق للإنتاج |
| `npm run start` | تشغيل Production Build |
| `npm run lint` | فحص الكود بـ ESLint |

### Development Workflow

1. **إنشاء Feature Branch**
   ```bash
   git checkout -b feature/new-feature-name
   ```

2. **تطوير الميزة**
   - اكتب الكود في الملفات المناسبة
   - اتبع معايير TypeScript و React
   - أضف التعليقات باللغة العربية حيث مناسب

3. **Testing**
   - اختبر الميزة محلياً
   - تأكد من عدم وجود أخطاء في Console
   - اختبر على أحجام شاشات مختلفة

4. **Code Quality**
   ```bash
   npm run lint  # تحقق من الأخطاء
   ```

5. **Commit & Push**
   ```bash
   git add .
   git commit -m "feat: وصف الميزة الجديدة"
   git push origin feature/new-feature-name
   ```

6. **Pull Request**
   - افتح PR على GitHub
   - اشرح التغييرات بالتفصيل
   - انتظر المراجعة

### Best Practices

#### Code Style

```typescript
// ✅ Good: وصف واضح بالعربية
/**
 * دالة للبحث في المشاريع
 * @param query - كلمة البحث
 * @param limit - عدد النتائج المطلوبة
 */
export async function searchProjects(query: string, limit: number = 10) {
  // ...
}

// ❌ Bad: بدون تعليقات
export async function searchProjects(query: string, limit: number = 10) {
  // ...
}
```

#### Error Handling

```typescript
// ✅ Good: معالجة شاملة للأخطاء
try {
  const result = await callAPI()
  return { success: true, data: result }
} catch (error) {
  console.error("[API Error]", error)
  return {
    success: false,
    error: error instanceof Error ? error.message : "Unknown error"
  }
}

// ❌ Bad: بدون معالجة
const result = await callAPI()  // قد يفشل!
```

#### TypeScript Types

```typescript
// ✅ Good: أنواع واضحة
interface ProjectSearchParams {
  query: string
  section?: string
  limit?: number
}

async function searchProjects(params: ProjectSearchParams) {
  // ...
}

// ❌ Bad: any types
async function searchProjects(params: any) {
  // ...
}
```

### File Organization

- **`app/`**: Client-side React components
- **`lib/server/`**: Server-side only logic
- **`public/`**: Static assets
- **`types/`**: Shared TypeScript types (if needed)

### Adding New Tools

لإضافة أداة جديدة للبوت:

1. **عرّف الأداة** في `site-tools-definitions.ts`:
   ```typescript
   export const TOOL_NEW_FEATURE: ChatCompletionTool = {
     type: "function",
     function: {
       name: "new_feature",
       description: "وصف الأداة الجديدة بالعربية",
       parameters: { /* ... */ }
     }
   }
   ```

2. **أضفها للـ Whitelist**:
   ```typescript
   const ALLOWED_TOOLS = [
     // ... existing tools
     "new_feature"
   ] as const
   ```

3. **أضف في `ALL_SITE_TOOLS`**:
   ```typescript
   export const ALL_SITE_TOOLS = [
     // ... existing tools
     TOOL_NEW_FEATURE
   ]
   ```

4. **نفّذ الـ API Handler** في `site-api-service.ts`:
   ```typescript
   export async function executeToolByName(
     toolName: AllowedToolName,
     args: Record<string, any>
   ): Promise<APICallResult> {
     switch (toolName) {
       // ... existing cases
       case "new_feature":
         return await callSiteAPI("/new-endpoint", {
           params: args
         })
     }
   }
   ```

---

## 📦 النشر

### Vercel (موصى به)

الطريقة الأسهل والأسرع:

1. **دفع الكود إلى GitHub**
   ```bash
   git push origin main
   ```

2. **ربط مع Vercel**
   - اذهب إلى [vercel.com](https://vercel.com)
   - اربط حساب GitHub
   - استيراد المشروع

3. **تعيين Environment Variables**
   - في Vercel Dashboard → Settings → Environment Variables
   - أضف جميع المتغيرات من `.env.local`
   - تأكد من تحديد البيئة (Production, Preview, Development)

4. **Deploy**
   - Vercel يقوم بالـ Deploy تلقائياً
   - كل push إلى main = نشر تلقائي

### Docker

إذا كنت تفضل استخدام Docker:

#### Dockerfile

```dockerfile
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED 1
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000

CMD ["node", "server.js"]
```

#### docker-compose.yml

```yaml
version: '3.8'

services:
  chatbot:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env.local
    restart: unless-stopped
```

#### Build & Run

```bash
# Build
docker build -t alkafeel-chatbot .

# Run
docker run -p 3000:3000 --env-file .env.local alkafeel-chatbot

# أو باستخدام docker-compose
docker-compose up -d
```

### Other Platforms

#### Netlify

```bash
# Build Command
npm run build

# Publish Directory
.next

# Environment Variables
# أضف جميع المتغيرات في Settings
```

#### AWS (EC2 / ECS)

1. قم ببناء Docker Image
2. رفعه إلى ECR
3. نشره على ECS أو EC2

#### Traditional VPS

```bash
# على السيرفر
git clone <repo-url>
cd chatbot
npm install
npm run build

# باستخدام PM2
npm install -g pm2
pm2 start npm --name "chatbot" -- start
pm2 save
pm2 startup
```

### Environment-Specific Configs

#### Production `.env.production`

```env
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://chatbot.alkafeel.net
SITE_API_BASE_URL=https://alkafeel.net/v1
# ... other production vars
```

#### Development `.env.local`

```env
NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000
SITE_API_BASE_URL=http://localhost:8000/api/v1
# ... other dev vars
```

---

## 📚 API Documentation

### Chat Endpoint

#### `POST /api/chat/site`

نقطة النهاية الرئيسية للمحادثة مع البوت.

**Request Body**:

```typescript
{
  messages: ChatCompletionMessageParam[]  // مطلوب: سجل المحادثة
  temperature?: number                    // اختياري: 0.0-2.0 (افتراضي: 0.7)
  max_tokens?: number                     // اختياري: الحد الأقصى (افتراضي: 2000)
  use_tools?: boolean                     // اختياري: تفعيل الأدوات (افتراضي: true)
}
```

**مثال**:

```json
{
  "messages": [
    { "role": "user", "content": "أريد مشاريع طبية" }
  ],
  "temperature": 0.7,
  "max_tokens": 2000,
  "use_tools": true
}
```

**Response (Success)**:

```json
{
  "message": "وجدت لك 5 مشاريع في قسم المشاريع الطبية...",
  "iterations": 2
}
```

**Response (Error)**:

```json
{
  "error": "يجب إرسال رسالة واحدة على الأقل"
}
```

**Status Codes**:

- `200`: نجاح
- `400`: خطأ في البيانات المرسلة
- `429`: تجاوز حد الطلبات (Rate Limit)
- `500`: خطأ في السيرفر

**Headers**:

```
Content-Type: application/json
Access-Control-Allow-Origin: https://alkafeel.net
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
```

**Rate Limiting**:

- **Limit**: 20 طلب لكل دقيقة لكل IP
- **Block Duration**: 5 دقائق عند التجاوز
- **Response Headers**:
  ```
  X-RateLimit-Limit: 20
  X-RateLimit-Remaining: 15
  X-RateLimit-Reset: 1234567890
  ```

### CORS Preflight

#### `OPTIONS /api/chat/site`

للتحقق من CORS قبل إرسال الطلب الفعلي.

**Response**:

```
Status: 204 No Content
Access-Control-Allow-Origin: https://alkafeel.net
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Max-Age: 86400
```

---

## 🧪 الاختبار

### Manual Testing

#### 1. اختبار البحث

```
User: ابحث عن مشاريع طبية
Expected: قائمة بالمشاريع الطبية مع روابط
```

#### 2. اختبار التفاصيل

```
User: أخبرني عن المشروع رقم 123
Expected: تفاصيل كاملة عن المشروع
```

#### 3. اختبار خارج النطاق

```
User: كيف أطبخ المعكرونة؟
Expected: رفض لطيف مع توجيه لما يمكن مساعدته
```

#### 4. اختبار Rate Limiting

```
Run: 25 طلب سريع من نفس IP
Expected: الطلب 21 يتم رفضه مع رسالة 429
```

### Automated Testing (Future)

يمكن إضافة اختبارات تلقائية باستخدام:

```typescript
// __tests__/api/chat.test.ts
import { POST } from '@/app/api/chat/site/route'

describe('/api/chat/site', () => {
  it('should return response for valid input', async () => {
    const request = new Request('http://localhost:3000/api/chat/site', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'مرحباً' }]
      })
    })
    
    const response = await POST(request)
    expect(response.status).toBe(200)
  })
})
```

---

## 🤝 المساهمة

نرحب بالمساهمات! لكن يُرجى اتباع الإرشادات:

### خطوات المساهمة

1. **Fork المشروع**
2. **أنشئ Branch جديد**
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **اكتب الكود**
   - اتبع Code Style الموجود
   - أضف تعليقات بالعربية
   - اختبر التغييرات
4. **Commit**
   ```bash
   git commit -m 'feat: إضافة ميزة رائعة'
   ```
5. **Push**
   ```bash
   git push origin feature/amazing-feature
   ```
6. **افتح Pull Request**

### Commit Message Convention

نستخدم [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: ميزة جديدة
fix: إصلاح خطأ
docs: تحديث التوثيق
style: تنسيق الكود
refactor: إعادة هيكلة
test: إضافة اختبارات
chore: مهام صيانة
```

---

## 📄 الترخيص

هذا المشروع مملوك للعتبة العباسية المقدسة. جميع الحقوق محفوظة.

---

## 📞 الدعم والاتصال

### Issues

إذا واجهت مشكلة، افتح Issue على GitHub مع:
- وصف واضح للمشكلة
- خطوات إعادة الإنتاج
- Screenshots (إن أمكن)
- معلومات البيئة (Browser, OS, etc.)

### Contact

- **الموقع**: [alkafeel.net](https://alkafeel.net)
- **البريد الإلكتروني**: support@alkafeel.net (مثال)

---

## 🎉 الخاتمة

شكراً لاستخدامك **مساعد العتبة العباسية المقدسة **!

نأمل أن يكون هذا المشروع مفيداً في توفير معلومات دقيقة وسريعة عن مشاريع العتبة المباركة.

---

**Built with ❤️ for العتبة العباسية المقدسة**
