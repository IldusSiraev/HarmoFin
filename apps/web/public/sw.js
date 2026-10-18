// HarmoFin service worker: exists only to make the app installable and to show
// an offline page when a page navigation fails. It deliberately caches nothing
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
