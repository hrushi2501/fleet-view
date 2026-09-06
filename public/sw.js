// FleetView service worker — installable PWA + offline shell + push
const CACHE = "fleetview-v1";
const SHELL = ["/", "/login", "/driver", "/icon.svg", "/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Network-only for all Next.js javascript chunks and API routes
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/api/")) {
    return; // Pass through directly to network
  }
  // Only cache static images and icons
  if (url.pathname.endsWith(".png") || url.pathname.endsWith(".svg") || url.pathname.endsWith(".ico")) {
    e.respondWith(caches.match(req).then((c) => c || fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((cc) => cc.put(req, copy)); return r; })));
    return;
  }
});

// Push notifications
self.addEventListener("push", (e) => {
  let data = { title: "FleetView", body: "You have a new alert" };
  try { if (e.data) data = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: "/icon-192.png", badge: "/icon-192.png", data: data.url || "/notifications",
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = typeof e.notification.data === "string" && /^\/(?!\/)/.test(e.notification.data) ? e.notification.data : "/notifications";
  e.waitUntil(self.clients.openWindow(target));
});
