import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
const origin = 'http://localhost:3000';
const path = '/api/v1/me/notification-settings/email';
let anna: FamilyActor;
let boris: FamilyActor;

const body = {
  enabled: true,
  urgentEnabled: true,
  digestFrequency: 'WEEKLY',
  includeAmounts: false,
};

beforeAll(async () => {
  await env.start();
  anna = await env.register();
  boris = await env.register();
});

afterAll(async () => {
  await env.stop();
});

describe('email notification settings', () => {
  it('returns defaults and a masked address', async () => {
    const response = await env.inject('GET', path, anna);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      emailVerified: false,
      enabled: false,
      urgentEnabled: true,
      digestFrequency: 'DAILY',
      includeAmounts: false,
      amountsConsentAt: null,
    });
    expect(response.json().email).toMatch(/^f\*\*\*@harmofin\.test$/);
  });

  it('refuses to enable before the address is verified', async () => {
    const response = await env.inject('PUT', path, anna, body);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('requires CSRF', async () => {
    const response = await env.server.inject({
      method: 'PUT',
      url: path,
      headers: { origin },
      cookies: { harmofin_session: anna.cookie },
      payload: body,
    });
    expect(response.statusCode).toBe(403);
  });

  it('saves settings once verified and asks for consent before amounts', async () => {
    await env.prisma.user.update({
      where: { id: anna.user.id },
      data: { emailVerifiedAt: new Date() },
    });
    const saved = await env.inject('PUT', path, anna, body);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ enabled: true, digestFrequency: 'WEEKLY' });

    const noConsent = await env.inject('PUT', path, anna, { ...body, includeAmounts: true });
    expect(noConsent.statusCode).toBe(422);
    expect(noConsent.json().fieldErrors[0].field).toBe('includeAmounts');

    const consent = await env.inject('PUT', path, anna, {
      ...body,
      includeAmounts: true,
      amountsConsent: true,
    });
    expect(consent.statusCode).toBe(200);
    expect(consent.json().amountsConsentAt).not.toBeNull();
  });

  it('keeps settings per user', async () => {
    expect((await env.inject('GET', path, boris)).json().enabled).toBe(false);
  });

  it('unsubscribes by a token from a letter and answers 204 to unknown tokens', async () => {
    const raw = `token-${randomUUID()}`;
    await env.prisma.notificationDelivery.create({
      data: {
        id: randomUUID(),
        workspaceId: anna.workspaceId,
        budgetId: anna.budgetId,
        userId: anna.user.id,
        channel: 'EMAIL',
        kind: 'DIGEST',
        dedupeKey: `digest:DAILY:${randomUUID()}`,
        nextAttemptAt: new Date(),
        status: 'SENT',
        unsubscribeTokenHash: createHash('sha256').update(raw).digest('hex'),
      },
    });
    const post = (token: string) =>
      env.server.inject({
        method: 'POST',
        url: '/api/v1/notifications/unsubscribe',
        headers: { origin },
        payload: { token },
      });

    expect((await post('unknown-token')).statusCode).toBe(204);
    expect((await env.inject('GET', path, anna)).json().enabled).toBe(true);

    expect((await post(raw)).statusCode).toBe(204);
    expect((await env.inject('GET', path, anna)).json().enabled).toBe(false);

    const audits = await env.prisma.auditEvent.findMany({
      where: { actorUserId: anna.user.id, entityType: 'notification_settings' },
    });
    expect(audits.map((item) => item.action)).toEqual(
      expect.arrayContaining(['UPDATED', 'AMOUNTS_CONSENT_GRANTED', 'UNSUBSCRIBED']),
    );
    expect(JSON.stringify(audits)).not.toContain(anna.user.email);
  });

  it('rejects an unsubscribe without the web origin', async () => {
    const response = await env.server.inject({
      method: 'POST',
      url: '/api/v1/notifications/unsubscribe',
      payload: { token: 'any' },
    });
    expect(response.statusCode).toBe(403);
  });
});
