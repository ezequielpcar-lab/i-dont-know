// Guarda la app en caché para que abra al instante y funcione sin conexión
// (las búsquedas y el análisis con IA sí necesitan internet).
const CACHE = "webradar-v3";
const SHELL = [
  "./", "index.html", "css/styles.css", "js/app.js", "js/osm.js", "js/ai.js", "js/pricing.js",
  "js/vendor/anthropic-sdk.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Red primero para los archivos de la app (así recibes las actualizaciones), caché si no hay conexión.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
