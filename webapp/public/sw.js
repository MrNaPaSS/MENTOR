// NMNH Service Worker - кэширование статики для быстрой загрузки (ТЗ §11).
// Без офлайн-режима: кэшируем только успешные GET одного источника, навигации - из сети.
//
// Версия в имени кэша не косметика: при её смене activate сносит всё прежнее.
// Сборка меняет имена файлов, старые копии уже никто не спросит, а место они
// занимают.
const CACHE = "nmnh-static-v5";
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

  event.respondWith(serve(event, request));
});

/**
 * Отдать файл: сначала копия, потом сеть.
 *
 * Важнее всего здесь то, чего эта функция не делает, - она никогда не отвечает
 * пустотой. Прежняя версия при промахе кэша возвращала обещание сети, а оно на
 * ошибке разрешалось в undefined: воркер падал сам, и браузер писал «перехватил
 * запрос и столкнулся с неожиданной ошибкой» вместо честного 404. Один файл, не
 * доехавший до сервера при выкладке, превращался в необъяснимую поломку всего
 * кабинета - с ChunkLoadError и белым экраном.
 *
 * Ответ сервера отдаётся как есть, даже когда это 404. Пусть Next скажет, какой
 * кусок он не смог загрузить и по какому адресу: по такой ошибке видно, что
 * чинить, а по «что-то случилось в воркере» - нет.
 */
async function serve(event, request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);

  if (cached) {
    // Файлы сборки неизменны по имени: имя меняется вместе с содержимым, и
    // перепроверять нечего. Остальное обновляем фоном - копия уходит человеку
    // сразу, свежее приедет к следующему разу.
    if (!new URL(request.url).pathname.startsWith("/_next/static/")) {
      event.waitUntil(revalidate(cache, request));
    }
    return cached;
  }

  try {
    const network = await fetch(request);
    if (network.status === 200) cache.put(request, network.clone()).catch(() => {});
    return network;
  } catch {
    // Сети нет вовсе, копии тоже: честная сетевая ошибка вместо пустоты.
    return Response.error();
  }
}

async function revalidate(cache, request) {
  try {
    const fresh = await fetch(request);
    if (fresh.status === 200) await cache.put(request, fresh.clone());
  } catch {
    // Молча: копия у человека уже есть, обновимся в другой раз.
  }
}
