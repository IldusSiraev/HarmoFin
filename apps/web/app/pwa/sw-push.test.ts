import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');
const ORIGIN = 'https://harmofin.example';

type Listener = (event: Record<string, unknown>) => void;

let listeners: Record<string, Listener>;
let waited: Promise<unknown>[];
let showNotification: ReturnType<typeof vi.fn>;
let matchAll: ReturnType<typeof vi.fn>;
let openWindow: ReturnType<typeof vi.fn>;

beforeEach(() => {
  listeners = {};
  waited = [];
  showNotification = vi.fn().mockResolvedValue(undefined);
  matchAll = vi.fn().mockResolvedValue([]);
  openWindow = vi.fn().mockResolvedValue(null);
  const self = {
    location: { origin: ORIGIN },
    registration: { showNotification },
    clients: { matchAll, openWindow, claim: vi.fn() },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = listener;
    },
  };
  new Function('self', 'caches', 'fetch', 'Response', source)(self, {}, vi.fn(), {});
});

async function dispatch(type: string, extra: Record<string, unknown>) {
  listeners[type]!({
    ...extra,
    waitUntil: (promise: Promise<unknown>) => {
      waited.push(promise);
    },
  });
  await Promise.all(waited);
}

const pushOf = (json: () => unknown) => ({ data: { json } });

describe('service worker push', () => {
  it('shows the notification from the payload', async () => {
    await dispatch(
      'push',
      pushOf(() => ({
        title: 'Просрочен платёж «Ипотека»',
        body: 'План «Ипотека» просрочен с 2026-10-25.',
        path: '/app/plans?occurrence=1',
        tag: 'notification:1',
      })),
    );

    expect(showNotification).toHaveBeenCalledWith('Просрочен платёж «Ипотека»', {
      body: 'План «Ипотека» просрочен с 2026-10-25.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      lang: 'ru',
      tag: 'notification:1',
      data: { path: '/app/plans?occurrence=1' },
    });
  });

  it.each([
    ['an empty push', { data: null }],
    [
      'a broken payload',
      pushOf(() => {
        throw new SyntaxError('bad json');
      }),
    ],
    ['a null payload', pushOf(() => null)],
  ])('still shows a generic notification for %s', async (_label, event) => {
    await dispatch('push', event);

    expect(showNotification).toHaveBeenCalledWith(
      'HarmoFin',
      expect.objectContaining({ body: '', data: { path: '/app/notifications' } }),
    );
  });

  it.each(['https://evil.example/app', '//evil.example/app', '/apples', 'javascript:alert(1)'])(
    'never keeps the foreign path %s',
    async (foreign) => {
      await dispatch(
        'push',
        pushOf(() => ({ title: 'T', body: 'B', path: foreign })),
      );

      expect(showNotification).toHaveBeenCalledWith(
        'T',
        expect.objectContaining({ data: { path: '/app/notifications' } }),
      );
    },
  );
});

describe('service worker notification click', () => {
  it('focuses an open window of the app and navigates it', async () => {
    const client = {
      url: `${ORIGIN}/app`,
      focus: vi.fn(),
      navigate: vi.fn().mockResolvedValue(undefined),
    };
    client.focus.mockResolvedValue(client);
    matchAll.mockResolvedValue([{ url: 'https://elsewhere.example/', focus: vi.fn() }, client]);
    const notification = { close: vi.fn(), data: { path: '/app/plans' } };

    await dispatch('notificationclick', { notification });

    expect(notification.close).toHaveBeenCalled();
    expect(matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
    expect(client.navigate).toHaveBeenCalledWith(`${ORIGIN}/app/plans`);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('opens a new window when the app is not open', async () => {
    await dispatch('notificationclick', {
      notification: { close: vi.fn(), data: { path: 'https://evil.example/' } },
    });

    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/app/notifications`);
  });

  it('opens a new window when navigating the open one fails', async () => {
    const client = {
      url: `${ORIGIN}/app`,
      focus: vi.fn(),
      navigate: vi.fn().mockRejectedValue(new TypeError('not controlled')),
    };
    client.focus.mockResolvedValue(client);
    matchAll.mockResolvedValue([client]);

    await dispatch('notificationclick', {
      notification: { close: vi.fn(), data: { path: '/app' } },
    });

    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/app`);
  });
});
