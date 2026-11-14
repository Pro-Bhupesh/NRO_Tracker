// Service worker: makes the app installable and keeps a copy of the app files.
// Network first, so a new version on GitHub is picked up on the next load; the saved copy is used only when offline.
// Change the version when you want every phone to drop its saved copy.
const CACHE = "nro-tracker-v1";
const FILES = ["./", "index.html", "app.js", "store.js", "data.js", "firebase-config.js", "landing-bg.jpg", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).catch(() => { })); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // Firebase and other hosts go straight to the network
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
});
