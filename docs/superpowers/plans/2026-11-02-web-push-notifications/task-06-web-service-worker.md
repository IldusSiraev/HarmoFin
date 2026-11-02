# Задача 6: веб — service worker и помощники push

Перед началом: прочитать [README](README.md). Задачи 1–5 закоммичены.

**Files:**
- Modify: `apps/web/public/sw.js` — обработчики `push` и `notificationclick`.
- Create: `apps/web/app/pwa/sw-push.test.ts`
- Create: `apps/web/app/pwa/push.ts`, `apps/web/app/pwa/push.test.ts`
- Modify: `apps/web/app/composables/useAuth.ts` — снятие подписки браузера при выходе.
- Create: `apps/web/app/composables/useAuth.logout.test.ts`

**Interfaces:**
- Consumes (задача 5, по контракту): payload push — JSON `{ title: string, body: string, path: string, tag: string }`.
- Consumes (существующее): `public/sw.js` из плана PWA (кэш `harmofin-shell-v1`, офлайн-страница); `useAuth().logout()`; иконка `/icons/icon-192.png`.
- Produces (использует задача 7), всё из `apps/web/app/pwa/push.ts`:
  - `type PushSupport = 'supported' | 'ios-install-required' | 'unsupported'`
  - `type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } }`
  - `class PushPermissionError extends Error { readonly permission: NotificationPermission }`
  - `pushSupport(env?): PushSupport`
  - `notificationPermission(env?): NotificationPermission | null`
  - `currentPushSubscription(env?): Promise<PushSubscription | null>`
  - `subscribeThisDevice(vapidPublicKey: string, env?): Promise<PushSubscriptionInput>`
  - `unsubscribeThisDevice(env?): Promise<void>`
  - `urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer>`

---

- [ ] **Step 1: Тест обработчиков service worker (падает)**

Файл `apps/web/app/pwa/sw-push.test.ts`:

```ts
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
      await dispatch('push', pushOf(() => ({ title: 'T', body: 'B', path: foreign })));

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

    await dispatch('notificationclick', { notification: { close: vi.fn(), data: { path: '/app' } } });

    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/app`);
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pwa/sw-push.test.ts`
Expected: FAIL (`listeners.push` не определён).

- [ ] **Step 2: Обработчики в `sw.js`**

В `apps/web/public/sw.js`:

1. Заменить первые строки комментария

```js
// HarmoFin service worker: exists only to make the app installable and to show
// an offline page when a page navigation fails. It deliberately caches nothing
```

на

```js
// HarmoFin service worker: makes the app installable, shows an offline page when
// a page navigation fails and shows push notifications. It deliberately caches nothing
```

2. Строку `/* global self, caches -- service worker scope */` оставить как есть.

3. В конец файла добавить:

```js
const DEFAULT_PUSH_PATH = '/app/notifications';

