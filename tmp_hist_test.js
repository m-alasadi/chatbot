const https = require('https');
const q = encodeURIComponent('تأسيس العتبة');
const url = 'https://alkafeel.net/news/search?lang=ar&q=' + q;
https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const m = [...d.matchAll(/class="title"[^>]*>([^<]+)</g)];
    console.log('hits:', m.length, 'status:', res.statusCode);
    m.slice(0, 5).forEach(x => console.log(' -', x[1].trim()));
  });
}).on('error', e => console.error(e.message));
