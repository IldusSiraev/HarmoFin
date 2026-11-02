import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';
import {
  addSubscription,
  currentSessionId,
  deviceKeys,
  pushEndpoint,
  revokedSessionId,
  vapidPublicKey,
} from './helpers/push.js';

const env = new FamilyTestApp();
const settingsPath = '/api/v1/me/notification-settings/push';
const subscriptionsPath = '/api/v1/me/push/subscriptions';
const allOn = { enabled: true, planOverdueEnabled: true, calendarReminderEnabled: true };
let anna: FamilyActor;
let boris: FamilyActor;

type View = {
  enabled: boolean;
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
  devices: Array<{ id: string; label: string; current: boolean; lastSuccessAt: string | null }>;
};

const subscribe = (actor: FamilyActor, endpoint = pushEndpoint()) =>
  env.inject('POST', subscriptionsPath, actor, { endpoint, keys: deviceKeys });

async function reset(actor: FamilyActor) {
  await env.prisma.pushSubscription.deleteMany({ where: { userId: actor.user.id } });
  await env.prisma.notificationChannelSetting.deleteMany({
    where: { userId: actor.user.id, channel: 'PUSH' },
  });
}

beforeAll(async () => {
  await env.start({ VAPID_PUBLIC_KEY: vapidPublicKey, RATE_LIMIT_LOGIN_MAX: '100' });
  anna = await env.register();
  boris = await env.register();
});

afterAll(async () => {
  await env.stop();
});

beforeEach(async () => {
  await reset(anna);
  await reset(boris);
});

describe('push settings', () => {
  it('returns defaults with the public key and no devices', async () => {
    const response = await env.inject('GET', settingsPath, anna);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      available: true,
      vapidPublicKey,
      enabled: false,
      planOverdueEnabled: true,
      calendarReminderEnabled: true,
      devices: [],
    });
  });

  it('refuses to enable the channel without a device', async () => {
    const response = await env.inject('PUT', settingsPath, anna, allOn);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'PUSH_NO_DEVICES' });
  });

  it('saves the type switches once a device exists', async () => {
    expect((await subscribe(anna)).statusCode).toBe(200);
    const response = await env.inject('PUT', settingsPath, anna, {
      ...allOn,
      planOverdueEnabled: false,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      enabled: true,
      planOverdueEnabled: false,
      calendarReminderEnabled: true,
    });
    const setting = await env.prisma.notificationChannelSetting.findUniqueOrThrow({
      where: { userId_channel: { userId: anna.user.id, channel: 'PUSH' } },
    });
    expect(setting.digestFrequency).toBe('OFF');
    expect(setting.includeAmounts).toBe(false);
  });

  it('hides a device whose session is revoked', async () => {
    await addSubscription(env.prisma, {
      userId: anna.user.id,
      sessionId: await revokedSessionId(env.prisma, anna.user.id),
    });
    const view = (await env.inject('GET', settingsPath, anna)).json<View>();
    expect(view.devices).toEqual([]);
    expect((await env.inject('PUT', settingsPath, anna, allOn)).statusCode).toBe(409);
  });
});

