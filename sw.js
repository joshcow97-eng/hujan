/* Hujan service worker: keeps the app shell available offline.
   Weather data is never cached here; the app keeps its own last forecast. */
const VERSION = "hujan-v1";
const SHELL = ["./", "index.html", "styles.css", "config.js", "app.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  const isShell = url.origin === location.origin || url.hostname === "cdnjs.cloudflare.com";
  if (e.request.method !== "GET" || !isShell) return; // APIs and tiles go straight to the network
  // Network first so updates appear immediately; cache as fallback when offline.
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(VERSION).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
