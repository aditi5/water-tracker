/* Offline cache for the water app. Bump VERSION when files change. */
var VERSION = 'water-v2';
var ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.json',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// Network-first for navigations (so updates arrive), cache-first for assets.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put('index.html', copy); });
      return res;
    }).catch(function () { return caches.match('index.html'); }));
    return;
  }
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
      return res;
    });
  }));
});

// ---------- Web Push (reminders sent by the GitHub Actions workflow) ----------
var DEFAULT_TITLE = 'Drink water 💧';
var DEFAULT_BODY = 'Time for a glass of water, Aditi 💙';
self.addEventListener('push', function (e) {
  var data = {};
  if (e.data) {
    try { data = e.data.json() || {}; } catch (err) {
      try { data = { body: e.data.text() }; } catch (err2) { data = {}; }
    }
  }
  // iOS requires every push to show a notification, so always show one.
  e.waitUntil(self.registration.showNotification(data.title || DEFAULT_TITLE, {
    body: data.body || DEFAULT_BODY,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: 'water',
    renotify: true,
    data: { url: self.registration.scope }
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(self.registration.scope) === 0 && 'focus' in list[i]) return list[i].focus();
    }
    return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
  }));
});
