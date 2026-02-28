// MGV Service Worker — Push Notifications + Offline Cache
const CACHE = 'mgv-v1';
const PRECACHE = ['/', '/style.css', '/app.js'];

// ── Install: precache shell ──
self.addEventListener('install', function(e) {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE).then(function(c) { return c.addAll(PRECACHE); })
    );
});

// ── Activate: clean old caches ──
self.addEventListener('activate', function(e) {
    e.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
        }).then(function() { return self.clients.claim(); })
    );
});

// ── Fetch: network-first for API/WS, cache-first for assets ──
self.addEventListener('fetch', function(e) {
    var url = e.request.url;
    // Don't cache WebSocket or API calls
    if (url.includes('/upload') || url.includes('/api/') || e.request.method !== 'GET') {
        return;
    }
    e.respondWith(
        fetch(e.request).then(function(resp) {
            // Cache successful responses for static assets
            if (resp.ok && (url.endsWith('.css') || url.endsWith('.js') || url.endsWith('.png'))) {
                var clone = resp.clone();
                caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
            }
            return resp;
        }).catch(function() {
            return caches.match(e.request);
        })
    );
});

// ── Push: show notification ──
self.addEventListener('push', function(e) {
    var data = {};
    try { data = e.data.json(); } catch (ex) { data = { title: 'MGV', body: e.data ? e.data.text() : 'Новое сообщение' }; }

    var title = data.title || 'MGV Messenger';
    var options = {
        body: data.body || 'Новое сообщение',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: data.tag || 'mgv-msg',
        data: data.url || '/',
        vibrate: [200, 100, 200],
        actions: [
            { action: 'open', title: 'Открыть' },
            { action: 'close', title: 'Закрыть' }
        ],
        renotify: true,
        silent: false
    };
    e.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: focus or open app ──
self.addEventListener('notificationclick', function(e) {
    e.notification.close();
    if (e.action === 'close') return;
    var url = e.notification.data || '/';
    e.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
            for (var i = 0; i < clients.length; i++) {
                if (clients[i].url.includes(self.location.origin)) {
                    clients[i].focus();
                    clients[i].postMessage({ type: 'notification-click', url: url });
                    return;
                }
            }
            return self.clients.openWindow(url);
        })
    );
});

// ── Background sync (reconnect on network restore) ──
self.addEventListener('sync', function(e) {
    if (e.tag === 'mgv-reconnect') {
        self.clients.matchAll().then(function(clients) {
            clients.forEach(function(c) { c.postMessage({ type: 'bg-sync' }); });
        });
    }
});