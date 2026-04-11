"use client"

import { useEffect, useRef, useState } from "react"

interface Message {
  role: "user" | "assistant"
  content: string
}

interface ChatWidgetProps {
  apiEndpoint?: string
  title?: string
  subtitle?: string
}

export default function ChatWidget({
  apiEndpoint = "/api/chat/site",
  title = "مساعدك في المشاريع",
  subtitle = "اسأل عن  العتبة العباسية المقدسة"
}: ChatWidgetProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [showWelcome, setShowWelcome] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }, 50)
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const sendMessage = async (text?: string) => {
    const messageText = (text || input).trim()
    if (!messageText || isLoading) return

    setShowWelcome(false)
    setInput("")

    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: messageText }
    ]
    setMessages(newMessages)
    setIsLoading(true)

    try {
      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          temperature: 0.7,
          max_tokens: 2000,
          use_tools: true
        })
      })

      if (!response.ok) throw new Error("خطأ " + response.status)

      const contentType = (response.headers.get("content-type") || "").toLowerCase()
      let botReply = ""

      if (contentType.includes("application/json")) {
        // Function Calling mode — JSON response
        const data = await response.json()
        botReply = data.message || "لم أتمكن من فهم الرد."
      } else if (response.body) {
        // Standard fallback — streaming text
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          botReply += decoder.decode(value, { stream: true })
        }
      } else {
        botReply = await response.text() || "لم يتم استلام رد."
      }

      setMessages([
        ...newMessages,
        { role: "assistant", content: botReply }
      ])
    } catch (err: any) {
      let errorMsg = "⚠️ حدث خطأ في الاتصال. حاول مرة أخرى."
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        errorMsg = "📵 لا يوجد اتصال بالإنترنت. يرجى التحقق من شبكتك والمحاولة مرة أخرى."
      } else if (err?.name === "TypeError" || err?.message?.toLowerCase().includes("fetch")) {
        errorMsg = "⚠️ تعذّر الوصول إلى الخادم. يرجى التحقق من اتصالك والمحاولة مرة أخرى."
      }
      setMessages([
        ...newMessages,
        { role: "assistant", content: errorMsg }
      ])
    } finally {
      setIsLoading(false)
      textareaRef.current?.focus()
    }
  }

  const clearChat = () => {
    setMessages([])
    setShowWelcome(true)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const renderMarkdown = (text: string) => {
    if (!text) return ""
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>'
      )
      .replace(/^(\d+)\.\s+(.+)$/gm, "<li>$2</li>")
      .replace(/^[-•]\s+(.+)$/gm, "<li>$1</li>")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      // —— Suggestion divider: سطر يحتوي على --- فقط ——
      .replace(/^---$/gm,
        '<hr class="chat-suggestion-divider"><span class="chat-suggestion-label">📎 قد يهمك أيضاً</span>')
      .replace(/\n/g, "<br>")

    html = html.replace(/((<li>.+?<\/li>)(<br>)?)+/g, match => {
      const items = match.replace(/<br>/g, "")
      return "<ol>" + items + "</ol>"
    })

    return html
  }

  const quickButtons = [
    { emoji: "📚", label: "المشاريع الثقافية", query: "أعرض لي المشاريع الثقافية" },
    { emoji: "🎓", label: "المشاريع التعليمية", query: "أعرض لي المشاريع التعليمية" },
    { emoji: "🕌", label: "مشاريع الصحن ومقترباته", query: "أعرض لي مشاريع الصحن ومقترباته" },
    { emoji: "🏥", label: "المشاريع الطبية", query: "أعرض لي المشاريع الطبية" },
    { emoji: "📈", label: "المشاريع التنموية", query: "أعرض لي المشاريع التنموية" },
    { emoji: "🔧", label: "خدمات عامة", query: "أعرض لي خدمات عامة" },
    { emoji: "🏛️", label: "تشكيلات إدارية", query: "أعرض لي تشكيلات إدارية" }
  ]

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
      `}</style>

      <div className="chat-widget-container">
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
            >
              مسح المحادثة
            </button>
          )}
        </div>

        {/* Messages Area */}
        <div className="chat-widget-messages">
          {showWelcome && messages.length === 0 && (
            <div className="chat-widget-welcome">
              <h3>👋 مرحباً بك!</h3>
              <p>أنا مساعدك الذكي للاستعلام عن مشاريع العتبة العباسية المقدسة</p>
              <p style={{ fontSize: "13px", marginBottom: "10px" }}>جرّب الأسئلة السريعة:</p>
              <div className="chat-widget-quick-buttons">
                {quickButtons.map((btn, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(btn.query)}
                    className="chat-widget-quick-btn"
                  >
                    <span>{btn.emoji}</span>
                    <span>{btn.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
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
          ))}

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
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="اكتب سؤالك هنا..."
              rows={1}
              disabled={isLoading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isLoading}
              className="chat-widget-send-btn"
            >
              {isLoading ? "..." : "إرسال"}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
