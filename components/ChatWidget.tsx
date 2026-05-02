"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  CHAT_DOMAINS,
  type ChatDomain,
  getChatDomainLabel,
  normalizeChatDomain
} from "../lib/shared/chat-domains"

interface Message {
  role: "user" | "assistant" | "system_local"
  content: string
}

const DOMAIN_STORAGE_KEY = "alkafeel_widget_domain"

interface ChatWidgetProps {
  apiEndpoint?: string
  title?: string
  subtitle?: string
}

// Maximum input length matches server-side validation (see app/api/chat/site/route.ts).
const MAX_INPUT_LENGTH = 5000
// Hard cap on a single request to surface server hangs to the user.
const REQUEST_TIMEOUT_MS = 30000

// Sanitize URLs allowed inside chat-rendered links: only http/https/mailto + relative paths.
function sanitizeLinkHref(raw: string): string {
  const trimmed = (raw || "").trim()
  if (!trimmed) return "#"
  // Block dangerous schemes (case-insensitive, ignores leading control chars).
  const lowered = trimmed.toLowerCase().replace(/[\s\u0000-\u001f]/g, "")
  if (
    lowered.startsWith("javascript:") ||
    lowered.startsWith("data:") ||
    lowered.startsWith("vbscript:") ||
    lowered.startsWith("file:")
  ) {
    return "#"
  }
  // Allow http(s), mailto, anchors, and relative paths.
  if (/^(https?:|mailto:|tel:|#|\/|\.{0,2}\/)/i.test(trimmed)) {
    return trimmed.replace(/"/g, "&quot;")
  }
  return "#"
}

export default function ChatWidget({
  apiEndpoint = "/api/chat/site",
  title = "مساعدك في المشاريع",
  subtitle = "اسأل عن  العتبة العباسية المقدسة"
}: ChatWidgetProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [preferredDomain, setPreferredDomain] = useState<ChatDomain | null>(null)
  const [showDomainCard, setShowDomainCard] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Synchronous guard against double-submit (state updates are async, refs are not).
  const inFlightRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Cancel any in-flight request when the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), [])

  // عند فتح الودجت أول مرة: استرجع المجال المحفوظ إن وُجد.
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const stored = window.localStorage.getItem(DOMAIN_STORAGE_KEY)
      if (stored) {
        const normalized = normalizeChatDomain(stored)
        setPreferredDomain(normalized)
        setShowDomainCard(false)
      }
    } catch {
      // localStorage قد يكون معطّلاً (وضع التصفح الخاص) — نتجاهل بصمت.
    }
  }, [])

  const sendMessage = useCallback(async (text?: string) => {
    const messageText = (text || input).trim().slice(0, MAX_INPUT_LENGTH)
    if (!messageText) return
    if (inFlightRef.current) return
    inFlightRef.current = true

    setInput("")

    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: messageText }
    ]
    setMessages(newMessages)
    setIsLoading(true)

    const controller = new AbortController()
    abortRef.current = controller
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      // نُرسل فقط رسائل المحادثة الحقيقية (user/assistant) إلى الخادم.
      // الرسائل المحلية (system_local) لا تُرسل إلى الذكاء الاصطناعي.
      const wireMessages = newMessages
        .filter(m => m.role === "user" || m.role === "assistant")
        .map(m => ({ role: m.role, content: m.content }))

      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: wireMessages,
          temperature: 0.2,
          max_tokens: 1200,
          use_tools: true,
          preferredDomain: preferredDomain || "general"
        }),
        signal: controller.signal
      })

      if (!response.ok) throw new Error("خطأ " + response.status)

      const contentType = (response.headers.get("content-type") || "").toLowerCase()
      let botReply = ""

      if (contentType.includes("application/json")) {
        const data = await response.json()
        botReply = data.message || "لم أتمكن من فهم الرد."
      } else if (response.body) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          botReply += decoder.decode(value, { stream: true })
        }
      } else {
        botReply = (await response.text()) || "لم يتم استلام رد."
      }

      setMessages([
        ...newMessages,
        { role: "assistant", content: botReply }
      ])
    } catch (err: any) {
      let errorMsg = "⚠️ حدث خطأ في الاتصال. حاول مرة أخرى."
      if (err?.name === "AbortError") {
        errorMsg = "⏱️ استغرق الرد وقتاً أطول من المعتاد. يرجى المحاولة مرة أخرى."
      } else if (typeof navigator !== "undefined" && !navigator.onLine) {
        errorMsg = "📵 لا يوجد اتصال بالإنترنت. يرجى التحقق من شبكتك والمحاولة مرة أخرى."
      } else if (err?.name === "TypeError" || err?.message?.toLowerCase().includes("fetch")) {
        errorMsg = "⚠️ تعذّر الوصول إلى الخادم. يرجى التحقق من اتصالك والمحاولة مرة أخرى."
      }
      setMessages([
        ...newMessages,
        { role: "assistant", content: errorMsg }
      ])
    } finally {
      clearTimeout(timeoutId)
      abortRef.current = null
      inFlightRef.current = false
      setIsLoading(false)
      textareaRef.current?.focus()
    }
  }, [apiEndpoint, input, messages, preferredDomain])

  const selectDomain = useCallback((domain: ChatDomain) => {
    setPreferredDomain(domain)
    setShowDomainCard(false)
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(DOMAIN_STORAGE_KEY, domain)
      }
    } catch {
      // تجاهل أخطاء localStorage بصمت.
    }
    // لا نعرض أي رسالة — الاختيار صامت، والتأكيد يظهر فقط في شريط المجال أعلى المحادثة.
    textareaRef.current?.focus()
  }, [])

  const openDomainCard = useCallback(() => {
    setShowDomainCard(true)
  }, [])

  const clearChat = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    // لا نمسح المجال المختار عند مسح المحادثة — يبقى تفضيل المستخدم.
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }, [sendMessage])

  const renderMarkdown = useCallback((text: string) => {
    if (!text) return ""
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_m, label: string, href: string) => {
          const safeHref = sanitizeLinkHref(href)
          return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`
        }
      )
      .replace(/^(\d+)\.\s+(.+)$/gm, "<li>$2</li>")
      .replace(/^[-•]\s+(.+)$/gm, "<li>$1</li>")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^---$/gm,
        '<hr class="chat-suggestion-divider"><span class="chat-suggestion-label">📎 قد يهمك أيضاً</span>')
      .replace(/\n/g, "<br>")

    html = html.replace(/((<li>.+?<\/li>)(<br>)?)+/g, match => {
      const items = match.replace(/<br>/g, "")
      return "<ol>" + items + "</ol>"
    })

    return html
  }, [])

  return (
    <>
      <style jsx global>{`
        .chat-widget-container * {
          box-sizing: border-box;
        }
        
        .chat-widget-container {
          font-family: 'Readex Pro', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          width: 100%;
          height: 100%;
          background: #111827;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 8px 40px rgba(0,0,0,0.5);
          border: 1px solid #1f2937;
          direction: rtl;
        }
        
        .chat-widget-header {
          background: linear-gradient(135deg, #1e40af 0%, #7c3aed 100%);
          color: white;
          padding: 15px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .chat-widget-header-text h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
        }
        
        .chat-widget-header-text p {
          margin: 4px 0 0 0;
          font-size: 12px;
          opacity: 0.9;
        }
        
        .chat-widget-clear-btn {
          background: rgba(255, 255, 255, 0.15);
          border: none;
          padding: 6px 12px;
          border-radius: 6px;
          color: white;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .chat-widget-clear-btn:hover {
          background: rgba(255, 255, 255, 0.25);
        }
        
        .chat-widget-messages {
          flex: 1;
          overflow-y: auto;
          padding: 15px;
          background: #0f172a;
        }
        
        .chat-widget-welcome {
          text-align: center;
          padding: 40px 20px;
          color: #94a3b8;
        }
        
        .chat-widget-welcome h3 {
          color: white;
          margin: 0 0 10px 0;
          font-size: 20px;
        }
        
        .chat-widget-welcome p {
          margin: 0 0 25px 0;
          font-size: 14px;
        }
        
        .chat-widget-quick-buttons {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: center;
          margin-top: 20px;
        }
        
        .chat-widget-quick-btn {
          background: #1e293b;
          border: 1px solid #334155;
          padding: 8px 12px;
          border-radius: 6px;
          color: #e2e8f0;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .chat-widget-quick-btn:hover {
          background: #334155;
          border-color: #475569;
        }
        
        .chat-widget-message {
          margin-bottom: 15px;
          display: flex;
          gap: 10px;
          animation: fadeInUp 0.3s ease;
        }
        
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .chat-widget-message.user {
          flex-direction: row-reverse;
        }
        
        .chat-widget-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          flex-shrink: 0;
        }
        
        .chat-widget-message.user .chat-widget-avatar {
          background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
        }
        
        .chat-widget-message.assistant .chat-widget-avatar {
          background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
        }
        
        .chat-widget-message-content {
          max-width: 80%;
          padding: 10px 14px;
          border-radius: 12px;
          line-height: 1.5;
          font-size: 14px;
        }
        
        .chat-widget-message.user .chat-widget-message-content {
          background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
          color: white;
          border-bottom-left-radius: 4px;
        }
        
        .chat-widget-message.assistant .chat-widget-message-content {
          background: #1e293b;
          color: #e2e8f0;
          border: 1px solid #334155;
          border-bottom-right-radius: 4px;
        }
        
        /* ── Suggestion divider ── */
        .chat-suggestion-divider {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 14px 0 4px;
          border: none;
        }
        .chat-suggestion-divider::before,
        .chat-suggestion-divider::after {
          content: "";
          flex: 1;
          height: 1px;
          background: linear-gradient(to left, transparent, #334155);
        }
        .chat-suggestion-divider::after {
          background: linear-gradient(to right, transparent, #334155);
        }
        .chat-suggestion-label {
          white-space: nowrap;
          font-size: 11px;
          color: #64748b;
          letter-spacing: 0.3px;
          background: #1e293b;
          padding: 2px 9px;
          border: 1px solid #334155;
          border-radius: 10px;
        }

        .chat-widget-message-content a {
          color: #60a5fa;
          text-decoration: underline;
        }
        
        .chat-widget-message-content strong {
          font-weight: 600;
        }
        
        .chat-widget-message-content ol {
          margin: 8px 0;
          padding-right: 20px;
        }
        
        .chat-widget-message-content li {
          margin: 4px 0;
        }
        
        .chat-widget-loading {
          display: flex;
          gap: 4px;
          padding: 10px;
        }
        
        .chat-widget-loading span {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #60a5fa;
          animation: pulse 1.4s infinite;
        }
        
        .chat-widget-loading span:nth-child(2) {
          animation-delay: 0.2s;
        }
        
        .chat-widget-loading span:nth-child(3) {
          animation-delay: 0.4s;
        }
        
        @keyframes pulse {
          0%, 80%, 100% {
            opacity: 0.3;
            transform: scale(0.8);
          }
          40% {
            opacity: 1;
            transform: scale(1);
          }
        }
        
        .chat-widget-input-area {
          padding: 15px;
          background: #1e293b;
          border-top: 1px solid #334155;
        }
        
        .chat-widget-input-wrapper {
          display: flex;
          gap: 8px;
          align-items: flex-end;
        }
        
        .chat-widget-textarea {
          flex: 1;
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 8px;
          padding: 10px 12px;
          color: white;
          font-size: 14px;
          font-family: inherit;
          resize: none;
          max-height: 120px;
          min-height: 44px;
        }
        
        .chat-widget-textarea:focus {
          outline: none;
          border-color: #3b82f6;
        }
        
        .chat-widget-textarea::placeholder {
          color: #64748b;
        }
        
        .chat-widget-send-btn {
          background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
          border: none;
          padding: 10px 20px;
          border-radius: 8px;
          color: white;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          min-width: 70px;
        }
        
        .chat-widget-send-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
        }
        
        .chat-widget-send-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* ── Domain selection card ── */
        .chat-widget-domain-card {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 12px;
          padding: 18px 16px;
          margin: 0 auto 16px;
          max-width: 100%;
          color: #e2e8f0;
          text-align: right;
        }
        .chat-widget-domain-card h3 {
          margin: 0 0 6px 0;
          font-size: 16px;
          color: #ffffff;
          font-weight: 600;
        }
        .chat-widget-domain-card p {
          margin: 0 0 14px 0;
          font-size: 13px;
          color: #94a3b8;
          line-height: 1.6;
        }
        .chat-widget-domain-options {
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          gap: 6px;
          justify-content: flex-start;
        }
        .chat-widget-domain-option {
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 999px;
          padding: 4px 10px;
          color: #e2e8f0;
          font-size: 10px;
          cursor: pointer;
          transition: all 0.15s;
          text-align: center;
          font-family: inherit;
          line-height: 1.3;
          flex: 0 0 auto;
          width: auto;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
        }
        .chat-widget-domain-option:hover,
        .chat-widget-domain-option:focus-visible {
          background: #334155;
          border-color: #60a5fa;
          outline: none;
        }
        .chat-widget-domain-option-label {
          display: inline;
          font-weight: 600;
          color: #ffffff;
          margin-bottom: 0;
        }
        .chat-widget-domain-option-desc {
          display: none;
        }

        /* ── Change-domain bar ── */
        .chat-widget-domain-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          margin-bottom: 12px;
          background: rgba(30, 64, 175, 0.12);
          border: 1px solid rgba(96, 165, 250, 0.25);
          border-radius: 8px;
          font-size: 12px;
          color: #cbd5e1;
        }
        .chat-widget-change-domain-btn {
          background: transparent;
          border: 1px solid #475569;
          color: #e2e8f0;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }
        .chat-widget-change-domain-btn:hover {
          background: #334155;
          border-color: #60a5fa;
        }

        /* ── Local system notice (not sent to AI) ── */
        .chat-widget-system-local {
          margin: 10px 0;
          padding: 8px 12px;
          background: rgba(16, 185, 129, 0.10);
          border: 1px dashed rgba(16, 185, 129, 0.35);
          border-radius: 8px;
          color: #cbd5e1;
          font-size: 13px;
          line-height: 1.6;
          text-align: center;
        }
        .chat-widget-system-local strong {
          color: #ffffff;
        }
      `}</style>

      <div
        className="chat-widget-container"
        role="region"
        aria-label="مساعد العتبة العباسية"
      >
        {/* Header */}
        <div className="chat-widget-header">
          <div className="chat-widget-header-text">
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="chat-widget-clear-btn"
              aria-label="مسح المحادثة"
            >
              مسح المحادثة
            </button>
          )}
        </div>

        {/* Messages Area */}
        <div
          className="chat-widget-messages"
          role="log"
          aria-live="polite"
          aria-label="رسائل المحادثة"
        >
          {showDomainCard && (
            <div className="chat-widget-domain-card" role="group" aria-label="اختيار المجال">
              <h3>مرحبًا بك في مساعد العتبة العباسية المقدسة</h3>
              <p>اختر المجال الأقرب لسؤالك حتى أبحث لك في المصدر الأنسب:</p>
              <div className="chat-widget-domain-options">
                {CHAT_DOMAINS.map(domain => (
                  <button
                    key={domain.id}
                    type="button"
                    onClick={() => selectDomain(domain.id)}
                    className="chat-widget-domain-option"
                    aria-label={domain.label}
                    title={domain.description}
                  >
                    <span className="chat-widget-domain-option-label">{domain.label}</span>
                    <span className="chat-widget-domain-option-desc">{domain.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!showDomainCard && preferredDomain && (
            <div className="chat-widget-domain-bar">
              <span>المجال الحالي: <strong>{getChatDomainLabel(preferredDomain)}</strong></span>
              <button
                type="button"
                onClick={openDomainCard}
                className="chat-widget-change-domain-btn"
                aria-label="تغيير المجال"
              >
                تغيير المجال
              </button>
            </div>
          )}

          {messages.map((msg, i) => {
            if (msg.role === "system_local") {
              return (
                <div
                  key={i}
                  className="chat-widget-system-local"
                  role="status"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                />
              )
            }
            return (
              <div
                key={i}
                className={`chat-widget-message ${msg.role}`}
              >
                <div className="chat-widget-avatar">
                  {msg.role === "user" ? "👤" : (
                    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="10" cy="2" r="1.5" fill="white"/>
                      <line x1="10" y1="3.5" x2="10" y2="6" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                      <rect x="3" y="6" width="14" height="12" rx="4" stroke="white" strokeWidth="1.5"/>
                      <circle cx="7.5" cy="11" r="1.5" fill="white"/>
                      <circle cx="12.5" cy="11" r="1.5" fill="white"/>
                      <path d="M7 15 Q10 17 13 15" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                    </svg>
                  )}
                </div>
                <div
                  className="chat-widget-message-content"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(msg.content)
                  }}
                />
              </div>
            )
          })}

          {isLoading && (
            <div className="chat-widget-message assistant">
              <div className="chat-widget-avatar">
                <svg viewBox="0 0 20 20" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="10" cy="2" r="1.5" fill="white"/>
                  <line x1="10" y1="3.5" x2="10" y2="6" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                  <rect x="3" y="6" width="14" height="12" rx="4" stroke="white" strokeWidth="1.5"/>
                  <circle cx="7.5" cy="11" r="1.5" fill="white"/>
                  <circle cx="12.5" cy="11" r="1.5" fill="white"/>
                  <path d="M7 15 Q10 17 13 15" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                </svg>
              </div>
              <div className="chat-widget-message-content">
                <div className="chat-widget-loading">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="chat-widget-input-area">
          <div className="chat-widget-input-wrapper">
            <textarea
              ref={textareaRef}
              className="chat-widget-textarea"
              value={input}
              onChange={e => setInput(e.target.value.slice(0, MAX_INPUT_LENGTH))}
              onKeyDown={handleKeyDown}
              placeholder="اكتب سؤالك هنا..."
              rows={1}
              disabled={isLoading}
              maxLength={MAX_INPUT_LENGTH}
              aria-label="صندوق إدخال الرسالة"
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isLoading}
              className="chat-widget-send-btn"
              aria-label="إرسال الرسالة"
              aria-disabled={!input.trim() || isLoading}
            >
              {isLoading ? "..." : "إرسال"}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
