import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const SECRET = 'webhook-secret-with-at-least-32-chars_';
const telegramEnv = {
  TELEGRAM_BOT_TOKEN: '123456:integration-test-token',
  TELEGRAM_BOT_USERNAME: 'harmofin_test_bot',
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  TELEGRAM_API_BASE_URL: 'https://telegram.invalid',
};

type Button = { text: string; callback_data?: string; url?: string };
type Call = {
  method: string;
  chatId: string | undefined;
  text: string | undefined;
  messageId: number | undefined;
  keyboard: Button[][];
  callbackText: string | undefined;
};

const calls: Call[] = [];
let nextMessageId = 100;
const fakeFetch = vi.fn(async (url: unknown, init?: RequestInit) => {
  const method = String(url).split('/').at(-1)!;
  const body = JSON.parse(String(init?.body)) as {
    chat_id?: string;
    text?: string;
    message_id?: number;
    reply_markup?: { inline_keyboard: Button[][] };
  };
  const sentId = method === 'sendMessage' ? nextMessageId++ : undefined;
  calls.push({
    method,
    chatId: body.chat_id,
    text: method === 'answerCallbackQuery' ? undefined : body.text,
    messageId: sentId ?? body.message_id,
    keyboard: body.reply_markup?.inline_keyboard ?? [],
    callbackText: method === 'answerCallbackQuery' ? body.text : undefined,
  });
  const result = sentId === undefined ? true : { message_id: sentId };
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
});

const env = new FamilyTestApp();
let anna: FamilyActor;
let carol: FamilyActor;
let viewer: FamilyActor;
let updateId = 1;

const newChatId = () => 1_000_000 + Math.floor(Math.random() * 1_000_000_000);

function webhook(update: Record<string, unknown>) {
  return env.server.inject({
    method: 'POST',
    url: '/api/v1/telegram/webhook',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    payload: JSON.stringify({ update_id: updateId++, ...update }),
  });
}

async function say(chatId: number, text: string) {
  const response = await webhook({
    message: { message_id: updateId, chat: { id: chatId, type: 'private' }, text },
  });
  expect(response.statusCode).toBe(200);
}

async function press(chatId: number, data: string, messageId: number) {
  const response = await webhook({
    callback_query: {
      id: `cb-${updateId}`,
      data,
      message: { message_id: messageId, chat: { id: chatId, type: 'private' } },
    },
  });
  expect(response.statusCode).toBe(200);
}

/** The latest message the bot sent or edited in this chat. */
function screen(chatId: number): Call {
  const found = calls
    .filter(
      (call) =>
        call.chatId === String(chatId) &&
        (call.method === 'sendMessage' || call.method === 'editMessageText'),
    )
    .at(-1);
  if (!found) throw new Error('no bot message');
  return found;
}

function lastAnswer(): string | undefined {
  return calls.filter((call) => call.method === 'answerCallbackQuery').at(-1)?.callbackText;
}

function button(call: Call, match: (button: Button) => boolean): string {
  const found = call.keyboard.flat().find(match);
  if (!found?.callback_data) throw new Error(`no button in: ${call.text}`);
  return found.callback_data;
}
const byText = (text: string) => (candidate: Button) => candidate.text === text;
const firstPick = (candidate: Button) => /^\d+:pick:\d+$/.test(candidate.callback_data ?? '');

/** Presses a button of the bot's current message in this chat. */
async function tap(chatId: number, match: (button: Button) => boolean) {
  const current = screen(chatId);
  await press(chatId, button(current, match), current.messageId!);
}

async function linkWithCommands(actor: FamilyActor, commands = true): Promise<number> {
  await env.prisma.telegramLink.deleteMany({ where: { userId: actor.user.id } });
  const chatId = newChatId();
  const now = new Date();
  await env.prisma.telegramLink.create({
    data: {
      id: randomUUID(),
      userId: actor.user.id,
      chatId: BigInt(chatId),
      consentedAt: now,
      linkedAt: now,
      commandsEnabledAt: commands ? now : null,
      commandsConsentAt: commands ? now : null,
    },
  });
  return chatId;
}

const dialogOf = (chatId: number) =>
  env.prisma.telegramDialog.findUnique({ where: { chatId: BigInt(chatId) } });

async function selectFamily(member: FamilyActor, workspaceId: string) {
  await env.prisma.workspaceMembership.updateMany({
    where: { userId: member.user.id, workspaceId },
    data: { lastSelectedAt: new Date() },
  });
}

