/* Service worker АРКАДИИ: игра работает офлайн и при остановленном сайте после первой загрузки. */
const CACHE = 'arcadia-v20';
const IMG_CACHE = 'arcadia-img-v1';
const CORE = ['/', '/index.html', '/download.html', '/coop.js', '/soul.js', '/soul.css', '/export.js', '/app.js',
  '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png',
  '/assets/aeon-phase-1.jpg', '/assets/aeon-phase-2.jpg', '/assets/aeon-phase-3.jpg', '/assets/character-mechanics.html',
  '/docs/undertale-attack-catalog.md', '/docs/500-rpg-attack-manual.md'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(CORE.map(u => fetch(new Request(u, { cache: 'reload' }))
    .then(r => { if (r.ok) return c.put(u, r); throw new Error(u + ': ' + r.status); })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== IMG_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Сеть с таймаутом: если сайт остановлен, недоступен или отвечает ошибкой — берём копию из кэша.
function netFirst(req, fallbackUrl) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 5000);
  const fromCache = () => caches.match(req, { ignoreSearch: true }).then(r => r || (fallbackUrl ? caches.match(fallbackUrl) : undefined))
    .then(r => r || new Response('Нет подключения', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
  return fetch(req, { signal: ctrl.signal }).then(r => {
    clearTimeout(timer);
    // Ответ остановленного сайта (404/5xx) не должен заменять сохранённую игру
    if (!r.ok) return caches.match(req, { ignoreSearch: true }).then(c => c || (fallbackUrl ? caches.match(fallbackUrl) : null)).then(c => c || r);
    const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return r;
  }).catch(() => { clearTimeout(timer); return fromCache(); });
}
self.addEventListener('fetch', e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin !== location.origin) {
    // Портреты персонажей с внешних сайтов: сохраняем при первом показе, чтобы они были видны без интернета
    if (req.destination === 'image') e.respondWith(caches.open(IMG_CACHE).then(c => c.match(req).then(hit => hit ||
      fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()).catch(() => {}); return r; }))));
    return;
  }
  if (url.pathname.startsWith('/.netlify/') || url.pathname.startsWith('/api/')) return; // сеть, кооп, архивы — без кэша
  if (req.mode === 'navigate') { e.respondWith(netFirst(req, url.pathname.startsWith('/download') ? '/download.html' : '/index.html')); return; }
  if (/\.(html|js|css|webmanifest|md)$/.test(url.pathname)) { e.respondWith(netFirst(req)); return; }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req).then(n => { if (n.ok) { const cp = n.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return n; })));
});
