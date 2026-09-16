// ================================
// 🔥 VERSION = DEPLOY TARİHİ
// ================================
const VERSION = new Date().toISOString().slice(0, 10); // örn: 2025-12-15
const CACHE_NAME = `siparis-app-${VERSION}`;

// Cache edilecek dosyalar
const ASSETS = [
  "/",
  "/index.html",
  "/login.html",
  "/style.css",
  "/app.js",
  "/config.js",
  "/manifest.json",
  "/logo.png",
  "/favicon.png"
];

// ================================
// INSTALL
// ================================
self.addEventListener("install", (event) => {
  console.log("🆕 SW install:", CACHE_NAME);

  self.skipWaiting(); // 🔥 bekleme yok

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// ================================
// ACTIVATE
// ================================
self.addEventListener("activate", (event) => {
  console.log("🚀 SW activate:", CACHE_NAME);

  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => {
            console.log("🗑️ Eski cache silindi:", k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim()) // 🔥 herkese zorla geç
  );
});

// ================================
// FETCH
// ================================
self.addEventListener("fetch", (event) => {
  // POST / API request’lerini cacheleme
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, copy);
        });
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