/** Categories come from the app's template flow; here they are plain reference rows. */
async function seedCategories(budgetId: string) {
  const rows = [
    { name: 'Продукты', categoryType: 'EXPENSE' as const, displayOrder: 0 },
    { name: 'Кафе', categoryType: 'EXPENSE' as const, displayOrder: 1 },
    { name: 'Зарплата', categoryType: 'INCOME' as const, displayOrder: 2 },
  ];
  for (const row of rows) {
    await env.prisma.category.create({ data: { id: randomUUID(), budgetId, ...row } });
  }
}

beforeAll(async () => {
  vi.stubGlobal('fetch', fakeFetch);
  await env.start(telegramEnv);
  anna = await env.register();
  await seedCategories(anna.budgetId);
  await env.createAccount(anna, 'Карта Анны', '10000');
  carol = await env.join(anna, await env.register(), 'EDITOR');
  await selectFamily(carol, anna.workspaceId);
  await env.createAccount(carol, 'Наличные Карины', '5000');
  viewer = await env.join(anna, await env.register(), 'VIEWER');
  await selectFamily(viewer, anna.workspaceId);
});

afterAll(async () => {
  await env.stop();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  calls.length = 0;
});

describe('access', () => {
  it('refuses commands until they are switched on', async () => {
    const chatId = await linkWithCommands(anna, false);
    await say(chatId, '/expense');
    expect(screen(chatId).text).toContain('Команды бота выключены');
    expect(await dialogOf(chatId)).toBeNull();
  });

  it('answers an unlinked chat with the linking help', async () => {
    const chatId = newChatId();
    await say(chatId, '/expense');
    expect(screen(chatId).text).toContain('/stop');
  });

  it('lists commands on /help', async () => {
    const chatId = await linkWithCommands(anna);
    await say(chatId, '/help');
    expect(screen(chatId).text).toContain('/expense');
    expect(screen(chatId).text).toContain('/balance');
  });

  it('refuses a viewer before the first step', async () => {
    const chatId = await linkWithCommands(viewer);
    await say(chatId, '/expense');
    expect(screen(chatId).text).toContain('роль наблюдателя');
    expect(await dialogOf(chatId)).toBeNull();
  });

  it('drops updates over 30 per minute without a reply', async () => {
    const chatId = await linkWithCommands(anna);
    for (let index = 0; index < 35; index += 1) await say(chatId, '/help');
    const replies = calls.filter((call) => call.chatId === String(chatId));
    expect(replies).toHaveLength(30);
  });
});

