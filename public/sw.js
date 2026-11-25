// Service Worker: macht die Lernapp installierbar und lädt Programmteile schneller.
// App-Dateien: zuerst aus dem Netz (damit Updates sofort ankommen), sonst aus dem Zwischenspeicher.
// Daten (Supabase, /api) werden nie zwischengespeichert.
const CACHE = 'kv-lernapp-v2'; // v2: neues Logo und Icons
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/config.json') return;
  if (url.pathname.startsWith('/vendor/')) {
    // Bibliotheken ändern sich selten: Zwischenspeicher zuerst
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('/index.html'))));
});
