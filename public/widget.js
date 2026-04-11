/**
 * AlKafeel Chat Widget - Standalone Bundle
 * Version: 2.0.0
 *
 * Usage (two lines):
 *   <script src="https://YOUR-DOMAIN/widget.js" defer></script>
 *   <script>AlkafeelWidget.init({ apiEndpoint: '...' });</script>
 *
 * CSP note – if the host site blocks external scripts, either:
 *   1. Add  script-src 'self' https://YOUR-DOMAIN  to their CSP header, or
 *   2. Self-host: download this file and serve it from the same origin.
 */

(function(window, document) {
  'use strict';

  // ── Guard: prevent double-load ──
  if (window.AlkafeelWidget && window.AlkafeelWidget._loaded) {
    console.warn('[AlKafeel Widget] Already loaded — skipping.');
    return;
  }

  // ==========================================================================
  //  §1  BUTTON-ONLY CSS  –  injected immediately, ~0.5 KB
  //      Everything else is deferred until the user opens the panel.
  // ==========================================================================
  var BTN_STYLES = [
    '.alkw-chat-button{',
      'all:initial;',                           // ← reset ALL inherited styles
      'position:fixed;bottom:20px;',
      'width:60px;height:60px;border-radius:50%;',
      'background:#04504d;',
      'color:#fff;border:1px solid #397f66;font-size:28px;cursor:pointer;',
      'box-shadow:0 4px 12px rgba(0,0,0,.3),0 0 8px rgba(212,168,67,.3);z-index:999998;',
      'transition:all .3s cubic-bezier(.4,0,.2,1);',
      'display:flex;align-items:center;justify-content:center;',
      'user-select:none;-webkit-tap-highlight-color:transparent;',
      'font-family:"Readex Pro",-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif;line-height:1;',
    '}',
    '.alkw-chat-button.alkw-left{left:20px}',
    '.alkw-chat-button.alkw-right{right:20px}',
    '.alkw-chat-button:hover{transform:scale(1.1);box-shadow:0 6px 20px rgba(4,80,77,.5)}',
    '.alkw-chat-button:active{transform:scale(.95)}',
    '.alkw-chat-button.alkw-open{transform:rotate(180deg)}',
    '.alkw-chat-button.alkw-open:hover{transform:rotate(180deg) scale(1.1)}',
    '@media(max-width:768px){',
      '.alkw-chat-button{bottom:15px}',
      '.alkw-chat-button.alkw-left{left:15px}',
      '.alkw-chat-button.alkw-right{right:15px}',
    '}',
  ].join('\n');

  // ==========================================================================
  //  §2  PANEL CSS  –  injected ONLY on first open  (lazy)
  // ==========================================================================
  var PANEL_STYLES = [
    /* ── Hard reset ── */
    '.alkw-widget-container,.alkw-widget-container *,.alkw-widget-container *::before,.alkw-widget-container *::after{',
      'all:initial;box-sizing:border-box;font-family:inherit;',
    '}',

    /* ── Container ── */
    '.alkw-widget-container{',
      'position:fixed;bottom:100px;width:460px;height:600px;',
      'max-width:calc(100vw - 40px);max-height:calc(100vh - 140px);',
      'z-index:999999;opacity:0;visibility:hidden;',
      'transform:translateY(20px) scale(.95);',
      'transition:opacity .3s ease,visibility .3s ease,transform .3s ease;',
      'font-family:"Readex Pro",-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif;',
      'direction:rtl;display:block;',
    '}',
    '.alkw-widget-container.alkw-left{left:20px}',
    '.alkw-widget-container.alkw-right{right:20px}',
    '.alkw-widget-container.alkw-open{opacity:1;visibility:visible;transform:translateY(0) scale(1)}',

    /* ── Inner wrapper ── */
    '.alkw-widget-inner{',
      'width:100%;height:100%;background:#111827;border-radius:8px;',
      'display:flex;flex-direction:column;overflow:hidden;',
      'box-shadow:0 8px 40px rgba(0,0,0,.5);border:1px solid #1f2937;',
    '}',

    /* ── Header (green) ── */
    '.alkw-header{',
      'background:#04504d;color:#fff;padding:16px 20px;',
      'display:flex;align-items:center;gap:12px;flex-shrink:0;',
    '}',
    '.alkw-header-avatar{width:42px;height:42px;border-radius:50%;overflow:hidden;flex-shrink:0;display:block}',
    '.alkw-header-avatar img{width:100%;height:100%;object-fit:cover;display:block}',
    '.alkw-header-info{display:block;flex:1}',
    '.alkw-header-info h2{margin:0;font-size:15px;font-weight:600;line-height:1.2;color:#fff;display:block}',
    '.alkw-header-info p{margin:2px 0 0;font-size:12px;line-height:1.2;color:#a7f3d0;display:block}',
    '.alkw-status-dot{',
      'width:8px;height:8px;background:#34d399;border-radius:50%;',
      'display:inline-block;margin-left:5px;animation:alkw-statusPulse 2s infinite;',
    '}',
    '@keyframes alkw-statusPulse{0%,100%{opacity:1}50%{opacity:.4}}',
    '.alkw-close-btn{',
      'all:initial;background:rgba(255,255,255,.15);border:none;padding:6px 12px;',
      'border-radius:8px;color:#fff;font-size:12px;cursor:pointer;',
      'transition:background .2s;font-family:inherit;',
    '}',
    '.alkw-close-btn:hover{background:rgba(255,255,255,.25)}',

    /* ── Messages area ── */
    '.alkw-messages{',
      'flex:1;overflow-y:auto;padding:16px;background:#111827;',
      'display:flex;flex-direction:column;gap:12px;scroll-behavior:smooth;text-align:center;',
    '}',
    '.alkw-messages::-webkit-scrollbar{width:4px}',
    '.alkw-messages::-webkit-scrollbar-track{background:transparent}',
    '.alkw-messages::-webkit-scrollbar-thumb{background:#374151;border-radius:4px}',

    /* ── Welcome ── */
    '.alkw-welcome{text-align:center;padding:30px 20px;color:#6b7280;display:block}',
    '.alkw-welcome-icon{margin-bottom:12px;display:block;text-align:center}',
    '.alkw-welcome-icon img{width:70px;height:70px;border-radius:50%;object-fit:cover;display:inline-block}',
    '.alkw-welcome h3{color:#9ca3af;margin:0 0 8px;font-size:16px;font-weight:600;display:block;text-align:center}',
    '.alkw-welcome p{margin:0 0 16px;font-size:13px;line-height:1.8;color:#6b7280;display:block;text-align:center}',
    '.alkw-quick-buttons{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:16px}',
    '.alkw-quick-btn{',
      'all:initial;background:#1f2937;border:1px solid #374151;padding:7px 14px;',
      'border-radius:8px;color:#d1d5db;font-size:12px;cursor:pointer;',
      'transition:all .2s;display:inline-flex;align-items:center;gap:6px;font-family:inherit;',
    '}',
    '.alkw-quick-btn:hover{background:#065f46;border-color:#047857;color:#fff}',
    '.alkw-quick-btn span{display:inline;color:inherit;font-size:inherit}',

    /* ── Message bubble (no avatar, align-self) ── */
    '.alkw-message{',
      'max-width:85%;padding:10px 14px;border-radius:12px;font-size:14px;',
      'line-height:2.2;word-wrap:break-word;overflow-wrap:break-word;',
      'animation:alkw-fadeInUp .3s ease;display:block;',
    '}',
    '@keyframes alkw-fadeInUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
    '.alkw-message.alkw-user{align-self:flex-start;background:#065f46;color:#fff}',
    '.alkw-message.alkw-assistant{align-self:flex-end;background:#1f2937;color:#e5e7eb;border:1px solid #374151}',

    /* ── Rich text inside bubbles ── */
    '.alkw-message a{color:#34d399;text-decoration:none;display:inline;cursor:pointer}',
    '.alkw-message a:hover{text-decoration:underline}',
    '.alkw-message strong{font-weight:600;display:inline;color:#fff}',
    '.alkw-message ol,.alkw-message ul{margin:8px 0;padding-right:20px;display:block}',
    '.alkw-message li{margin:10px 0;display:list-item;color:#e2e5eb}',
    '.alkw-message p{margin:10px 0;display:block}',
    '.alkw-message br{display:block;content:"";margin:6px 0}',

    /* ── Loading dots ── */
    '.alkw-loading-wrapper{',
      'align-self:flex-end;background:#1f2937;border:1px solid #374151;',
      'padding:12px 18px;border-radius:12px;display:flex;gap:5px;',
      'animation:alkw-fadeInUp .3s ease;',
    '}',
    '.alkw-loading-wrapper span{',
      'width:7px;height:7px;border-radius:50%;background:#6b7280;',
      'animation:alkw-bounce 1.4s infinite ease-in-out;display:block;',
    '}',
    '.alkw-loading-wrapper span:nth-child(2){animation-delay:.2s}',
    '.alkw-loading-wrapper span:nth-child(3){animation-delay:.4s}',
    '@keyframes alkw-bounce{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1);opacity:1}}',

    /* ── Input area ── */
    '.alkw-input-area{padding:12px 16px;background:#111827;border-top:1px solid #1f2937;flex-shrink:0;display:block}',
    '.alkw-input-wrapper{display:flex;gap:10px;align-items:flex-end}',
    '.alkw-textarea{',
      'all:initial;flex:1;background:#1f2937;border:1px solid #374151;border-radius:12px;',
      'padding:10px 14px;color:#e5e7eb;font-size:14px;font-family:inherit;',
      'resize:none;max-height:100px;line-height:1.5;',
      'transition:border-color .2s;direction:rtl;display:block;',
    '}',
    '.alkw-textarea:focus{outline:none;border-color:#047857}',
    '.alkw-textarea::placeholder{color:#6b7280}',
    '.alkw-send-btn{',
      'all:initial;width:42px;height:42px;background:#f3bf3d;',
      'border:none;border-radius:12px;color:#fff;font-size:18px;',
      'cursor:pointer;display:flex;align-items:center;justify-content:center;',
      'transition:background .2s;flex-shrink:0;transform:scaleX(-1);',
    '}',
    '.alkw-send-btn:hover:not(:disabled){background:#d4a832}',
    '.alkw-send-btn:disabled{background:#374151;cursor:not-allowed}',

    /* ── Mobile ── */
    '@media(max-width:768px){',
      '.alkw-widget-container{left:10px!important;right:10px!important;bottom:80px;width:calc(100vw - 20px);height:calc(100vh - 100px);max-width:100%;max-height:calc(100vh - 100px)}',
      '.alkw-widget-inner{border-radius:0}',
      '.alkw-header{padding:14px 16px}',
      '.alkw-messages{padding:12px}',
      '.alkw-message{max-width:92%}',
      '.alkw-welcome-icon img{width:60px;height:60px}',
      '.alkw-quick-btn{padding:6px 10px;font-size:11px}',
      '.alkw-input-area{padding:10px 12px}',
    '}',

    /* ── Reduced motion ── */
    '@media(prefers-reduced-motion:reduce){',
      '.alkw-widget-container,.alkw-chat-button,.alkw-message,.alkw-loading-wrapper{animation:none!important;transition:none!important}',
    '}',
  ].join('\n');

  // ==========================================================================
  //  §3  HELPERS
  // ==========================================================================
  var _esc = function(text) {
    var d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  };

  var _el = function(tag, props) {
    var el = document.createElement(tag);
    if (!props) return el;
    for (var k in props) {
      if (k === 'className')       el.className = props[k];
      else if (k === 'innerHTML')  el.innerHTML = props[k];
      else if (k === 'style')      Object.assign(el.style, props[k]);
      else                         el[k] = props[k];
    }
    return el;
  };

  // ==========================================================================
  //  §4  WIDGET CLASS
  //      init()  →  button only (< 1 KB CSS, 1 DOM node)
  //      open()  →  first time: build panel + inject panel CSS  (lazy)
  // ==========================================================================
  function AlkafeelChatWidget(config) {
    this.config = {
      apiEndpoint: '/api/chat/site',
      title:       'مساعدك في  موقع العتبة العباسية',
      subtitle:    'اسأل عن  العتبة العباسية',
      position:    'left',
      buttonText:  '<svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="28" cy="9" r="3" fill="white"/><line x1="28" y1="12" x2="28" y2="17" stroke="white" stroke-width="2.5" stroke-linecap="round"/><rect x="13" y="17" width="30" height="22" rx="7" stroke="white" stroke-width="2.5"/><circle cx="22" cy="27" r="3" fill="white"/><circle cx="34" cy="27" r="3" fill="white"/><path d="M21 33.5 Q28 38 35 33.5" stroke="white" stroke-width="2" stroke-linecap="round" fill="none"/><line x1="13" y1="27" x2="9" y2="27" stroke="white" stroke-width="2.5" stroke-linecap="round"/><line x1="43" y1="27" x2="47" y2="27" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>',
      buttonSize:  '60px',
      zIndex:      999998,
    };
    // Merge user config
    for (var k in config) {
      if (config.hasOwnProperty(k)) this.config[k] = config[k];
    }

    this.isOpen       = false;
    this.messages      = [];
    this.isLoading     = false;
    this._panelBuilt   = false;          // ← lazy flag
    this.el            = {};             // DOM refs

    this._initButton();
  }

  // ---------- Phase 1: Button only (runs immediately) ----------

  AlkafeelChatWidget.prototype._initButton = function() {
    // Inject Google Fonts (Readex Pro)
    if (!document.getElementById('alkw-gfont')) {
      var lk = document.createElement('link');
      lk.id = 'alkw-gfont';
      lk.rel = 'stylesheet';
      lk.href = 'https://fonts.googleapis.com/css2?family=Readex+Pro:wght@200;300;400;500;600;700&display=swap';
      document.head.appendChild(lk);
    }
    // Inject button-only CSS (tiny)
    if (!document.getElementById('alkw-btn-css')) {
      var s = document.createElement('style');
      s.id = 'alkw-btn-css';
      s.textContent = BTN_STYLES;
      document.head.appendChild(s);
    }

    this.el.button = _el('button', {
      className: 'alkw-chat-button alkw-' + this.config.position,
      innerHTML: this.config.buttonText,
    });
    this.el.button.style.zIndex = this.config.zIndex;
    this.el.button.setAttribute('aria-label', 'فتح المحادثة');
    document.body.appendChild(this.el.button);

    var self = this;
    this.el.button.addEventListener('click', function() { self.toggle(); });

    console.log('[AlKafeel Widget] Button ready (panel deferred)');
  };

  // ---------- Phase 2: Panel (runs on FIRST open) ----------

  AlkafeelChatWidget.prototype._buildPanel = function() {
    if (this._panelBuilt) return;
    this._panelBuilt = true;

    // Inject panel CSS now
    if (!document.getElementById('alkw-panel-css')) {
      var s = document.createElement('style');
      s.id = 'alkw-panel-css';
      s.textContent = PANEL_STYLES;
      document.head.appendChild(s);
    }

    // Build container — use scoped querySelector, NO global IDs
    var pos = this.config.position;
    this.el.container = _el('div', {
      className: 'alkw-widget-container alkw-' + pos,
    });
    this.el.container.style.zIndex = this.config.zIndex + 1;

    var logoUrl = this._logoUrl();
    this.el.container.innerHTML = [
      '<div class="alkw-widget-inner">',
        '<div class="alkw-header">',
          '<div class="alkw-header-avatar"><img src="' + logoUrl + '" alt=""></div>',
          '<div class="alkw-header-info">',
            '<h2>' + _esc(this.config.title) + '</h2>',
            '<p><span class="alkw-status-dot"></span> متصل</p>',
          '</div>',
          '<button class="alkw-close-btn">\u2715 إغلاق</button>',
        '</div>',
        '<div class="alkw-messages">' + this._welcomeHTML() + '</div>',
        '<div class="alkw-input-area">',
          '<div class="alkw-input-wrapper">',
            '<textarea class="alkw-textarea" placeholder="اكتب رسالتك هنا..." rows="1"></textarea>',
            '<button class="alkw-send-btn">\u27A4</button>',
          '</div>',
        '</div>',
      '</div>',
    ].join('');

    document.body.appendChild(this.el.container);

    // ── Scoped refs (NO document.getElementById) ──
    this.el.messagesArea = this.el.container.querySelector('.alkw-messages');
    this.el.input        = this.el.container.querySelector('.alkw-textarea');
    this.el.sendBtn      = this.el.container.querySelector('.alkw-send-btn');
    this.el.closeBtn     = this.el.container.querySelector('.alkw-close-btn');

    this._attachPanelEvents();
    console.log('[AlKafeel Widget] Panel built (lazy)');
  };

  AlkafeelChatWidget.prototype._attachPanelEvents = function() {
    var self = this;
    this.el.closeBtn.addEventListener('click', function() { self.close(); });
    this.el.sendBtn.addEventListener('click', function()  { self.sendMessage(); });

    this.el.input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); self.sendMessage(); }
    });
    this.el.input.addEventListener('input', function(e) {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    });
    // Quick-suggestion buttons (delegated)
    this.el.messagesArea.addEventListener('click', function(e) {
      var btn = e.target.closest('.alkw-quick-btn');
      if (btn) {
        var q = btn.getAttribute('data-query');
        if (q) { self.el.input.value = q; self.sendMessage(); }
      }
    });
  };

  // ---------- Toggle / Open / Close ----------

  AlkafeelChatWidget.prototype.toggle = function() {
    this.isOpen ? this.close() : this.open();
  };

  AlkafeelChatWidget.prototype.open = function() {
    this._buildPanel();                            // lazy — no-op if already built
    this.isOpen = true;
    this.el.container.classList.add('alkw-open');
    this.el.button.classList.add('alkw-open');
    this.el.button.innerHTML = '\u2715';
    this.el.button.setAttribute('aria-label', 'إغلاق المحادثة');
    this.el.input.focus();
  };

  AlkafeelChatWidget.prototype.close = function() {
    this.isOpen = false;
    if (this.el.container) this.el.container.classList.remove('alkw-open');
    this.el.button.classList.remove('alkw-open');
    this.el.button.innerHTML = this.config.buttonText;
    this.el.button.setAttribute('aria-label', 'فتح المحادثة');
  };

  // ---------- Chat I/O ----------

  AlkafeelChatWidget.prototype.sendMessage = function() {
    var text = this.el.input.value.trim();
    if (!text || this.isLoading) return;

    this.addMessage('user', text);
    this.el.input.value = '';
    this.el.input.style.height = 'auto';

    // Remove welcome
    var w = this.el.messagesArea.querySelector('.alkw-welcome');
    if (w) w.remove();

    this.isLoading = true;
    this.el.sendBtn.disabled = true;
    var loadingId = 'alkw-ld-' + Date.now();
    this._addLoading(loadingId);

    var self = this;
    fetch(this.config.apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages:   self.messages,
        temperature: 0.5,
        max_tokens:  1200,
        use_tools: true,
      }),
    })
    .then(function(response) {
      self._removeById(loadingId);

      if (!response.ok) {
        // حاول قراءة رسالة الخطأ
        return response.text().then(function(t) {
          var msg = '⚠️ عذراً، حدث خطأ. يُرجى المحاولة مرة أخرى.';
          try { var d = JSON.parse(t); msg = d.fallback || d.error || msg; } catch(e) {}
          self.addMessage('assistant', msg);
        });
      }

      // ✅ دائماً streaming — الرد يأتي كـ text/plain stream
      if (response.body) {
        return self._readStream(response);
      }

      // fallback: قراءة كنص
      return response.text().then(function(t) {
        self.addMessage('assistant', t || 'لم يتم استلام رد.');
      });
    })
    .catch(function(err) {
      console.error('[AlKafeel Widget]', err);
      self._removeById(loadingId);
      var msg;
      if (!navigator.onLine) {
        msg = '📵 لا يوجد اتصال بالإنترنت. يرجى التحقق من شبكتك والمحاولة مرة أخرى.';
      } else if (err && (err.name === 'TypeError' || (err.message && err.message.toLowerCase().includes('fetch')))) {
        msg = '⚠️ تعذّر الوصول إلى الخادم. يرجى التحقق من اتصالك والمحاولة مرة أخرى.';
      } else {
        msg = '⚠️ عذراً، حدث خطأ في الاتصال. يُرجى المحاولة مرة أخرى.';
      }
      self.addMessage('assistant', msg);
    })
    .finally(function() {
      self.isLoading = false;
      self.el.sendBtn.disabled = false;
      self.el.input.focus();
    });
  };

  AlkafeelChatWidget.prototype._readStream = function(response) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var full = '';
    var id = 'alkw-st-' + Date.now();
    var bubble = this._makeBubble(id);
    var self = this;

    function pump() {
      return reader.read().then(function(result) {
        if (result.done) {
          self.messages.push({ role: 'assistant', content: full });
          return;
        }
        full += decoder.decode(result.value, { stream: true });
        bubble.innerHTML = self._fmt(full);
        self._scroll();
        return pump();
      });
    }
    return pump().catch(function(e) {
      console.error('[AlKafeel Widget] Stream error:', e);
      if (!full) {
        full = !navigator.onLine
          ? '📵 انقطع الاتصال أثناء استلام الرد. يرجى التحقق من شبكتك.'
          : '⚠️ حدث خطأ أثناء استلام الرد. يُرجى المحاولة مرة أخرى.';
        bubble.innerHTML = self._fmt(full);
      }
      self.messages.push({ role: 'assistant', content: full });
    });
  };

  // ---------- DOM helpers ----------

  AlkafeelChatWidget.prototype.addMessage = function(role, content) {
    this.messages.push({ role: role, content: content });

    var bub = _el('div', { className: 'alkw-message alkw-' + role, innerHTML: this._fmt(content) });
    this.el.messagesArea.appendChild(bub);
    this._scroll();
  };

  AlkafeelChatWidget.prototype._addLoading = function(id) {
    var el = _el('div', { className: 'alkw-loading-wrapper' });
    el.setAttribute('data-alkw-id', id);
    el.innerHTML = '<span></span><span></span><span></span>';
    this.el.messagesArea.appendChild(el);
    this._scroll();
  };

  AlkafeelChatWidget.prototype._makeBubble = function(id) {
    var bub = _el('div', { className: 'alkw-message alkw-assistant' });
    bub.setAttribute('data-alkw-id', id);
    this.el.messagesArea.appendChild(bub);
    this._scroll();
    return bub;
  };

  AlkafeelChatWidget.prototype._removeById = function(id) {
    var el = this.el.container.querySelector('[data-alkw-id="' + id + '"]');
    if (el) el.remove();
  };

  AlkafeelChatWidget.prototype._scroll = function() {
    var ma = this.el.messagesArea;
    setTimeout(function() { ma.scrollTop = ma.scrollHeight; }, 80);
  };

  AlkafeelChatWidget.prototype._logoUrl = function() {
    if (this.config.logo) return this.config.logo;
    var ep = this.config.apiEndpoint;
    if (ep.indexOf('http') === 0) {
      try { return (new URL(ep)).origin + '/logo.png'; } catch(e) {}
    }
    return '/logo.png';
  };

  AlkafeelChatWidget.prototype._fmt = function(text) {
    if (!text) return '';
    var h = _esc(text);
    h = h.replace(/\*\*(.+?)\*\*/g,                                  '<strong>$1</strong>');
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g,                        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    h = h.replace(/^(\d+)\.\s+(.+)$/gm,                              '<li>$2</li>');
    h = h.replace(/^[-\u2022]\s+(.+)$/gm,                            '<li>$1</li>');
    h = h.replace(/\n/g,                                              '<br>');
    h = h.replace(/((<li>.+?<\/li>)(<br>)*)+/g, function(m) {
      return '<ol>' + m.replace(/<br>/g, '') + '</ol>';
    });
    return h;
  };

  AlkafeelChatWidget.prototype._welcomeHTML = function() {
    var logoUrl = this._logoUrl();
    var btns = [
      { e:'📰', l:'آخر الأخبار',             q:'اعطني آخر الأخبار من العتبة العباسية' },
      { e:'🎬', l:'آخر الفيديوهات',          q:'اعرض أحدث الفيديوهات' },
      { e:'📂', l:'أقسام الفيديو',           q:'ما هي أقسام الفيديو المتوفرة؟' },
      { e:'📜', l:'تاريخ العتبة',            q:'اعرض لي تاريخ العتبة حسب الأقسام' },
      { e:'🕊️', l:'سيرة أبي الفضل العباس',  q:'اعطني معلومات عن تاريخ أبي الفضل العباس' },
      { e:'🧭', l:'نشاطات رمضانية',          q:'ابحث عن نشاطات رمضانية حديثة' },
      { e:'🗂️', l:'محاضرات وندوات',          q:'اعرض أحدث المحاضرات والندوات' },
      { e:'🔤', l:'مصطلحات الموقع',          q:'اعرض أمثلة من كلمات واجهة الموقع باللغة العربية' },
    ];
    var html = btns.map(function(b) {
      return '<button class="alkw-quick-btn" data-query="' + _esc(b.q) + '">'
           + '<span>' + b.e + '</span><span>' + _esc(b.l) + '</span></button>';
    }).join('');
    return '<div class="alkw-welcome">'
         + '<div class="alkw-welcome-icon"><img src="' + logoUrl + '" alt=""></div>'
          + '<h3>  مرحباً بك، أنا مساعدك في محتوى العتبة العباسية المقدسة </h3>'
          + '<p>يمكنني مساعدتك في الأخبار، الفيديوهات، التاريخ، وأقسام المحتوى المتاحة.</p>'
         + '<div class="alkw-quick-buttons">' + html + '</div></div>';
  };

  AlkafeelChatWidget.prototype.destroy = function() {
    if (this.el.button)    this.el.button.remove();
    if (this.el.container) this.el.container.remove();
    var s1 = document.getElementById('alkw-btn-css');   if (s1) s1.remove();
    var s2 = document.getElementById('alkw-panel-css'); if (s2) s2.remove();
  };

  // ==========================================================================
  //  §5  PUBLIC API
  // ==========================================================================
  window.AlkafeelWidget = {
    _loaded: true,
    _instances: [],
    version: '2.0.0',

    /**
     * تهيئة الودجت
     * @param {Object} config
     * @returns {AlkafeelChatWidget}
     */
    init: function(config) {
      var w = new AlkafeelChatWidget(config || {});
      this._instances.push(w);
      return w;
    },

    /** إزالة جميع instances */
    destroyAll: function() {
      this._instances.forEach(function(w) { w.destroy(); });
      this._instances = [];
    },
  };

  // Auto-init
  if (window.ALKAFEEL_WIDGET_CONFIG) {
    window.AlkafeelWidget.init(window.ALKAFEEL_WIDGET_CONFIG);
  }

  console.log('[AlKafeel Widget] v2.0.0 loaded');

})(window, document);