// Only in-app paths are opened: an absolute or protocol-relative URL from a payload never is.
function pushPath(value) {
  return typeof value === 'string' && /^\/app(?:[/?#]|$)/.test(value) ? value : DEFAULT_PUSH_PATH;
}

// Push payload: { title, body, path, tag } without amounts. A notification must always be shown
// (userVisibleOnly), so a broken payload still shows a generic one.
self.addEventListener('push', (event) => {
  let data = null;
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
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pwa/sw-push.test.ts app/pwa/sw.test.ts`
Expected: PASS (новые тесты и прежние тесты кэша и офлайн-страницы).

Примечание: в тесте с `matchAll` первая вкладка с чужим origin пропускается, вторая — наша.

- [ ] **Step 3: Тест помощников браузера (падает)**

Файл `apps/web/app/pwa/push.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import {
  PushPermissionError,
  currentPushSubscription,
  pushSupport,
  subscribeThisDevice,
  unsubscribeThisDevice,
  urlBase64ToUint8Array,
} from './push.js';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15';
const keyBytes = new Uint8Array([4, ...new Array<number>(64).fill(7)]);
const vapidKey = Buffer.from(keyBytes).toString('base64url');
const json = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  expirationTime: null,
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

function fakeSubscription(key: Uint8Array | null) {
  return {
    options: { applicationServerKey: key ? key.slice().buffer : null },
    toJSON: () => json,
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

function fakeEnv(
  options: {
    userAgent?: string;
    push?: boolean;
    standalone?: boolean;
    permission?: NotificationPermission;
    existing?: ReturnType<typeof fakeSubscription> | null;
    registered?: boolean;
  } = {},
) {
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(options.existing ?? null),
    subscribe: vi.fn().mockResolvedValue(fakeSubscription(keyBytes)),
  };
  const notification = {
    permission: 'default',
    requestPermission: vi.fn().mockResolvedValue(options.permission ?? 'granted'),
  };
  const window = {
    matchMedia: () => ({ matches: options.standalone === true }),
    ...(options.push === false ? {} : { PushManager: function PushManager() {}, Notification: notification }),
  };
  const navigator = {
    userAgent: options.userAgent ?? ANDROID,
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    serviceWorker: {
      getRegistration: vi
        .fn()
        .mockResolvedValue(options.registered === false ? undefined : { pushManager }),
    },
  };
  return { env: { window, navigator } as never, pushManager, notification };
}

describe('pushSupport', () => {
  it('is supported with service worker, PushManager and Notification', () => {
    expect(pushSupport(fakeEnv().env)).toBe('supported');
  });

  it('asks iPhone users to install the app first', () => {
    expect(pushSupport(fakeEnv({ userAgent: IPHONE, push: false }).env)).toBe(
      'ios-install-required',
    );
  });

  it('is unsupported in an installed iPhone app without push and on old browsers', () => {
    expect(pushSupport(fakeEnv({ userAgent: IPHONE, push: false, standalone: true }).env)).toBe(
      'unsupported',
    );
    expect(pushSupport(fakeEnv({ push: false }).env)).toBe('unsupported');
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes a base64url key', () => {
    expect(Array.from(urlBase64ToUint8Array(vapidKey))).toEqual(Array.from(keyBytes));
  });
});

describe('subscribeThisDevice', () => {
  it('asks for permission and subscribes with the server key', async () => {
    const { env, pushManager } = fakeEnv();
    await expect(subscribeThisDevice(vapidKey, env)).resolves.toEqual({
      endpoint: json.endpoint,
      keys: json.keys,
    });
    const call = pushManager.subscribe.mock.calls[0]![0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(call.userVisibleOnly).toBe(true);
    expect(Array.from(call.applicationServerKey)).toEqual(Array.from(keyBytes));
  });

  it('throws a permission error when the user declines', async () => {
    const { env, pushManager } = fakeEnv({ permission: 'denied' });
    const error = await subscribeThisDevice(vapidKey, env).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PushPermissionError);
    expect((error as PushPermissionError).permission).toBe('denied');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('reuses a subscription made with the same key', async () => {
    const existing = fakeSubscription(keyBytes);
    const { env, pushManager } = fakeEnv({ existing });
    await subscribeThisDevice(vapidKey, env);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(existing.unsubscribe).not.toHaveBeenCalled();
  });

  it('replaces a subscription made with another key', async () => {
    const existing = fakeSubscription(new Uint8Array([4, ...new Array<number>(64).fill(1)]));
    const { env, pushManager } = fakeEnv({ existing });
    await subscribeThisDevice(vapidKey, env);
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalled();
  });

  it('fails without a registered service worker', async () => {
    await expect(subscribeThisDevice(vapidKey, fakeEnv({ registered: false }).env)).rejects.toThrow(
      /Service worker/,
    );
  });
});

describe('this device subscription', () => {
  it('reads and drops the browser subscription', async () => {
    const existing = fakeSubscription(keyBytes);
    const { env } = fakeEnv({ existing });
    expect(await currentPushSubscription(env)).toBe(existing);
    await unsubscribeThisDevice(env);
    expect(existing.unsubscribe).toHaveBeenCalled();
  });

  it('never throws while dropping', async () => {
    const existing = fakeSubscription(keyBytes);
    existing.unsubscribe.mockRejectedValue(new Error('gone'));
    await expect(unsubscribeThisDevice(fakeEnv({ existing }).env)).resolves.toBeUndefined();
    await expect(unsubscribeThisDevice(fakeEnv({ registered: false }).env)).resolves.toBeUndefined();
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pwa/push.test.ts`
Expected: FAIL (`Cannot find module './push.js'`).

- [ ] **Step 4: Помощники браузера**

Файл `apps/web/app/pwa/push.ts`:

```ts
// Browser side of web push: support detection (iPhone and iPad need the installed app), subscribing
// with the server's public VAPID key and dropping this browser's subscription. The service worker is
// registered only in production builds, so without it subscribing fails with a clear error.

export type PushSupport = 'supported' | 'ios-install-required' | 'unsupported';

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

export class PushPermissionError extends Error {
  constructor(readonly permission: NotificationPermission) {
    super(`Notification permission: ${permission}`);
    this.name = 'PushPermissionError';
  }
}

type PushEnvironment = { window: Window & typeof globalThis; navigator: Navigator };

function browserEnvironment(): PushEnvironment | null {
  return typeof window === 'undefined' ? null : { window, navigator };
}

function isAppleMobile(navigator: Navigator): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(env: PushEnvironment): boolean {
  const standalone = (env.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || env.window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export function pushSupport(env = browserEnvironment()): PushSupport {
  if (!env) return 'unsupported';
  if ('serviceWorker' in env.navigator && 'PushManager' in env.window && 'Notification' in env.window) {
    return 'supported';
  }
  if (isAppleMobile(env.navigator) && !isStandalone(env)) return 'ios-install-required';
  return 'unsupported';
}

export function notificationPermission(env = browserEnvironment()): NotificationPermission | null {
  return env && 'Notification' in env.window ? env.window.Notification.permission : null;
}

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

async function registration(env: PushEnvironment): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in env.navigator)) return undefined;
  return env.navigator.serviceWorker.getRegistration('/');
}

export async function currentPushSubscription(
  env = browserEnvironment(),
): Promise<PushSubscription | null> {
  if (!env) return null;
  try {
    const active = await registration(env);
    return active ? await active.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}

/** Must run from a click: browsers ask for the notification permission only on a user gesture. */
export async function subscribeThisDevice(
  vapidPublicKey: string,
  env = browserEnvironment(),
): Promise<PushSubscriptionInput> {
  if (!env) throw new Error('Push is available only in the browser');
  const permission = await env.window.Notification.requestPermission();
  if (permission !== 'granted') throw new PushPermissionError(permission);
  const active = await registration(env);
  if (!active) throw new Error('Service worker is not registered');
  const key = urlBase64ToUint8Array(vapidPublicKey);
  const existing = await active.pushManager.getSubscription();
  if (existing && !sameKey(existing, key)) await existing.unsubscribe();
  const subscription =
    existing && sameKey(existing, key)
      ? existing
      : await active.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) throw new Error('Incomplete push subscription');
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

/** Best effort: the server stops pushing to a signed-out session anyway. */
export async function unsubscribeThisDevice(env = browserEnvironment()): Promise<void> {
  try {
    const subscription = await currentPushSubscription(env);
    await subscription?.unsubscribe();
  } catch {
    // Nothing to do: the subscription dies with the session on the server.
  }
}
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pwa/push.test.ts`
Expected: PASS.

Если `pnpm --filter @harmofin/web typecheck` ругается на `Uint8Array<ArrayBuffer>` (старая версия TypeScript), заменить тип возврата на `Uint8Array` и записать это в «Ход выполнения».

- [ ] **Step 5: Тест выхода (падает)**

Файл `apps/web/app/composables/useAuth.logout.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  requestBlob: vi.fn(),
  reloadNuxtApp: vi.fn(),
  order: [] as string[],
  unsubscribeThisDevice: vi.fn(),
}));

vi.mock('./useApiClient.js', async () => {
  const actual = await vi.importActual<typeof import('./useApiClient.js')>('./useApiClient.js');
  return { ...actual, useApiClient: () => mocks };
});

vi.mock('#imports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#imports')>();
  return { ...actual, reloadNuxtApp: mocks.reloadNuxtApp };
});

vi.mock('../pwa/push.js', () => ({ unsubscribeThisDevice: mocks.unsubscribeThisDevice }));

import { useAuth } from './useAuth.js';

describe('useAuth logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    mocks.unsubscribeThisDevice.mockImplementation(async () => {
      mocks.order.push('unsubscribe');
    });
    mocks.request.mockImplementation(async () => {
      mocks.order.push('logout');
      return undefined;
    });
  });

  it('drops the browser push subscription before signing out', async () => {
    await useAuth().logout();
    expect(mocks.order).toEqual(['unsubscribe', 'logout']);
    expect(mocks.request).toHaveBeenCalledWith('/api/v1/auth/logout', { method: 'POST' });
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/composables/useAuth.logout.test.ts`
Expected: FAIL (`order` равен `['logout']`).

- [ ] **Step 6: Выход**

В `apps/web/app/composables/useAuth.ts`:

1. После строки `import { ApiRequestError, useApiClient } from './useApiClient.js';` добавить:

```ts
import { unsubscribeThisDevice } from '../pwa/push.js';
```

2. Заменить функцию

```ts
  async function logout(): Promise<void> {
    await api.request('/api/v1/auth/logout', { method: 'POST' });
```

на

```ts
  async function logout(): Promise<void> {
    // Pushes stop with the session on the server anyway; this also clears the browser side.
    await unsubscribeThisDevice();
    await api.request('/api/v1/auth/logout', { method: 'POST' });
```

(остальные строки функции не менять).

Run: `pnpm --filter @harmofin/web exec vitest run app/composables/useAuth.logout.test.ts app/composables/useAuth.test.ts`
Expected: PASS.

- [ ] **Step 7: Прогнать проверки**

Run: `pnpm --filter @harmofin/web test`
Expected: PASS.

Run: `pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: PASS, 0 errors.

Run: `pnpm exec prettier --write apps/web/public/sw.js apps/web/app/pwa apps/web/app/composables/useAuth.ts apps/web/app/composables/useAuth.logout.test.ts`
Если prettier что-то поменял, повторить `pnpm --filter @harmofin/web test`.

- [ ] **Step 8: Review по чек-листу**

```bash
git add apps/web/public/sw.js apps/web/app/pwa apps/web/app/composables/useAuth.ts apps/web/app/composables/useAuth.logout.test.ts
git diff --staged
```

Чек-лист:

- security:
  - `notificationclick` открывает только пути `/app…` своего origin, а пути из payload вида `https://…`, `//…`, `javascript:` отбрасываются;
  - service worker по-прежнему не кэширует ничего, кроме `/offline.html`;
  - ключ VAPID приходит параметром, а не из бандла;
  - в `localStorage` ничего не пишется.
- UI/UX: уведомление на русском (`lang: 'ru'`) с иконкой приложения; повтор с тем же `tag` не даёт второго сигнала.
- QA: тесты покрывают payload, пустой и битый payload, чужие пути, фокус и навигацию, запасное новое окно, поддержку iOS, смену ключа, отказ в разрешении и порядок выхода.
- final: только файлы из списка Files.

- [ ] **Step 9: Commit**

```bash
git branch --show-current
git commit -m "feat(web): push в service worker и подписка устройства"
```

Строку в «Ход выполнения» — как в README.
