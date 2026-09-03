/* Minimal service worker: precache the app shell, network-first for menu.json. */
var CACHE = "fueltrain-shell-v2";
var SHELL = [
  ".",
  "index.html",
  "css/styles.css",
  "js/store.js",
  "js/util.js",
  "js/menu.js",
  "js/usda.js",
  "js/ai.js",
  "js/fuel.js",
  "js/train.js",
  "js/progress.js",
  "js/app.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) {
      return c.add(new Request(u, { cache: "reload" })).catch(function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  // Never touch cross-origin API calls (USDA, Anthropic).
  if (url.origin !== self.location.origin) return;

  // menu.json: fresh first, fall back to cache when offline.
  if (url.pathname.endsWith("/menu.json") || url.pathname === "/menu.json") {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  // App shell: cache first.
  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res.ok && (req.destination === "script" || req.destination === "style" || req.destination === "document")) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return caches.match("index.html"); });
    })
  );
});
