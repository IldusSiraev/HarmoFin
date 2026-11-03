import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
const settingsPath = '/api/v1/me/notification-settings/telegram';
const commandsPath = `${settingsPath}/commands`;
let anna: FamilyActor;
let boris: FamilyActor;
let annaChat: bigint;

beforeAll(async () => {
  await env.start({
    TELEGRAM_BOT_TOKEN: '123456:integration-test-token',
    TELEGRAM_BOT_USERNAME: 'harmofin_test_bot',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-with-at-least-32-chars_',
    TELEGRAM_API_BASE_URL: 'https://telegram.invalid',
  });
  anna = await env.register();
  boris = await env.register();
  const now = new Date();
  annaChat = BigInt(1_000_000 + Math.floor(Math.random() * 1_000_000_000));
  await env.prisma.telegramLink.create({
    data: {
      id: randomUUID(),
      userId: anna.user.id,
      chatId: annaChat,
      consentedAt: now,
      linkedAt: now,
    },
  });
});

afterAll(async () => {
  await env.stop();
});

const linkOf = () => env.prisma.telegramLink.findUniqueOrThrow({ where: { chatId: annaChat } });

describe('PUT /api/v1/me/notification-settings/telegram/commands', () => {
  it('starts with commands off', async () => {
    const response = await env.inject('GET', settingsPath, anna);
    expect(response.json()).toMatchObject({ linked: true, commandsEnabled: false });
  });

  it('refuses without a linked chat', async () => {
    const response = await env.inject('PUT', commandsPath, boris, { enabled: true, consent: true });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'TELEGRAM_NOT_LINKED' });
  });

  it('requires consent to switch commands on', async () => {
    const response = await env.inject('PUT', commandsPath, anna, { enabled: true });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'TELEGRAM_COMMANDS_CONSENT_REQUIRED' });
    expect((await linkOf()).commandsEnabledAt).toBeNull();
  });

  it('rejects unknown fields', async () => {
    const response = await env.inject('PUT', commandsPath, anna, { enabled: true, extra: 1 });
    expect(response.statusCode).toBe(400);
  });

  it('requires CSRF', async () => {
    const response = await env.server.inject({
      method: 'PUT',
      url: commandsPath,
      headers: { origin: 'http://localhost:3000' },
      cookies: { harmofin_session: anna.cookie },
      payload: { enabled: true, consent: true },
    });
    expect(response.statusCode).toBe(403);
  });

  it('switches commands on with consent and audits it without the chat id', async () => {
    const response = await env.inject('PUT', commandsPath, anna, { enabled: true, consent: true });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ linked: true, commandsEnabled: true });
    const link = await linkOf();
    expect(link.commandsEnabledAt).not.toBeNull();
    expect(link.commandsConsentAt).toEqual(link.commandsEnabledAt);
    const audit = await env.prisma.auditEvent.findFirstOrThrow({
      where: { actorUserId: anna.user.id, action: 'TELEGRAM_COMMANDS_ENABLED' },
    });
    expect(audit.entityId).toBe(link.id);
    expect(JSON.stringify(audit)).not.toContain(annaChat.toString());
  });

  it('switches commands off and ends the open dialog', async () => {
    await env.prisma.telegramDialog.create({
      data: {
        id: randomUUID(),
        chatId: annaChat,
        userId: anna.user.id,
        budgetId: anna.budgetId,
        kind: 'EXPENSE',
        step: 'amount',
        expiresAt: new Date(Date.now() + 1_800_000),
      },
    });
    const response = await env.inject('PUT', commandsPath, anna, { enabled: false });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ commandsEnabled: false });
    const link = await linkOf();
    expect(link.commandsEnabledAt).toBeNull();
    expect(link.commandsConsentAt).toBeNull();
    expect(await env.prisma.telegramDialog.findUnique({ where: { chatId: annaChat } })).toBeNull();
  });
});
