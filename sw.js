// Offline-Cache: App lädt auch ohne Netz im Gym
const CACHE = 'gym-v19';
const FILES = ['./', 'index.html', 'supabase.js', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Erst Netz (immer neueste Version, am Browser-Cache vorbei), bei keinem Netz aus dem Cache
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Nur eigene Dateien cachen – Anfragen an die Datenbank laufen immer direkt
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache' }).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

// Push-Mitteilungen (kommen vom Server, auch wenn die App zu ist)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Gym', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag, data: { url: d.url || '' }
  }));
});
// Antippen öffnet die App (direkt im Social-Tab)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.url) || '';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ('focus' in c) { c.postMessage({ nav: hash.replace('#', '') }); return c.focus(); } }
    return clients.openWindow(new URL('./' + hash, self.registration.scope).href);
  }));
});
