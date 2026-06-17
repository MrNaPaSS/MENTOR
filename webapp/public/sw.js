// NMNH Service Worker - кэширование статики для быстрой загрузки (ТЗ §11).
// Без офлайн-режима: кэшируем только успешные GET одного источника, навигации - из сети.

const CACHE = "nmnh-static-v1";
const STATIC = ["/icons/icon-192.png", "/icons/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;       // только свой источник
  if (request.mode === "navigate") return;               // навигации - из сети (без офлайна)
  if (!/\/_next\/static\/|\/icons\/|\.(png|jpg|svg|woff2?|css|js)$/.test(url.pathname)) return;

  // stale-while-revalidate для статики
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