describe('push subscriptions', () => {
  it('stores the device for the current session and switches the channel on', async () => {
    const endpoint = pushEndpoint();
    const response = await subscribe(anna, endpoint);
    expect(response.statusCode).toBe(200);
    const view = response.json<View>();
    expect(view.enabled).toBe(true);
    expect(view.devices).toHaveLength(1);
    expect(view.devices[0]).toMatchObject({ label: 'Браузер', current: true, lastSuccessAt: null });
    expect(JSON.stringify(view)).not.toContain(endpoint);

    const row = await env.prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint } });
    expect(row.sessionId).toBe(await currentSessionId(env.prisma, anna.user.id));
    expect(row.applicationServerKey).toBe(vapidPublicKey);
    const audit = await env.prisma.auditEvent.findFirst({
      where: { actorUserId: anna.user.id, action: 'PUSH_SUBSCRIBED', entityId: row.id },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.newValues ?? null)).not.toContain(endpoint);
  });

  it('updates the same endpoint instead of adding a second device', async () => {
    const endpoint = pushEndpoint();
    await subscribe(anna, endpoint);
    await subscribe(anna, endpoint);
    expect(await env.prisma.pushSubscription.count({ where: { userId: anna.user.id } })).toBe(1);
  });

  it('moves an endpoint to the user who subscribed with it last', async () => {
    const endpoint = pushEndpoint();
    await subscribe(anna, endpoint);
    const response = await subscribe(boris, endpoint);
    expect(response.statusCode).toBe(200);
    const row = await env.prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint } });
    expect(row.userId).toBe(boris.user.id);
    const annaView = (await env.inject('GET', settingsPath, anna)).json<View>();
    expect(annaView.devices).toEqual([]);
    expect(annaView.enabled).toBe(false);
  });

  it('keeps at most 10 devices and drops the oldest', async () => {
    const first = pushEndpoint();
    await subscribe(anna, first);
    // Make the order unambiguous even when two requests land in the same millisecond.
    await env.prisma.pushSubscription.update({
      where: { endpoint: first },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    for (let index = 0; index < 10; index += 1) {
      expect((await subscribe(anna)).statusCode).toBe(200);
    }
    expect(await env.prisma.pushSubscription.count({ where: { userId: anna.user.id } })).toBe(10);
    expect(await env.prisma.pushSubscription.findUnique({ where: { endpoint: first } })).toBeNull();
  });

  it('rejects endpoints outside the push services', async () => {
    for (const endpoint of ['https://evil.example/push', 'http://fcm.googleapis.com/fcm/send/x']) {
      const response = await subscribe(anna, endpoint);
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: 'PUSH_ENDPOINT_NOT_ALLOWED' });
    }
  });

  it('rejects malformed device keys', async () => {
    const response = await env.inject('POST', subscriptionsPath, anna, {
      endpoint: pushEndpoint(),
      keys: { p256dh: 'abc', auth: deviceKeys.auth },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('requires CSRF', async () => {
    const response = await env.server.inject({
      method: 'POST',
      url: subscriptionsPath,
      headers: { origin: 'http://localhost:3000' },
      cookies: { harmofin_session: anna.cookie },
      payload: { endpoint: pushEndpoint(), keys: deviceKeys },
    });
    expect(response.statusCode).toBe(403);
  });

  it('deletes only own devices and switches the channel off with the last one', async () => {
    const view = (await subscribe(anna)).json<View>();
    const deviceId = view.devices[0]!.id;

    expect((await env.inject('DELETE', `${subscriptionsPath}/${deviceId}`, boris)).statusCode).toBe(
      204,
    );
    expect(await env.prisma.pushSubscription.count({ where: { id: deviceId } })).toBe(1);

    expect((await env.inject('DELETE', `${subscriptionsPath}/${deviceId}`, anna)).statusCode).toBe(
      204,
    );
    const after = (await env.inject('GET', settingsPath, anna)).json<View>();
    expect(after.devices).toEqual([]);
    expect(after.enabled).toBe(false);
  });

  it('rejects a malformed device id', async () => {
    const response = await env.inject('DELETE', `${subscriptionsPath}/not-a-uuid`, anna);
    expect(response.statusCode).toBe(400);
  });
});

describe('push without VAPID on the server', () => {
  const bare = new FamilyTestApp();
  let carol: FamilyActor;

  beforeAll(async () => {
    await bare.start();
    carol = await bare.register();
  });

  afterAll(async () => {
    await bare.stop();
  });

  it('reports the channel as unavailable and refuses subscriptions', async () => {
    const view = await bare.inject('GET', settingsPath, carol);
    expect(view.json()).toMatchObject({ available: false, vapidPublicKey: null });
    const response = await bare.inject('POST', subscriptionsPath, carol, {
      endpoint: pushEndpoint(),
      keys: deviceKeys,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'PUSH_UNAVAILABLE' });
  });
});
