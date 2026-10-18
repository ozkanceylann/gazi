// ================================
// 🔥 VERSION = DEPLOY TARİHİ
// ================================
const VERSION = "20261019-direct-cargo-emphasis-82";
const CACHE_NAME = `siparis-app-${VERSION}`;

// Cache edilecek dosyalar
const ASSETS = [
  "/",
  "/index.html",
  "/login.html",
  "/style.css",
  "/theme.css",
  "/app.js",
  "/mobile-navigation.js",
  "/config.js",
  "/cargo-weights.js",
  "/label-scanner.js",
  "/branch-selector.js",
  "/manifest.json",
  "/install-app.js",
  "/install-app.css",
  "/icons/siparis-operasyon-180.png",
  "/icons/siparis-operasyon-192.png",
  "/icons/siparis-operasyon-512.png",
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

// Named label previews stay in this browser and expire after one hour.
self.addEventListener("message", event => {
  if(event.data?.type==="gazi-cargo-pdf-support")event.ports[0]?.postMessage(true);
});

// ================================
// FETCH
// ================================
self.addEventListener("fetch", (event) => {
  // POST / API request’lerini cacheleme
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if(url.origin===self.location.origin && url.pathname.startsWith("/__cargo_pdf__/")){
    event.respondWith((async()=>{
      const cache=await caches.open("gazi-pdf-previews-v1");
      const pdf=await cache.match(event.request);
      if(pdf && Number(pdf.headers.get("X-Preview-Expires"))>Date.now())return pdf;
      if(pdf)await cache.delete(event.request);
      return new Response("Etiket önizlemesinin süresi doldu. Siparişten Etiketi Yazdır ile yeniden açın.",{status:410,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});
    })());
    return;
  }
  if (url.origin === self.location.origin &&
      (/\/printetiket(?:-v2)?\.html$/.test(url.pathname) ||
       url.pathname.endsWith("/app.js"))) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

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








