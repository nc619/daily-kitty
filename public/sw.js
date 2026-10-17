// Service worker: notifications, and an offline copy of the app so it opens instantly
// even while the free server is waking up.
const CACHE = 'kitty-v5';
const SHELL = ['/', '/style.css', '/app.js', '/manifest.webmanifest', '/icon-192.png', '/badge-96.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/dl/')) return;

  // Uploaded photos and drawings never change: cache first. Videos stream from the network.
  if (url.pathname.startsWith('/media/') || url.pathname.startsWith('/img/')) {
    if (url.searchParams.has('dl')) return;
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const type = res.headers.get('content-type') || '';
        if (res.ok && res.status === 200 && type.startsWith('image/')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // App files: answer from the cache straight away, refresh it in the background.
  const key = req.mode === 'navigate' ? '/' : req;
  event.respondWith(
    caches.match(key).then((hit) => {
      const fresh = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      });
      if (hit) {
        event.waitUntil(fresh.catch(() => {}));
        return hit;
      }
      return fresh;
    })
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Daily Kitty 🐾';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    timestamp: Date.now(),
    data: { url: data.url || '/' },
  };
  if (data.image) options.image = data.image;
  if (data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  if (data.type === 'gift') options.requireInteraction = true;
  const notifyClients = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((list) => list.forEach((c) => c.postMessage({ type: 'refresh' })));
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options).catch(() => self.registration.showNotification(title, { body: options.body })),
    notifyClients,
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.postMessage({ type: 'open', url });
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
