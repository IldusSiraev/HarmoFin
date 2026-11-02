import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendNotification = vi.hoisted(() => vi.fn());
vi.mock('web-push', () => ({ default: { sendNotification } }));

import { retryAfterSeconds, WebPushTransport } from './web-push-transport.js';

const vapid = {
  publicKey: 'public-key',
  privateKey: 'private-key',
  subject: 'mailto:admin@harmofin.example',
};
const target = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/x',
  keys: { p256dh: 'p', auth: 'a' },
};
const options = { ttlSeconds: 43_200, topic: 'topic' };

describe('WebPushTransport', () => {
  beforeEach(() => {
    sendNotification.mockReset();
  });

  it('sends with VAPID, TTL, urgency, topic and a timeout', async () => {
    sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    await expect(new WebPushTransport(vapid).send(target, '{}', options)).resolves.toEqual({
      status: 201,
      retryAfterSeconds: null,
    });
    expect(sendNotification).toHaveBeenCalledWith(target, '{}', {
      vapidDetails: {
        subject: 'mailto:admin@harmofin.example',
        publicKey: 'public-key',
        privateKey: 'private-key',
      },
      TTL: 43_200,
      urgency: 'high',
      topic: 'topic',
      timeout: 10_000,
    });
  });

  it('turns a push service error into its status and Retry-After', async () => {
    sendNotification.mockRejectedValue(
      Object.assign(new Error('Received unexpected response code'), {
        statusCode: 429,
        headers: { 'retry-after': '30' },
        body: '',
      }),
    );
    await expect(new WebPushTransport(vapid).send(target, '{}', options)).resolves.toEqual({
      status: 429,
      retryAfterSeconds: 30,
    });
  });

  it('reports a network failure without the endpoint or keys', async () => {
    sendNotification.mockRejectedValue(new Error(`connect ECONNREFUSED ${target.endpoint}`));
    const error = await new WebPushTransport(vapid).send(target, '{}', options).catch((e) => e);
    expect(error).toMatchObject({ code: 'PUSH_NETWORK' });
    expect(String(error.message)).not.toContain('fcm.googleapis.com');
  });
});

describe('retryAfterSeconds', () => {
  it('reads seconds and HTTP dates', () => {
    const now = Date.parse('2026-11-02T09:00:00.000Z');
    expect(retryAfterSeconds('120', now)).toBe(120);
    expect(retryAfterSeconds('Mon, 02 Nov 2026 09:01:00 GMT', now)).toBe(60);
    expect(retryAfterSeconds(undefined, now)).toBeNull();
    expect(retryAfterSeconds('soon', now)).toBeNull();
  });
});
