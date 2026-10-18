import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');
const ORIGIN = 'https://harmofin.example';

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
  request?: { url: string; method: string; mode: string } | undefined;
  waitUntil: (promise: Promise<unknown>) => void;
  respondWith: (response: Promise<unknown>) => void;
}

interface FakeCache {
  addAll: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

const offlinePage = { body: 'offline' };
let listeners: Record<string, Listener>;
let cache: FakeCache;
let caches: {
  open: ReturnType<typeof vi.fn>;
  keys: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  match: ReturnType<typeof vi.fn>;
};
let fetchMock: ReturnType<typeof vi.fn>;
let worker: { skipWaiting: ReturnType<typeof vi.fn>; clients: { claim: ReturnType<typeof vi.fn> } };

beforeEach(() => {
  listeners = {};
  cache = { addAll: vi.fn().mockResolvedValue(undefined), put: vi.fn() };
  caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue(['harmofin-shell-v0', 'harmofin-shell-v1', 'other-app']),
    delete: vi.fn().mockResolvedValue(true),
    match: vi.fn().mockResolvedValue(offlinePage),
  };
  fetchMock = vi.fn();
  worker = {
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
  };
  const self = {
    ...worker,
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = listener;
    },
  };
  new Function('self', 'caches', 'fetch', 'Response', source)(self, caches, fetchMock, {
    error: () => ({ type: 'error' }),
  });
});

async function dispatch(type: string, request?: FakeEvent['request']) {
  let waited: Promise<unknown> | undefined;
  let response: Promise<unknown> | undefined;
  listeners[type]?.({
    request,
    waitUntil: (promise) => {
      waited = promise;
    },
    respondWith: (promise) => {
      response = promise;
    },
  });
  await waited;
  return { responded: response !== undefined, response: await response };
}

function navigation(url: string, overrides: Partial<NonNullable<FakeEvent['request']>> = {}) {
  return { url, method: 'GET', mode: 'navigate', ...overrides };
}

describe('service worker', () => {
  it('precaches only the offline fallback page on install', async () => {
    await dispatch('install');

    expect(caches.open).toHaveBeenCalledWith('harmofin-shell-v1');
    expect(cache.addAll).toHaveBeenCalledWith(['/offline.html']);
    expect(worker.skipWaiting).toHaveBeenCalled();
  });

  it('drops its own outdated caches on activate and leaves foreign ones alone', async () => {
    await dispatch('activate');

    expect(caches.delete).toHaveBeenCalledTimes(1);
    expect(caches.delete).toHaveBeenCalledWith('harmofin-shell-v0');
    expect(worker.clients.claim).toHaveBeenCalled();
  });

  it.each([
    ['API calls', navigation(`${ORIGIN}/api/v1/me`, { mode: 'cors' })],
    ['API navigations', navigation(`${ORIGIN}/api/v1/export`)],
    ['non-GET requests', navigation(`${ORIGIN}/app`, { method: 'POST' })],
    [
      'assets and other non-navigation requests',
      navigation(`${ORIGIN}/_nuxt/app.js`, { mode: 'no-cors' }),
    ],
    ['other origins', navigation('https://elsewhere.example/app')],
  ])('does not intercept %s', async (_label, request) => {
    const { responded } = await dispatch('fetch', request);

    expect(responded).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves page navigations from the network without caching the response', async () => {
    const page = { body: 'dashboard' };
    fetchMock.mockResolvedValue(page);

    const { responded, response } = await dispatch('fetch', navigation(`${ORIGIN}/app`));

    expect(responded).toBe(true);
    expect(response).toBe(page);
    expect(cache.put).not.toHaveBeenCalled();
    expect(caches.open).not.toHaveBeenCalled();
  });

  it('falls back to the cached offline page when the network is unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const { response } = await dispatch('fetch', navigation(`${ORIGIN}/app/operations`));

    expect(caches.match).toHaveBeenCalledWith('/offline.html');
    expect(response).toBe(offlinePage);
  });
});
