// Oflayn rejim: sahifa va uning fayllari keshda saqlanadi, internet bo'lmasa ham ochiladi.
// API so'rovlari keshlanmaydi — ular doim tarmoqdan (ma'lumot eskirmasin).
const CACHE = 'stoyanka-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if ((!sameOrigin && !fonts) || url.pathname.startsWith('/api')) return;

  // Sahifa: avval tarmoq (yangi versiya), bo'lmasa keshdagi nusxa
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }
  // Fayllar (JS, CSS, shriftlar): keshdan darhol, orqada yangilanadi
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req)
        .then((res) => {
          if (res.ok || res.type === 'opaque') c.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
