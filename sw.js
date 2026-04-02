const VERSION = "v3";
const APP_SHELL_CACHE = `alan-defteri-shell-${VERSION}`;
const RUNTIME_CACHE = `alan-defteri-runtime-${VERSION}`;
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => ![APP_SHELL_CACHE, RUNTIME_CACHE].includes(key)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function shouldBypassCache(requestUrl) {
  const url = new URL(requestUrl);
  const host = url.hostname;
  return (
    host.includes("supabase.co") ||
    host.includes("overpass") ||
    host.includes("open-meteo.com") ||
    host.includes("wikipedia.org")
  );
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise || new Response("Offline", { status: 503, statusText: "Offline" });
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const reqUrl = new URL(event.request.url);
  const isSameOrigin = reqUrl.origin === self.location.origin;
  const isNavigation = event.request.mode === "navigate";

  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(APP_SHELL_CACHE).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  if (shouldBypassCache(event.request.url)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  if (!isSameOrigin && reqUrl.protocol !== "https:") return;
  event.respondWith(staleWhileRevalidate(event.request));
});
