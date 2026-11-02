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
  if (
    'serviceWorker' in env.navigator &&
    'PushManager' in env.window &&
    'Notification' in env.window
  ) {
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
