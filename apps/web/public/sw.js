// HarmoFin service worker: makes the app installable, shows an offline page when
// a page navigation fails and shows push notifications. It deliberately caches nothing
// else — no API responses, no pages with budget data, no build assets — and
// never queues operations offline (that needs idempotency and server
// confirmation). Bump CACHE_NAME when offline.html changes.
/* global self, caches -- service worker scope */
const CACHE_NAME = 'harmofin-shell-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('harmofin-') && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request).catch(() =>
      caches.match(OFFLINE_URL).then((offline) => offline ?? Response.error()),
    ),
  );
});

const DEFAULT_PUSH_PATH = '/app/notifications';

// Only in-app paths are opened: an absolute or protocol-relative URL from a payload never is.
function pushPath(value) {
  return typeof value === 'string' && /^\/app(?:[/?#]|$)/.test(value) ? value : DEFAULT_PUSH_PATH;
}

// Push payload: { title, body, path, tag } without amounts. A notification must always be shown
// (userVisibleOnly), so a broken payload still shows a generic one.
self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  const payload = data && typeof data === 'object' ? data : {};
  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'HarmoFin';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    lang: 'ru',
    data: { path: pushPath(payload.path) },
  };
  // The same tag replaces a notification already shown (a retried push), without a new alert.
  if (typeof payload.tag === 'string' && payload.tag) options.tag = payload.tag;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  const target = new URL(pushPath(data && data.path), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (!open) return self.clients.openWindow(target);
      return open
        .focus()
        .then((focused) => (focused || open).navigate(target))
        .catch(() => self.clients.openWindow(target));
    }),
  );
});
