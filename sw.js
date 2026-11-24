/* Hujan service worker: keeps the app shell available offline.
   Weather data is never cached here; the app keeps its own last forecast. */
const VERSION = "hujan-v3";
const SHELL = ["./", "index.html", "styles.css", "config.js", "wbgt.js", "app.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"];

self.addEventListener("install", e => {
  // "reload" skips the browser's stored copies, so a new version never installs old files.
  const fresh = SHELL.map(u => u.startsWith("https:") ? u : new Request(u, { cache: "reload" }));
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(fresh)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  const own = url.origin === location.origin;
  if (e.request.method !== "GET" || !(own || url.hostname === "cdnjs.cloudflare.com")) return; // APIs and tiles go straight to the network
  // Network first so updates appear immediately; cache as fallback when offline.
  // GitHub Pages lets browsers reuse files for 10 minutes; "no-cache" makes them check with the server each time,
  // so the page and its scripts don't come from different versions.
  e.respondWith((own ? fetch(e.request, { cache: "no-cache" }) : fetch(e.request)).then(r => {
    if (r.ok) { const copy = r.clone(); e.waitUntil(caches.open(VERSION).then(c => c.put(e.request, copy))); }
    return r;
  }).catch(async err => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }));
});
