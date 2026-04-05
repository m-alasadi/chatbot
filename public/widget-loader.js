/**
 * AlKafeel Chat Widget Loader
 * يُحمّل ويُضمّن الودجت في أي موقع
 */

(function() {
  'use strict';

  // منع التحميل المتكرر
  if (window.AlkafeelChatWidget) {
    console.warn('[AlKafeel Widget] Already loaded');
    return;
  }

  // الإعدادات الافتراضية
  const DEFAULT_CONFIG = {
    apiEndpoint: '/api/chat/site',
    title: 'مساعدك في المشاريع',
    subtitle: 'اسأل عن  العتبة العباسية المقدسة',
    position: 'left', // left or right
    buttonColor: '#1e40af',
    buttonText: '💬',
    buttonSize: '60px',
    zIndex: 999999
  };

  class AlkafeelChatWidget {
    constructor(config = {}) {
      this.config = { ...DEFAULT_CONFIG, ...config };
      this.isOpen = false;
      this.messages = [];
      this.isLoading = false;
      
      this.init();
    }

    init() {
      this.injectStyles();
      this.createButton();
      this.createWidgetContainer();
    }

    injectStyles() {
      const style = document.createElement('style');
      style.id = 'alkafeel-widget-styles';
      style.textContent = `
        /* Widget Button */
        .alkafeel-chat-button {
          position: fixed;
          ${this.config.position}: 20px;
          bottom: 20px;
          width: ${this.config.buttonSize};
          height: ${this.config.buttonSize};
          border-radius: 50%;
          background: linear-gradient(135deg, #1e40af 0%, #7c3aed 100%);
          color: white;
          border: none;
          font-size: 28px;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          z-index: ${this.config.zIndex};
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .alkafeel-chat-button:hover {
          transform: scale(1.1);
          box-shadow: 0 6px 20px rgba(30, 64, 175, 0.4);
        }

        .alkafeel-chat-button.open {
          transform: rotate(180deg);
        }

        /* Widget Container */
        .alkafeel-widget-container {
          position: fixed;
          ${this.config.position}: 20px;
          bottom: 100px;
          width: 400px;
          height: 600px;
          max-width: calc(100vw - 40px);
          max-height: calc(100vh - 140px);
          z-index: ${this.config.zIndex};
          opacity: 0;
          visibility: hidden;
          transform: translateY(20px) scale(0.95);
          transition: all 0.3s ease;
        }

        .alkafeel-widget-container.open {
          opacity: 1;
          visibility: visible;
          transform: translateY(0) scale(1);
        }

        /* Mobile Responsive */
        @media (max-width: 768px) {
          .alkafeel-widget-container {
            ${this.config.position}: 10px;
            right: 10px;
            bottom: 80px;
            width: calc(100vw - 20px);
            height: calc(100vh - 100px);
            max-width: 100%;
            max-height: calc(100vh - 100px);
          }

          .alkafeel-chat-button {
            ${this.config.position}: 15px;
            bottom: 15px;
          }
        }
      `;
      document.head.appendChild(style);
    }

    createButton() {
      const button = document.createElement('button');
      button.className = 'alkafeel-chat-button';
      button.innerHTML = this.config.buttonText;
      button.setAttribute('aria-label', 'فتح مساعد المشاريع');
      button.onclick = () => this.toggle();
      
      this.button = button;
      document.body.appendChild(button);
    }

    createWidgetContainer() {
      const container = document.createElement('div');
      container.className = 'alkafeel-widget-container';
      container.id = 'alkafeel-widget-root';
      
      this.container = container;
      document.body.appendChild(container);
      
      // تحميل React component
      this.loadChatWidget();
    }

    loadChatWidget() {
      // سيتم استبدال هذا بتحميل React component الفعلي
      // في الخطوة التالية سنضيف React bundle
      this.container.innerHTML = `
        <div id="alkafeel-chat-app"></div>
      `;
      
      // تحميل React وال-component
      this.loadReactApp();
    }

    async loadReactApp() {
      const app = document.getElementById('alkafeel-chat-app');
      if (!app) return;
      
      // عرض loading
      app.innerHTML = `
        <div style="width: 100%; height: 100%; background: #111827; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: white; font-family: 'Readex Pro', sans-serif;">
          <div style="font-size: 40px; margin-bottom: 15px;">💬</div>
          <div style="font-size: 16px; margin-bottom: 10px;">جاري التحميل...</div>
          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #60a5fa; animation: pulse 1.4s infinite;"></div>
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #60a5fa; animation: pulse 1.4s infinite 0.2s;"></div>
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #60a5fa; animation: pulse 1.4s infinite 0.4s;"></div>
          </div>
        </div>
        <style>
          @keyframes pulse {
            0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
            40% { opacity: 1; transform: scale(1); }
          }
        </style>
      `;
      
      // محاولة تحميل React bundle
      try {
        // في حالة development، نستخدم iframe للتحميل من localhost
        // في production، سنستخدم bundled version
        await this.loadWithIframe();
      } catch (error) {
        console.error('[AlKafeel Widget] Failed to load:', error);
        app.innerHTML = `
          <div style="width: 100%; height: 100%; background: #111827; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #ef4444; padding: 20px; text-align: center; font-family: 'Readex Pro', sans-serif;">
            ⚠️ فشل في تحميل الودجت
          </div>
        `;
      }
    }

    async loadWithIframe() {
      // بدلاً من iframe، سنحمل الـ component مباشرة
      // في الإنتاج، يجب استخدام bundled React component
      const app = document.getElementById('alkafeel-chat-app');
      if (!app) return;

      // الحصول على الـ base URL من السكريبت الحالي
      const scriptTag = document.currentScript || document.querySelector('script[src*="widget"]');
      const baseUrl = scriptTag ? new URL(scriptTag.src).origin : window.location.origin;

      // تحميل React وReactDOM من CDN
      await this.loadScript('https://unpkg.com/react@18/umd/react.production.min.js');
      await this.loadScript('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js');
      
      // الآن نحمل component الخاص بنا
      // في الوقت الحالي، سنستخدم inline chat implementation
      this.renderInlineChat(app);
    }

    loadScript(src) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    renderInlineChat(container) {
      // نحقن ChatWidget HTML مباشرة
      container.innerHTML = `
        <div class="chat-widget-container" style="width: 100%; height: 100%; background: #111827; border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 8px 40px rgba(0,0,0,0.5); border: 1px solid #1f2937; direction: rtl; font-family: 'Readex Pro', sans-serif;">
          <div class="chat-widget-header" style="background: linear-gradient(135deg, #1e40af 0%, #7c3aed 100%); color: white; padding: 15px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
            <div>
              <h2 style="margin: 0; font-size: 18px; font-weight: 600;">${this.config.title}</h2>
              <p style="margin: 4px 0 0 0; font-size: 12px; opacity: 0.9;">${this.config.subtitle}</p>
            </div>
          </div>
          <div class="chat-widget-messages" id="widget-messages" style="flex: 1; overflow-y: auto; padding: 15px; background: #0f172a;">
            <div style="text-align: center; padding: 40px 20px; color: #94a3b8;">
              <h3 style="color: white; margin: 0 0 10px 0; font-size: 20px;">👋 مرحباً بك!</h3>
              <p style="margin: 0 0 25px 0; font-size: 14px;">أنا مساعدك الذكي للاستعلام عن مشاريع العتبة العباسية المقدسة</p>
            </div>
          </div>
          <div class="chat-widget-input-area" style="padding: 15px; background: #1e293b; border-top: 1px solid #334155;">
            <div style="display: flex; gap: 8px; align-items: flex-end;">
              <textarea 
                id="widget-input" 
                placeholder="اكتب سؤالك هنا..." 
                rows="1"
                style="flex: 1; background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 10px 12px; color: white; font-size: 14px; font-family: inherit; resize: none; max-height: 120px; min-height: 44px;"
              ></textarea>
              <button 
                id="widget-send-btn"
                style="background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); border: none; padding: 10px 20px; border-radius: 8px; color: white; font-size: 14px; font-weight: 500; cursor: pointer; min-width: 70px;"
              >إرسال</button>
            </div>
          </div>
        </div>
      `;

      // إضافة event listeners
      this.setupChatHandlers();
    }

    setupChatHandlers() {
      const input = document.getElementById('widget-input');
      const sendBtn = document.getElementById('widget-send-btn');
      const messages = document.getElementById('widget-messages');

      if (!input || !sendBtn || !messages) return;

      const sendMessage = async () => {
        const text = input.value.trim();
        if (!text) return;

        // إضافة رسالة المستخدم
        this.addMessage('user', text);
        input.value = '';

        // إضافة loading
        const loadingId = 'loading-' + Date.now();
        this.addMessage('assistant', '<div class="loading">جاري الرد...</div>', loadingId);

        try {
          // إرسال الطلب
          const response = await fetch(this.config.apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [{ role: 'user', content: text }],
              chatSettings: { model: 'gpt-4o', temperature: 0.5 }
            })
          });

          const data = await response.json();
          const reply = data.message || data.reply || 'عذراً، حدث خطأ.';

          // حذف loading وإضافة الرد
          document.getElementById(loadingId)?.remove();
          this.addMessage('assistant', reply);
        } catch (error) {
          document.getElementById(loadingId)?.remove();
          this.addMessage('assistant', '⚠️ حدث خطأ في الاتصال');
        }
      };

      sendBtn.onclick = sendMessage;
      input.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      };
    }

    addMessage(role, content, id) {
      const messages = document.getElementById('widget-messages');
      if (!messages) return;

      const msgDiv = document.createElement('div');
      if (id) msgDiv.id = id;
      msgDiv.style.cssText = `
        margin-bottom: 15px;
        display: flex;
        gap: 10px;
        animation: fadeInUp 0.3s ease;
        ${role === 'user' ? 'flex-direction: row-reverse;' : ''}
      `;

      const avatar = document.createElement('div');
      avatar.style.cssText = `
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        flex-shrink: 0;
        background: ${role === 'user' ? 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)' : 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)'};
      `;
      avatar.textContent = role === 'user' ? '👤' : '🤖';

      const msgContent = document.createElement('div');
      msgContent.style.cssText = `
        max-width: 80%;
        padding: 10px 14px;
        border-radius: 12px;
        line-height: 1.5;
        font-size: 14px;
        ${role === 'user' 
          ? 'background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: white; border-bottom-left-radius: 4px;' 
          : 'background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-bottom-right-radius: 4px;'}
      `;
      msgContent.innerHTML = content;

      msgDiv.appendChild(avatar);
      msgDiv.appendChild(msgContent);
      messages.appendChild(msgDiv);

      // scroll to bottom
      messages.scrollTop = messages.scrollHeight;
    }

    toggle() {
      this.isOpen = !this.isOpen;
      
      if (this.isOpen) {
        this.open();
      } else {
        this.close();
      }
    }

    open() {
      this.isOpen = true;
      this.container.classList.add('open');
      this.button.classList.add('open');
      this.button.innerHTML = '✕';
    }

    close() {
      this.isOpen = false;
      this.container.classList.remove('open');
      this.button.classList.remove('open');
      this.button.innerHTML = this.config.buttonText;
    }

    destroy() {
      if (this.button) this.button.remove();
      if (this.container) this.container.remove();
      const styles = document.getElementById('alkafeel-widget-styles');
      if (styles) styles.remove();
    }
  }

  // تصدير للنطاق العام
  window.AlkafeelChatWidget = AlkafeelChatWidget;

  // Auto-init إذا كان هناك config في window
  if (window.ALKAFEEL_WIDGET_CONFIG) {
    new AlkafeelChatWidget(window.ALKAFEEL_WIDGET_CONFIG);
  }

  console.log('[AlKafeel Widget] Loader initialized');
})();
