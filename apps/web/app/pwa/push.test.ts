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
    ...(options.push === false
      ? {}
      : { PushManager: function PushManager() {}, Notification: notification }),
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
    await expect(
      unsubscribeThisDevice(fakeEnv({ registered: false }).env),
    ).resolves.toBeUndefined();
  });
});
