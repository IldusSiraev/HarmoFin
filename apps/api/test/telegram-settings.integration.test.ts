import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
const path = '/api/v1/me/notification-settings/telegram';
const body = {
  enabled: true,
  urgentEnabled: true,
  digestFrequency: 'WEEKLY',
  includeAmounts: false,
};
let anna: FamilyActor;
let boris: FamilyActor;

beforeAll(async () => {
  await env.start({
    TELEGRAM_BOT_TOKEN: '123456:integration-test-token',
    TELEGRAM_BOT_USERNAME: 'harmofin_test_bot',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-with-at-least-32-chars_',
    TELEGRAM_API_BASE_URL: 'https://telegram.invalid',
  });
  anna = await env.register();
  boris = await env.register();
});

afterAll(async () => {
  await env.stop();
});

describe('telegram notification settings', () => {
  it('returns defaults with the bot available and no link', async () => {
    const response = await env.inject('GET', path, anna);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      available: true,
      linked: false,
      enabled: false,
      urgentEnabled: true,
      digestFrequency: 'DAILY',
      includeAmounts: false,
      amountsConsentAt: null,
    });
  });

  it('refuses to enable the channel without a linked chat', async () => {
    const response = await env.inject('PUT', path, anna, body);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'TELEGRAM_NOT_LINKED' });
  });

  it('requires CSRF', async () => {
    const response = await env.server.inject({
      method: 'PUT',
      url: path,
      headers: { origin: 'http://localhost:3000' },
      cookies: { harmofin_session: anna.cookie },
      payload: body,
    });
    expect(response.statusCode).toBe(403);
  });

  it('saves settings with a linked chat and keeps a separate amounts consent', async () => {
    const now = new Date();
    await env.prisma.telegramLink.create({
      data: {
        id: randomUUID(),
        userId: anna.user.id,
        chatId: BigInt(1_000_000 + Math.floor(Math.random() * 1_000_000_000)),
        consentedAt: now,
        linkedAt: now,
      },
    });
    const saved = await env.inject('PUT', path, anna, body);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ linked: true, enabled: true, digestFrequency: 'WEEKLY' });

    const noConsent = await env.inject('PUT', path, anna, { ...body, includeAmounts: true });
    expect(noConsent.statusCode).toBe(422);
    expect(noConsent.json()).toMatchObject({ code: 'AMOUNTS_CONSENT_REQUIRED' });

    const consent = await env.inject('PUT', path, anna, {
      ...body,
      includeAmounts: true,
      amountsConsent: true,
    });
    expect(consent.statusCode).toBe(200);
    expect(consent.json().amountsConsentAt).not.toBeNull();

    const audit = await env.prisma.auditEvent.findFirst({
      where: { actorUserId: anna.user.id, action: 'AMOUNTS_CONSENT_GRANTED' },
    });
    expect(audit?.newValues).toEqual({ channel: 'TELEGRAM' });
  });

  it('does not touch the email channel', async () => {
    const email = await env.inject('GET', '/api/v1/me/notification-settings/email', anna);
    expect(email.json()).toMatchObject({ enabled: false, includeAmounts: false });
  });

  it('keeps settings per user', async () => {
    expect((await env.inject('GET', path, boris)).json()).toMatchObject({
      linked: false,
      enabled: false,
    });
  });
});
