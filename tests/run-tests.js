/**
 * Automated Widget Tests — Step 6
 * يُنفذ من Terminal ويختبر كل شيء برمجياً
 */

const API = 'http://localhost:3000';
const EXT = 'http://localhost:4444';

const results = [];

function test(name, passed, detail = '') {
  const icon = passed ? '✅' : '❌';
  results.push({ name, passed, detail });
  console.log(`  ${icon} ${name}${detail ? ' — ' + detail : ''}`);
}







async function run() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   🧪 اختبارات الودجت — الخطوة 6                  ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // ───── اختبار 1: تحميل الملفات ─────
  console.log('── اختبار 1: تحميل widget.js ──');

  // 1a: Static file
  try {
    const r = await fetch(API + '/widget.js');
    const body = await r.text();
    test('widget.js (static)', r.status === 200 && body.includes('AlkafeelWidget'),
      `${r.status} | ${body.length} bytes`);
  } catch (e) {
    test('widget.js (static)', false, e.message);
  }

  // 1b: API route
  try {
    const r = await fetch(API + '/api/widget');
    const body = await r.text();
    const ct = r.headers.get('content-type') || '';
    test('/api/widget endpoint', r.status === 200 && ct.includes('javascript'),
      `${r.status} | type: ${ct.substring(0,40)}`);
  } catch (e) {
    test('/api/widget endpoint', false, e.message);
  }

  // 1c: External HTML loads
  try {
    const r = await fetch(EXT + '/test-external.html');
    test('صفحة الاختبار الخارجية', r.status === 200,
      `${r.status} from port 4444`);
  } catch (e) {
    test('صفحة الاختبار الخارجية', false, e.message);
  }

  // ───── اختبار 2: CORS من دومين مختلف ─────
  console.log('\n── اختبار 2: CORS Cross-Origin ──');

  // 2a: OPTIONS preflight
  try {
    const r = await fetch(API + '/api/chat/site', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:4444',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    });
    const acao = r.headers.get('access-control-allow-origin');
    test('CORS Preflight (OPTIONS)', r.status === 204 && !!acao,
      `status: ${r.status} | Allow-Origin: ${acao}`);
  } catch (e) {
    test('CORS Preflight (OPTIONS)', false, e.message);
  }

  // 2b: POST with foreign Origin
  try {
    const r = await fetch(API + '/api/chat/site', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://some-laravel-site.com'
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'test' }],
        temperature: 0.7,
        max_tokens: 100,
        use_tools: true
      })
    });
    const acao = r.headers.get('access-control-allow-origin');
    test('POST with foreign Origin', r.status === 200 && !!acao,
      `status: ${r.status} | Allow-Origin: ${acao}`);
  } catch (e) {
    test('POST with foreign Origin', false, e.message);
  }

  // 2c: widget.js has no CORS issues (public asset)
  try {
    const r = await fetch(API + '/widget.js', {
      headers: { 'Origin': 'https://external-domain.com' }
    });
    test('widget.js cross-origin load', r.status === 200,
      `status: ${r.status}`);
  } catch (e) {
    test('widget.js cross-origin load', false, e.message);
  }

  // ───── اختبار 3: API Chat — صحة الـ Request/Response ─────
  console.log('\n── اختبار 3: إرسال رسائل فعلية ──');

  // 3a: Simple greeting
  try {
    const r = await fetch(API + '/api/chat/site', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'مرحبا' }],
        temperature: 0.7,
        max_tokens: 500,
        use_tools: true
      })
    });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const data = await r.json();
    test('رسالة ترحيب', r.status === 200 && !!data.message,
      `mode: ${data.mode} | reply: "${(data.message||'').substring(0,60)}..."`);
  } catch (e) {
    test('رسالة ترحيب', false, e.message);
  }

  // 3b: Function Calling (search)
  try {
    const r = await fetch(API + '/api/chat/site', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'أعرض لي المشاريع الطبية' }],
        temperature: 0.7,
        max_tokens: 2000,
        use_tools: true
      })
    });
    const data = await r.json();
    const hasProjects = data.message && (
      data.message.includes('مشروع') || data.message.includes('طب') ||
      data.message.includes('مستشفى') || data.message.includes('صح')
    );
    test('Function Calling (بحث مشاريع)', r.status === 200 && hasProjects,
      `iterations: ${data.iterations} | mode: ${data.mode} | len: ${(data.message||'').length}`);
  } catch (e) {
    test('Function Calling (بحث مشاريع)', false, e.message);
  }

  // 3c: Conversation context (multi-turn)
  try {
    const r = await fetch(API + '/api/chat/site', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'ما هي المشاريع الثقافية؟' },
          { role: 'assistant', content: 'تشمل المشاريع الثقافية المجلات والمكتبات...' },
          { role: 'user', content: 'أعطني تفاصيل أكثر عن أولها' }
        ],
        temperature: 0.7,
        max_tokens: 2000,
        use_tools: true
      })
    });
    const data = await r.json();
    test('محادثة متعددة الأدوار', r.status === 200 && !!data.message,
      `iterations: ${data.iterations} | len: ${(data.message||'').length}`);
  } catch (e) {
    test('محادثة متعددة الأدوار', false, e.message);
  }

  // ───── اختبار 4: Response Format (mapping ثابت) ─────
  console.log('\n── اختبار 4: شكل الرد (mapping) ──');

  try {
    const r = await fetch(API + '/api/chat/site', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'كم عدد المشاريع؟' }],
        temperature: 0.7,
        max_tokens: 500,
        use_tools: true
      })
    });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const data = await r.json();

    test('Content-Type = JSON', ct.includes('application/json'),
      ct);
    test('حقل message موجود', typeof data.message === 'string' && data.message.length > 0,
      `typeof: ${typeof data.message} | len: ${(data.message||'').length}`);
    test('حقل mode موجود', data.mode === 'function_calling',
      `mode: ${data.mode}`);
    test('حقل iterations رقمي', typeof data.iterations === 'number',
      `iterations: ${data.iterations}`);
  } catch (e) {
    test('Response format', false, e.message);
  }

  // ───── اختبار 5: widget.js Code Quality ─────
  console.log('\n── اختبار 5: جودة كود الودجت ──');

  try {
    const r = await fetch(API + '/widget.js');
    const code = await r.text();

    test('CSS prefix (alkw-)', code.includes('.alkw-') && !code.includes('.chat-button '),
      'All classes prefixed');
    test('RTL (direction:rtl)', code.includes('direction:rtl'),
      'Found RTL rule');
    test('@media 768px responsive', code.includes('@media(max-width:768px)'),
      'Mobile breakpoint exists');
    test('IIFE pattern', code.startsWith('/**') && code.includes('(function(window, document)'),
      'Properly wrapped');
    test('Zero dependencies', !code.includes('require(') && !code.includes('import '),
      'No require/import');
    test('XSS: _esc()', code.includes('_esc'),
      'HTML escaping present');
    test('Streaming support', code.includes('_readStream') && code.includes('getReader'),
      'Stream handler + reader');
    test('use_tools: true', code.includes('use_tools: true'),
      'Correct API format');
    test('Lazy loading', code.includes('_panelBuilt') && code.includes('_buildPanel'),
      'Panel deferred until first open');
    test('CSS isolation (all:initial)', code.includes('all:initial'),
      'Hard reset blocks host CSS inheritance');
    test('No global element IDs', !code.includes('getElementById(\'alkw-input') && !code.includes('getElementById(\'alkw-send') && !code.includes('getElementById(\'alkw-messages'),
      'Content elements use scoped querySelector');

    // Size check
    const sizeKB = (code.length / 1024).toFixed(1);
    test(`حجم مناسب (< 40KB)`, code.length < 40000,
      `${sizeKB} KB`);
  } catch (e) {
    test('Widget code analysis', false, e.message);
  }

  // ───── اختبار 6: Error Handling ─────
  console.log('\n── اختبار 6: معالجة الأخطاء ──');

  // Empty messages
  try {
    const r = await fetch(API + '/api/chat/site', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] })
    });
    test('رسائل فارغة → 400', r.status === 400,
      `status: ${r.status}`);
  } catch (e) {
    test('رسائل فارغة → 400', false, e.message);
  }

  // Invalid JSON
  try {
    const r = await fetch(API + '/api/chat/site', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json'
    });
    test('JSON خاطئ → error', r.status >= 400,
      `status: ${r.status}`);
  } catch (e) {
    test('JSON خاطئ → error', false, e.message);
  }

  // ───── Summary ─────
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║   📊 النتيجة: ${passed}/${total} نجاح  |  ${failed} فشل`);
  console.log('╚══════════════════════════════════════════════════╝');

  if (failed > 0) {
    console.log('\n❌ الاختبارات الفاشلة:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`   • ${r.name}: ${r.detail}`);
    });
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
