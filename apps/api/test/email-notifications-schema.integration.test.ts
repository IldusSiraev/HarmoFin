import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let other: FamilyActor;

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  other = await env.register();
});

afterAll(async () => {
  await env.stop();
});

function delivery(actor: FamilyActor, overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    workspaceId: actor.workspaceId,
    budgetId: actor.budgetId,
    userId: actor.user.id,
    channel: 'EMAIL' as const,
    kind: 'DIGEST' as const,
    dedupeKey: `digest:DAILY:${randomUUID()}`,
    nextAttemptAt: new Date(),
    ...overrides,
  };
}

describe('notification_channel_settings', () => {
  it('has safe defaults and one row per user and channel', async () => {
    const row = await env.prisma.notificationChannelSetting.create({
      data: { id: randomUUID(), userId: creator.user.id, channel: 'EMAIL' },
    });
    expect(row).toMatchObject({
      enabled: false,
      urgentEnabled: true,
      digestFrequency: 'DAILY',
      includeAmounts: false,
      amountsConsentAt: null,
    });
    await expect(
      env.prisma.notificationChannelSetting.create({
        data: { id: randomUUID(), userId: creator.user.id, channel: 'EMAIL' },
      }),
    ).rejects.toThrow();
  });
});

describe('notification_deliveries', () => {
  it('rejects a duplicate dedupe key for the same budget, user and channel', async () => {
    const first = delivery(creator);
    await env.prisma.notificationDelivery.create({ data: first });
    await expect(
      env.prisma.notificationDelivery.create({
        data: delivery(creator, { dedupeKey: first.dedupeKey }),
      }),
    ).rejects.toThrow();
  });

  it('defaults to PENDING with zero attempts', async () => {
    const row = await env.prisma.notificationDelivery.create({ data: delivery(creator) });
    expect(row).toMatchObject({ status: 'PENDING', attempts: 0, unsubscribeTokenHash: null });
  });

  it('rejects a budget that belongs to another workspace', async () => {
    await expect(
      env.prisma.notificationDelivery.create({
        data: delivery(creator, { budgetId: other.budgetId }),
      }),
    ).rejects.toThrow();
  });
});

describe('email_verification_tokens', () => {
  it('stores a unique token hash', async () => {
    const tokenHash = 'a'.repeat(64);
    await env.prisma.emailVerificationToken.create({
      data: {
        id: randomUUID(),
        userId: creator.user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expect(
      env.prisma.emailVerificationToken.create({
        data: {
          id: randomUUID(),
          userId: other.user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow();
  });
});