describe('expense', () => {
  async function fillExpense(chatId: number, amount: string) {
    await say(chatId, '/expense');
    expect(screen(chatId).text).toContain('Новый расход');
    await say(chatId, amount);
    await tap(chatId, byText('Карта Анны'));
    await tap(chatId, firstPick);
    await tap(chatId, byText('Без конверта'));
    await tap(chatId, byText('Сегодня'));
    await tap(chatId, byText('Пропустить'));
    expect(screen(chatId).text).toContain('Карта Анны');
  }

  it('records a confirmed expense step by step', async () => {
    const chatId = await linkWithCommands(anna);
    await fillExpense(chatId, '1 250,50');
    const dialog = await dialogOf(chatId);
    await tap(chatId, byText('Провести'));

    expect(screen(chatId).text).toContain('Записано');
    const saved = await env.prisma.transaction.findFirstOrThrow({
      where: { budgetId: anna.budgetId, createdByUserId: anna.user.id, amountMinor: 125050n },
    });
    expect(saved).toMatchObject({
      transactionType: 'EXPENSE',
      status: 'CONFIRMED',
      envelopeId: null,
      accountingModelVersion: 2,
    });
    const audit = await env.prisma.auditEvent.findFirst({
      where: { entityId: saved.id, requestId: `telegram:${dialog!.id}` },
    });
    expect(audit).not.toBeNull();
    expect(await dialogOf(chatId)).toBeNull();
  });

  it('records once when "Провести" arrives twice at the same time', async () => {
    const chatId = await linkWithCommands(anna);
    await fillExpense(chatId, '777');
    const summary = screen(chatId);
    const save = button(summary, byText('Провести'));
    await Promise.all([
      press(chatId, save, summary.messageId!),
      press(chatId, save, summary.messageId!),
    ]);
    const count = await env.prisma.transaction.count({
      where: { budgetId: anna.budgetId, createdByUserId: anna.user.id, amountMinor: 77700n },
    });
    expect(count).toBe(1);
    await press(chatId, save, summary.messageId!);
    expect(lastAnswer()).toContain('Диалог устарел');
  });

  it('shows the refusal of the service and stays on the summary', async () => {
    const chatId = await linkWithCommands(anna);
    await fillExpense(chatId, '999999');
    await tap(chatId, byText('Провести'));
    expect(screen(chatId).text).toContain('недостаточно средств');
    expect((await dialogOf(chatId))?.step).toBe('confirm');
    await tap(chatId, byText('Отмена'));
    expect(screen(chatId).text).toContain('Ввод отменён');
    expect(await dialogOf(chatId)).toBeNull();
  });

  it('answers an old button as stale', async () => {
    const chatId = await linkWithCommands(anna);
    await say(chatId, '/expense');
    const first = screen(chatId);
    const oldCancel = button(first, byText('Отмена'));
    await say(chatId, '100');
    await press(chatId, oldCancel, first.messageId!);
    expect(lastAnswer()).toContain('Диалог устарел');
    expect((await dialogOf(chatId))?.step).toBe('account');
  });

  it('ends the dialog on /cancel and forgets an expired one', async () => {
    const chatId = await linkWithCommands(anna);
    await say(chatId, '/expense');
    await say(chatId, '/cancel');
    expect(screen(chatId).text).toContain('Ввод отменён');
    expect(await dialogOf(chatId)).toBeNull();

    await say(chatId, '/expense');
    await env.prisma.telegramDialog.updateMany({
      where: { chatId: BigInt(chatId) },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await say(chatId, '100');
    expect(screen(chatId).text).toContain('/expense');
    expect(await dialogOf(chatId)).toBeNull();
  });

  it('offers only own accounts', async () => {
    const chatId = await linkWithCommands(carol);
    await say(chatId, '/expense');
    await say(chatId, '10');
    const labels = screen(chatId)
      .keyboard.flat()
      .map((candidate) => candidate.text);
    expect(labels).toContain('Наличные Карины');
    expect(labels).not.toContain('Карта Анны');
  });
});

describe('income, transfer and event', () => {
  it('records an income without an envelope', async () => {
    const chatId = await linkWithCommands(anna);
    await say(chatId, '/income');
    await say(chatId, '80000');
    await tap(chatId, byText('Карта Анны'));
    await tap(chatId, firstPick);
    await tap(chatId, byText('Сегодня'));
    await tap(chatId, byText('Пропустить'));
    await tap(chatId, byText('Провести'));
    const saved = await env.prisma.transaction.findFirstOrThrow({
      where: { budgetId: anna.budgetId, amountMinor: 8_000_000n, transactionType: 'INCOME' },
    });
    expect(saved).toMatchObject({ status: 'CONFIRMED', envelopeId: null });
  });

  it('transfers from an own account to an account of another member', async () => {
    const chatId = await linkWithCommands(carol);
    await say(chatId, '/transfer');
    await say(chatId, '1500');
    await tap(chatId, byText('Наличные Карины'));
    await tap(chatId, byText('Карта Анны'));
    await tap(chatId, byText('Сегодня'));
    await say(chatId, 'на продукты');
    await tap(chatId, byText('Провести'));
    expect(screen(chatId).text).toContain('Переведено');
    const transfer = await env.prisma.transfer.findFirstOrThrow({
      where: { budgetId: anna.budgetId, createdByUserId: carol.user.id, totalMinor: 150_000n },
    });
    expect(transfer.status).toBe('CONFIRMED');
    expect(transfer.comment).toBe('на продукты');
  });

  it('creates a timed calendar event with a reminder', async () => {
    const chatId = await linkWithCommands(anna);
    await say(chatId, '/event');
    await say(chatId, 'Врач');
    await tap(chatId, byText('Завтра'));
    await say(chatId, '9:30');
    await tap(chatId, byText('За 1 час'));
    await tap(chatId, byText('Создать'));
    expect(screen(chatId).text).toContain('Событие создано');
    const event = await env.prisma.calendarEvent.findFirstOrThrow({
      where: { budgetId: anna.budgetId, createdByUserId: anna.user.id, title: 'Врач' },
    });
    expect(event).toMatchObject({ allDay: false, reminderMinutes: 60, recurrence: 'NONE' });
  });
});
