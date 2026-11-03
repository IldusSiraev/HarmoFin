import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const SECRET = 'webhook-secret-with-at-least-32-chars_';
const NBSP = '\u00a0';
const sent: Array<{ chatId: string; text: string }> = [];
const fakeFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as { chat_id?: string; text?: string };
  if (body.chat_id && body.text) sent.push({ chatId: body.chat_id, text: body.text });
  return new Response('{"ok":true,"result":{"message_id":1}}', { status: 200 });
});

const env = new FamilyTestApp();
let anna: FamilyActor;
let boris: FamilyActor;
let annaChat: number;
let borisChat: number;

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
}

async function link(actor: FamilyActor): Promise<number> {
  const chatId = 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
  const now = new Date();
  await env.prisma.telegramLink.create({
    data: {
      id: randomUUID(),
      userId: actor.user.id,
      chatId: BigInt(chatId),
      consentedAt: now,
      linkedAt: now,
      commandsEnabledAt: now,
      commandsConsentAt: now,
    },
  });
  return chatId;
}

async function ask(chatId: number, command: string): Promise<string> {
  const response = await env.server.inject({
    method: 'POST',
    url: '/api/v1/telegram/webhook',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    payload: JSON.stringify({
      update_id: Math.floor(Math.random() * 1e9),
      message: { message_id: 1, chat: { id: chatId, type: 'private' }, text: command },
    }),
  });
  expect(response.statusCode).toBe(200);
  const reply = sent.filter((item) => item.chatId === String(chatId)).at(-1);
  if (!reply) throw new Error('no reply');
  return reply.text;
}

function isoPlusDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

beforeAll(async () => {
  vi.stubGlobal('fetch', fakeFetch);
  await env.start({
    TELEGRAM_BOT_TOKEN: '123456:integration-test-token',
    TELEGRAM_BOT_USERNAME: 'harmofin_test_bot',
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    TELEGRAM_API_BASE_URL: 'https://telegram.invalid',
  });
  anna = await env.register();
  boris = await env.register();
  const card = await env.createAccount(anna, 'Карта Анны', '10000');
  await env.record(anna, { type: 'EXPENSE', accountId: card, amount: '1250.50' });
  await env.createAccount(boris, 'Секретный счёт Бориса', '999');
  const created = await env.inject(
    'POST',
    `/api/v2/budgets/${anna.budgetId}/calendar/events`,
    anna,
    { title: 'Родительское собрание', allDay: true, date: today(), recurrence: 'NONE' },
  );
  expect(created.statusCode).toBe(201);
  await env.prisma.budget.update({
    where: { id: anna.budgetId },
    data: {
      planModelVersion: 2,
      planModelActivatedOn: new Date(Date.now() - 30 * 86_400_000),
    },
  });
  const incomePlan = await env.inject(
    'POST',
    `/api/v2/budgets/${anna.budgetId}/income-plans`,
    anna,
    {
      name: 'Зарплата Анны',
      amount: '80000.00',
      scheduledOn: isoPlusDays(2),
      categoryId: await env.categoryId(anna.budgetId, 'INCOME'),
      recurrence: 'ONE_TIME',
    },
  );
  expect(incomePlan.statusCode).toBe(201);
  await env.prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId: anna.budgetId,
      ownerUserId: anna.user.id,
      name: 'Обязательные',
      envelopeType: 'MANDATORY_EXPENSES',
      startingBalanceMinor: 0n,
      displayOrder: 1,
    },
  });
  const obligationPlan = await env.inject(
    'POST',
    `/api/v2/budgets/${anna.budgetId}/obligations/plans`,
    anna,
    {
      name: 'Ипотека',
      amount: '3000.00',
      scheduledOn: isoPlusDays(3),
      categoryId: await env.categoryId(anna.budgetId, 'EXPENSE'),
      recurrence: 'ONE_TIME',
    },
  );
  expect(obligationPlan.statusCode).toBe(201);
  annaChat = await link(anna);
  borisChat = await link(boris);
});

afterAll(async () => {
  await env.stop();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  sent.length = 0;
});

describe('read-only commands', () => {
  it('/last shows the confirmed expense of the budget only', async () => {
    const text = await ask(annaChat, '/last');
    expect(text).toContain('Последние операции');
    expect(text).toContain(`−1${NBSP}250,50${NBSP}₽`);
    expect(text).toContain('Карта Анны');
    expect(await ask(borisChat, '/last')).toContain('Операций пока нет');
  });

  it('/balance lists accounts with the dashboard total and never another family', async () => {
    const text = await ask(annaChat, '/balance');
    expect(text).toContain('Карта Анны');
    expect(text).toContain('Всего на счетах:');
    expect(text).not.toContain('Секретный счёт Бориса');
  });

  it('/events shows the event of today', async () => {
    const text = await ask(annaChat, '/events');
    expect(text).toContain('Родительское собрание');
    expect(text).toContain('весь день');
    expect(await ask(borisChat, '/events')).toContain('событий нет');
  });

  it('/plans shows real amounts for income plans and obligations', async () => {
    const text = await ask(annaChat, '/plans');
    expect(text).toContain('Плановые платежи');
    expect(text).toContain('Зарплата Анны');
    expect(text).toContain(`+80${NBSP}000${NBSP}₽`);
    expect(text).toContain('Ипотека');
    expect(text).toContain(`−3${NBSP}000${NBSP}₽`);
    expect(text).not.toContain(`+0${NBSP}`);
  });

  it('/plans answers even without plans', async () => {
    expect(await ask(borisChat, '/plans')).toContain('Плановые платежи');
  });

  it('views stay off while commands are switched off', async () => {
    await env.prisma.telegramLink.update({
      where: { chatId: BigInt(borisChat) },
      data: { commandsEnabledAt: null },
    });
    expect(await ask(borisChat, '/balance')).toContain('Команды бота выключены');
  });
});
