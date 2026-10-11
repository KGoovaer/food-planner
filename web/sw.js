// Network-first with a timeout: fresh data when online, the last known plan / shopping list / recipes
// when the shop has no signal. Recipe images are immutable, so they are served cache-first.
const CACHE = "food-planner-v2";
const SHELL = ["/", "/app.js", "/style.css", "/manifest.webmanifest", "/icon.svg", "/icon-192.png"];
const OFFLINE_API = /^\/api\/(plan|shopping|recipes|settings|status)(\/\d+)?$/;
const TIMEOUT_MS = 6000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = (await cache.match(req)) || (req.mode === "navigate" ? await cache.match("/") : undefined);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname === "/share") return;
  if (url.pathname.startsWith("/images/")) return event.respondWith(cacheFirst(req));
  if (url.pathname.startsWith("/api/")) {
    if (OFFLINE_API.test(url.pathname)) event.respondWith(networkFirst(req));
    return; // other API calls (imports, Bring! lists) always go to the network
  }
  event.respondWith(networkFirst(req));
});
