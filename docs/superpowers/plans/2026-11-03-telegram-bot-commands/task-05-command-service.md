# Задача 5: сервис команд, сохранение и wiring

Перед началом прочитать [README](README.md). Ветка — `feat/telegram-bot-commands`. Задачи 1–4 закоммичены.

После этой задачи работают:
- `/help`, `/cancel`;
- диалоги `/expense`, `/income`, `/transfer`, `/event` с сохранением через существующие сервисы.

Команды просмотра (`/last` и другие) до задачи 6 отвечают списком команд.

**Files:**
- Create: `apps/api/src/telegram/bot/chat-rate-limiter.ts`
- Create: `apps/api/src/telegram/bot/chat-rate-limiter.test.ts`
- Create: `apps/api/src/telegram/bot/bot-replies.ts`
- Create: `apps/api/src/telegram/bot/telegram-bot.repository.ts`
- Create: `apps/api/src/telegram/bot/telegram-command.service.ts`
- Modify: `apps/api/src/telegram/telegram-link.application.service.ts` — делегирование.
- Modify (полная замена): `apps/api/src/telegram/telegram.module.ts`
- Create: `apps/api/test/telegram-bot-dialogs.integration.test.ts`

**Interfaces:**
- Consumes:
  - задача 1 — `prisma.telegramDialog`, `telegramLink.commandsEnabledAt`;
  - задача 2:
    - `TelegramBotClient.sendMessage`, `sendKeyboard`, `editKeyboard`, `answerCallback`;
    - `webButton(webBaseUrl, text, path): TelegramButton[]`;
    - `BotInput`;
  - задача 4:
    - `startDialog`, `advanceDialog`, `renderDialog`;
    - `decodeCallback`;
    - `escapeHtml`, `formatRub`, `amountToMinor`, `formatDay`;
    - типы `DialogKind`, `DialogStep`, `DialogData`, `DialogState`, `DialogEvent`, `DialogLookups`, `Screen`, `Choice`;
  - существующие сервисы:
    - `TransactionV2ApplicationService.create(userId, budgetId, input: TransactionV2Input, idempotencyKey, requestId?)` — возвращает `{ id, warnings: Array<{ code; detail }> , ... }`;
    - `DirectTransferApplicationService.create(userId, budgetId, input: DirectTransferInput, idempotencyKey, requestId?)`;
    - `CalendarApplicationService.createEvent(userId, budgetId, input: CalendarEventInput, key, requestId?)`;
    - `calendarEventInputSchema` из `../../calendar/calendar.schemas.js`;
    - `todayInTimezone(now: Date, timezone: string): string` из `../../cycles/cycle-period.domain.js`.
- Produces (использует задача 6):
  - `TelegramCommandService`:
    - конструктор `(repository: TelegramBotRepository, bot: TelegramBotClient, writers: BotWriters, webBaseUrl: string, limiter?: ChatRateLimiter, now?: () => Date)`;
    - метод `handle(input: BotInput | { kind: 'help'; chatId: bigint }): Promise<void>` — никогда не бросает исключение;
  - `BotContext = { chatId: bigint; userId: string; budgetId: string; budgetName: string; timezone: string; role: WorkspaceMembershipRole; today: string }`, экспортируется из `telegram-command.service.ts`;
  - `COMMAND_REPLIES` и `HELP_TEXT` из `bot-replies.ts`;
  - `TelegramBotRepository`:
    - `findChat`, `findCurrentBudget`;
    - `findDialog`, `startDialog`, `saveStep`, `setMessage`, `deleteDialog`;
    - `ownAccounts`, `budgetAccounts`, `categories`, `envelopes`;
  - в методе `command()` сервиса есть место для команд просмотра: комментарий `// Read-only commands (task 6) go here.`

---

- [ ] **Step 1: Ограничитель частоты (тест и реализация)**

Файл `apps/api/src/telegram/bot/chat-rate-limiter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { ChatRateLimiter } from './chat-rate-limiter.js';

describe('ChatRateLimiter', () => {
  it('allows up to the limit per chat inside one window', () => {
    const limiter = new ChatRateLimiter(3, 60_000);
    expect([1, 2, 3, 4].map(() => limiter.allow(1n, 1_000))).toEqual([true, true, true, false]);
    expect(limiter.allow(2n, 1_000)).toBe(true);
  });

  it('starts a new window after the old one ends', () => {
    const limiter = new ChatRateLimiter(1, 60_000);
    expect(limiter.allow(1n, 0)).toBe(true);
    expect(limiter.allow(1n, 59_999)).toBe(false);
    expect(limiter.allow(1n, 60_000)).toBe(true);
  });
});
```

Файл `apps/api/src/telegram/bot/chat-rate-limiter.ts`:

```ts
const MAX_TRACKED_CHATS = 10_000;

/**
 * Fixed-window counter per chat, in process memory like AuthRateLimitGuard: production runs one
 * API instance. Updates over the limit are dropped without a reply.
 */
export class ChatRateLimiter {
  private readonly windows = new Map<bigint, { count: number; resetAt: number }>();

  constructor(
    private readonly max = 30,
    private readonly windowMs = 60_000,
  ) {}

  allow(chatId: bigint, now: number): boolean {
    const current = this.windows.get(chatId);
    if (!current || current.resetAt <= now) {
      if (this.windows.size >= MAX_TRACKED_CHATS) this.prune(now);
      this.windows.set(chatId, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= this.max;
  }

  private prune(now: number): void {
    for (const [chatId, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(chatId);
    }
  }
}
```

Run: `cd apps/api && pnpm exec vitest run src/telegram/bot/chat-rate-limiter.test.ts`
Expected: PASS.

- [ ] **Step 2: Тексты ответов**

Файл `apps/api/src/telegram/bot/bot-replies.ts`:

```ts
export const HELP_TEXT = [
  '<b>Команды HarmoFin</b>',
  '/expense — расход',
  '/income — доход',
  '/transfer — перевод между счетами',
  '/event — событие календаря',
  '/last — последние операции',
  '/plans — плановые платежи на 7 дней',
  '/events — события на 7 дней',
  '/balance — остатки и «Доступно»',
  '/cancel — отменить ввод',
  '/stop — отключить бота',
].join('\n');

export const COMMAND_REPLIES = {
  disabled: 'Команды бота выключены. Включите их в настройках HarmoFin → Telegram.',
  noBudget: 'Нет доступного бюджета. Откройте HarmoFin в браузере.',
  viewer: 'У вас роль наблюдателя: вносить операции и события нельзя.',
  stale: 'Диалог устарел, начните заново.',
  cancelled: 'Ввод отменён.',
  nothingToCancel: 'Нечего отменять.',
  failed: 'Не получилось, попробуйте ещё раз.',
  saveFailed: 'Не получилось сохранить, попробуйте ещё раз.',
} as const;
```

- [ ] **Step 3: Репозиторий бота**

Файл `apps/api/src/telegram/bot/telegram-bot.repository.ts`:

```ts
import type { Prisma, WorkspaceMembershipRole } from '@prisma/client';

import { createUuidV7 } from '../../common/identifiers/uuid-v7.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { Choice, DialogData, DialogKind, DialogStep } from './dialog.types.js';

const LIST_LIMIT = 200;

export type ChatAccess = { userId: string; active: boolean; commandsEnabled: boolean };

export type CurrentBudget = {
  budgetId: string;
  budgetName: string;
  timezone: string;
  role: WorkspaceMembershipRole;
};

export type StoredDialog = {
  id: string;
  chatId: bigint;
  userId: string;
  budgetId: string;
  kind: DialogKind;
  step: DialogStep;
  version: number;
  data: DialogData;
  messageId: number | null;
  expiresAt: Date;
};

type DialogRow = Prisma.TelegramDialogGetPayload<object>;

function toDialog(row: DialogRow): StoredDialog {
  return {
    id: row.id,
    chatId: row.chatId,
    userId: row.userId,
    budgetId: row.budgetId,
    kind: row.kind as DialogKind,
    step: row.step as DialogStep,
    version: row.version,
    data: (row.data ?? {}) as DialogData,
    messageId: row.messageId,
    expiresAt: row.expiresAt,
  };
}

const named = (rows: Array<{ id: string; name: string }>): Choice[] =>
  rows.map((row) => ({ id: row.id, label: row.name }));

/**
 * Data access of the bot: who the chat belongs to, which budget the user works in, the dialog
 * state and the choice lists. Every list query filters by budget_id in the database; ownership,
 * roles and money are re-checked by the application services that save.
 */
export class TelegramBotRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findChat(chatId: bigint): Promise<ChatAccess | null> {
    const link = await this.prisma.telegramLink.findUnique({
      where: { chatId },
      select: { userId: true, commandsEnabledAt: true, user: { select: { status: true } } },
    });
    if (!link) return null;
    return {
      userId: link.userId,
      active: link.user.status === 'ACTIVE',
      commandsEnabled: link.commandsEnabledAt !== null,
    };
  }

  /** Same order as the web: last selected membership first, never-selected by join date. */
  async findCurrentBudget(userId: string): Promise<CurrentBudget | null> {
    const membership = await this.prisma.workspaceMembership.findFirst({
      where: { userId, isActive: true, workspace: { status: 'ACTIVE' } },
      orderBy: [{ lastSelectedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
      select: {
        role: true,
        workspace: {
          select: {
            budgets: {
              where: { status: 'ACTIVE', planModelVersion: 2 },
              orderBy: { createdAt: 'asc' },
              take: 1,
              select: { id: true, name: true, timezone: true },
            },
          },
        },
      },
    });
    const budget = membership?.workspace.budgets[0];
    if (!membership || !budget) return null;
    return {
      budgetId: budget.id,
      budgetName: budget.name,
      timezone: budget.timezone,
      role: membership.role,
    };
  }

  async findDialog(chatId: bigint): Promise<StoredDialog | null> {
    const row = await this.prisma.telegramDialog.findUnique({ where: { chatId } });
    return row ? toDialog(row) : null;
  }

  /** Replaces whatever dialog the chat had with a new one (a new id, so a new idempotency key). */
  startDialog(input: {
    chatId: bigint;
    userId: string;
    budgetId: string;
    kind: DialogKind;
    step: DialogStep;
    version: number;
    data: DialogData;
    expiresAt: Date;
  }): Promise<StoredDialog> {
    return this.prisma.$transaction(async (tx) => {
      await tx.telegramDialog.deleteMany({ where: { chatId: input.chatId } });
      const row = await tx.telegramDialog.create({
        data: {
          id: createUuidV7(),
          chatId: input.chatId,
          userId: input.userId,
          budgetId: input.budgetId,
          kind: input.kind,
          step: input.step,
          version: input.version,
          data: input.data as Prisma.InputJsonValue,
          expiresAt: input.expiresAt,
        },
      });
      return toDialog(row);
    });
  }

  /** Optimistic: saves only over the version the caller read. False when another update won. */
  async saveStep(
    id: string,
    expectedVersion: number,
    values: { step: DialogStep; version: number; data: DialogData; expiresAt: Date },
  ): Promise<boolean> {
    const result = await this.prisma.telegramDialog.updateMany({
      where: { id, version: expectedVersion },
      data: {
        step: values.step,
        version: values.version,
        data: values.data as Prisma.InputJsonValue,
        expiresAt: values.expiresAt,
      },
    });
    return result.count === 1;
  }

  async setMessage(id: string, messageId: number): Promise<void> {
    await this.prisma.telegramDialog.updateMany({ where: { id }, data: { messageId } });
  }

  async deleteDialog(chatId: bigint): Promise<void> {
    await this.prisma.telegramDialog.deleteMany({ where: { chatId } });
  }

  /** Accounts the user may spend from: requireAccountOwner allows only their own. */
  async ownAccounts(budgetId: string, userId: string): Promise<Choice[]> {
    return named(
      await this.prisma.account.findMany({
        where: { budgetId, ownerUserId: userId, archivedAt: null, currency: 'RUB' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: LIST_LIMIT,
        select: { id: true, name: true },
      }),
    );
  }

  async budgetAccounts(budgetId: string): Promise<Choice[]> {
    return named(
      await this.prisma.account.findMany({
        where: { budgetId, archivedAt: null, currency: 'RUB' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: LIST_LIMIT,
        select: { id: true, name: true },
      }),
    );
  }

  async categories(budgetId: string, type: 'INCOME' | 'EXPENSE'): Promise<Choice[]> {
    return named(
      await this.prisma.category.findMany({
        where: { budgetId, categoryType: type, archivedAt: null },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        take: LIST_LIMIT,
        select: { id: true, name: true },
      }),
    );
  }

  /** Mandatory-payment envelopes are paid through their plan in the app, never from the bot. */
  async envelopes(budgetId: string): Promise<Choice[]> {
    return named(
      await this.prisma.envelope.findMany({
        where: {
          budgetId,
          archivedAt: null,
          currency: 'RUB',
          envelopeType: { not: 'MANDATORY_EXPENSES' },
        },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        take: LIST_LIMIT,
        select: { id: true, name: true },
      }),
    );
  }
}
```

Если `Prisma.TelegramDialogGetPayload<object>` не компилируется, заменить строку `type DialogRow = ...` на `type DialogRow = NonNullable<Awaited<ReturnType<PrismaService['telegramDialog']['findUnique']>>>;`.

- [ ] **Step 4: Сервис команд**

Файл `apps/api/src/telegram/bot/telegram-command.service.ts`:

```ts
import { HttpException } from '@nestjs/common';
import type { WorkspaceMembershipRole } from '@prisma/client';

import type { CalendarApplicationService } from '../../calendar/calendar.application.service.js';
import { calendarEventInputSchema } from '../../calendar/calendar.schemas.js';
import { todayInTimezone } from '../../cycles/cycle-period.domain.js';
import type { TransactionV2ApplicationService } from '../../v2-transactions/transaction-v2.application.service.js';
import type { DirectTransferApplicationService } from '../../v2-transfers/direct-transfer.application.service.js';
import { BOT_REPLIES } from '../telegram-link.application.service.js';
import {
  webButton,
  type TelegramBotClient,
  type TelegramButton,
  type TelegramKeyboard,
} from '../telegram-bot.client.js';
import type { BotInput } from '../telegram-update.js';
import { amountToMinor, escapeHtml, formatDay, formatRub } from './bot-format.js';
import { COMMAND_REPLIES, HELP_TEXT } from './bot-replies.js';
import { decodeCallback } from './callback-data.js';
import { ChatRateLimiter } from './chat-rate-limiter.js';
import { advanceDialog, renderDialog, startDialog } from './dialog-flow.js';
import type {
  DialogContext,
  DialogEvent,
  DialogKind,
  DialogLookups,
  DialogState,
  Screen,
} from './dialog.types.js';
import type { StoredDialog, TelegramBotRepository } from './telegram-bot.repository.js';

const DIALOG_TTL_MS = 30 * 60_000;
const DETAIL_MAX = 300;

const DIALOG_COMMANDS = new Map<string, DialogKind>([
  ['expense', 'EXPENSE'],
  ['income', 'INCOME'],
  ['transfer', 'TRANSFER'],
  ['event', 'EVENT'],
]);

export type BotContext = {
  chatId: bigint;
  userId: string;
  budgetId: string;
  budgetName: string;
  timezone: string;
  role: WorkspaceMembershipRole;
  today: string;
};

/** The services that save; the bot never writes financial rows itself. */
export type BotWriters = {
  transactions: Pick<TransactionV2ApplicationService, 'create'>;
  transfers: Pick<DirectTransferApplicationService, 'create'>;
  calendar: Pick<CalendarApplicationService, 'createEvent'>;
};

type Incoming = BotInput | { kind: 'help'; chatId: bigint };
type Outcome = 'done' | 'stale';

/** Russian text of a refused save: the service's own detail when it is a plain HTTP error. */
function refusalText(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response !== null) {
      const detail = (response as { detail?: unknown }).detail;
      if (typeof detail === 'string' && detail.length > 0 && detail.length <= DETAIL_MAX) {
        return detail;
      }
    }
  }
  return COMMAND_REPLIES.saveFailed;
}

const rows = (buttons: TelegramButton[]): TelegramKeyboard => buttons.map((button) => [button]);

/**
 * Commands and step-by-step dialogs of a linked private chat. Checks, in order: rate limit, link,
 * active user, commands switch, current budget (and role for writing). Saving goes only through
 * the application services, with the dialog id as idempotency key and request id.
 */
export class TelegramCommandService {
  constructor(
    private readonly repository: TelegramBotRepository,
    private readonly bot: TelegramBotClient,
    private readonly writers: BotWriters,
    private readonly webBaseUrl: string,
    private readonly limiter: ChatRateLimiter = new ChatRateLimiter(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Never throws: a failure becomes a short reply; over the rate limit nothing is answered. */
  async handle(input: Incoming): Promise<void> {
    if (!this.limiter.allow(input.chatId, this.now().getTime())) return;
    try {
      await this.dispatch(input);
    } catch {
      // Nothing from the update is logged: it may carry amounts and names.
      await this.quietly(() =>
        input.kind === 'callback'
          ? this.bot.answerCallback(input.callbackId, COMMAND_REPLIES.failed)
          : this.bot.sendMessage(input.chatId, COMMAND_REPLIES.failed),
      );
    }
  }

  private async dispatch(input: Incoming): Promise<void> {
    const ctx = await this.context(input);
    if (!ctx) return;
    switch (input.kind) {
      case 'help':
        return this.bot.sendMessage(ctx.chatId, HELP_TEXT);
      case 'command':
        return this.command(ctx, input.command);
      case 'text':
        return this.text(ctx, input.text);
      case 'callback':
        return this.callback(ctx, input);
    }
  }

  /** The whole access chain; on a refusal it answers and returns null. */
  private async context(input: Incoming): Promise<BotContext | null> {
    const refuse = async (text: string, buttons: TelegramButton[] = []): Promise<null> => {
      if (input.kind === 'callback') await this.bot.answerCallback(input.callbackId, text);
      else await this.bot.sendMessage(input.chatId, text, buttons);
      return null;
    };
    const chat = await this.repository.findChat(input.chatId);
    if (!chat || !chat.active) return refuse(BOT_REPLIES.help);
    if (!chat.commandsEnabled) {
      if (input.kind === 'help' || input.kind === 'text') return refuse(BOT_REPLIES.help);
      return refuse(
        COMMAND_REPLIES.disabled,
        webButton(this.webBaseUrl, 'Настройки', '/app/settings/telegram'),
      );
    }
    const budget = await this.repository.findCurrentBudget(chat.userId);
    if (!budget) return refuse(COMMAND_REPLIES.noBudget);
    return {
      chatId: input.chatId,
      userId: chat.userId,
      ...budget,
      today: todayInTimezone(this.now(), budget.timezone),
    };
  }

  private async command(ctx: BotContext, command: string): Promise<void> {
    const kind = DIALOG_COMMANDS.get(command);
    if (kind) return this.start(ctx, kind);
    if (command === 'cancel') {
      const dialog = await this.repository.findDialog(ctx.chatId);
      await this.repository.deleteDialog(ctx.chatId);
      return this.bot.sendMessage(
        ctx.chatId,
        dialog ? COMMAND_REPLIES.cancelled : COMMAND_REPLIES.nothingToCancel,
      );
    }
    // Read-only commands (task 6) go here.
    return this.bot.sendMessage(ctx.chatId, HELP_TEXT);
  }

  private async start(ctx: BotContext, kind: DialogKind): Promise<void> {
    if (ctx.role === 'VIEWER') return this.bot.sendMessage(ctx.chatId, COMMAND_REPLIES.viewer);
    const result = await startDialog(kind, this.flow(ctx), this.lookups(ctx));
    if (result.type !== 'continue') return;
    const dialog = await this.repository.startDialog({
      chatId: ctx.chatId,
      userId: ctx.userId,
      budgetId: ctx.budgetId,
      kind,
      step: result.state.step,
      version: result.state.version,
      data: result.state.data,
      expiresAt: this.expiry(),
    });
    await this.show(ctx, dialog.id, null, result.screen);
  }

  private async text(ctx: BotContext, text: string): Promise<void> {
    const dialog = await this.activeDialog(ctx);
    if (!dialog) return this.bot.sendMessage(ctx.chatId, HELP_TEXT);
    await this.advance(ctx, dialog, { type: 'text', text }, null);
  }

  private async callback(
    ctx: BotContext,
    input: Extract<BotInput, { kind: 'callback' }>,
  ): Promise<void> {
    const decoded = decodeCallback(input.data);
    const dialog = await this.activeDialog(ctx);
    if (!decoded || !dialog || decoded.version !== dialog.version) {
      return this.bot.answerCallback(input.callbackId, COMMAND_REPLIES.stale);
    }
    const event: DialogEvent = { type: 'button', action: decoded.action, index: decoded.index };
    const outcome = await this.advance(ctx, dialog, event, input.messageId);
    await this.bot.answerCallback(
      input.callbackId,
      outcome === 'stale' ? COMMAND_REPLIES.stale : undefined,
    );
  }

  /** A dialog of another user or budget (membership changed) or past its time is dropped. */
  private async activeDialog(ctx: BotContext): Promise<StoredDialog | null> {
    const dialog = await this.repository.findDialog(ctx.chatId);
    if (!dialog) return null;
    if (
      dialog.expiresAt <= this.now() ||
      dialog.userId !== ctx.userId ||
      dialog.budgetId !== ctx.budgetId
    ) {
      await this.repository.deleteDialog(ctx.chatId);
      return null;
    }
    return dialog;
  }

  private async advance(
    ctx: BotContext,
    dialog: StoredDialog,
    event: DialogEvent,
    messageId: number | null,
  ): Promise<Outcome> {
    const state: DialogState = {
      kind: dialog.kind,
      step: dialog.step,
      version: dialog.version,
      data: dialog.data,
    };
    const result = await advanceDialog(state, event, this.flow(ctx), this.lookups(ctx));
    switch (result.type) {
      case 'stale':
        return 'stale';
      case 'cancel':
        await this.repository.deleteDialog(ctx.chatId);
        await this.show(ctx, null, messageId, result.screen);
        return 'done';
      case 'continue':
        return this.step(ctx, dialog, result.state, result.screen, messageId);
      case 'submit':
        return this.submit(ctx, dialog, result.state, messageId);
    }
  }

  private async step(
    ctx: BotContext,
    dialog: StoredDialog,
    next: DialogState,
    screen: Screen,
    messageId: number | null,
  ): Promise<Outcome> {
    const saved = await this.repository.saveStep(dialog.id, dialog.version, {
      step: next.step,
      version: next.version,
      data: next.data,
      expiresAt: this.expiry(),
    });
    if (!saved) return 'stale';
    await this.show(ctx, dialog.id, messageId, screen);
    return 'done';
  }

  private async submit(
    ctx: BotContext,
    dialog: StoredDialog,
    state: DialogState,
    messageId: number | null,
  ): Promise<Outcome> {
    let done: Screen;
    try {
      done = await this.save(ctx, dialog.id, state);
    } catch (error) {
      // The service refused (balance, archived account, role...): stay on the summary.
      const next: DialogState = {
        ...state,
        version: state.version + 1,
        data: { ...state.data, error: refusalText(error) },
      };
      return this.step(ctx, dialog, next, renderDialog(next, this.flow(ctx)), messageId);
    }
    await this.repository.deleteDialog(ctx.chatId);
    await this.show(ctx, null, messageId, done);
    return 'done';
  }

  /** Saves through the application service; the dialog id makes a repeated press harmless. */
  private async save(ctx: BotContext, dialogId: string, state: DialogState): Promise<Screen> {
    const key = `telegram:${dialogId}`;
    const data = state.data;
    const head = (title: string) => `<b>${title}</b> · ${escapeHtml(ctx.budgetName)}`;
    const amount = data.amount ? formatRub(amountToMinor(data.amount)) : '';

    if (state.kind === 'EXPENSE' || state.kind === 'INCOME') {
      const view = await this.writers.transactions.create(
        ctx.userId,
        ctx.budgetId,
        {
          transactionType: state.kind,
          status: 'CONFIRMED',
          amount: data.amount!,
          occurredOn: data.date!,
          accountId: data.accountId!,
          categoryId: data.categoryId!,
          envelopeId: state.kind === 'EXPENSE' ? (data.envelopeId ?? null) : null,
          comment: data.comment ?? null,
        },
        key,
        key,
      );
      const sign = state.kind === 'EXPENSE' ? '−' : '+';
      const lines = [
        head('Записано'),
        `${sign}${amount} · ${escapeHtml(data.categoryName ?? '')} · ${escapeHtml(data.accountName ?? '')}`,
        ...view.warnings.map((warning) => `<i>${escapeHtml(warning.detail)}</i>`),
      ];
      const buttons = [
        ...webButton(
          this.webBaseUrl,
          'Открыть в приложении',
          `/app/operations?operationId=${view.id}`,
        ),
        ...(state.kind === 'INCOME'
          ? webButton(this.webBaseUrl, 'Распределить', '/app/envelopes')
          : []),
      ];
      return { text: lines.join('\n'), keyboard: rows(buttons) };
    }

    if (state.kind === 'TRANSFER') {
      await this.writers.transfers.create(
        ctx.userId,
        ctx.budgetId,
        {
          sourceAccountId: data.accountId!,
          destinationAccountId: data.destinationId!,
          amount: data.amount!,
          occurredOn: data.date!,
          ...(data.comment ? { comment: data.comment } : {}),
        },
        key,
        key,
      );
      return {
        text: [
          head('Переведено'),
          `${amount} · ${escapeHtml(data.accountName ?? '')} → ${escapeHtml(data.destinationName ?? '')}`,
        ].join('\n'),
        keyboard: rows(webButton(this.webBaseUrl, 'Журнал', '/app/operations')),
      };
    }

    // Same validation as the HTTP body of POST .../calendar/events.
    const input = calendarEventInputSchema.parse({
      title: data.title,
      allDay: data.allDay ?? true,
      date: data.date,
      startTime: data.allDay ? null : data.startTime,
      endTime: data.allDay ? null : data.endTime,
      recurrence: 'NONE',
      reminderMinutes: data.reminderMinutes ?? null,
    });
    await this.writers.calendar.createEvent(ctx.userId, ctx.budgetId, input, key, key);
    const time = input.allDay ? 'весь день' : `${input.startTime}–${input.endTime}`;
    return {
      text: [
        head('Событие создано'),
        `${escapeHtml(input.title)} · ${formatDay(input.date, ctx.today)} · ${time}`,
      ].join('\n'),
      keyboard: rows(webButton(this.webBaseUrl, 'Календарь', `/app/calendar?date=${input.date}`)),
    };
  }

  /** A pressed button edits its own message; typed text gets a new message with the keyboard. */
  private async show(
    ctx: BotContext,
    dialogId: string | null,
    messageId: number | null,
    screen: Screen,
  ): Promise<void> {
    if (messageId !== null) {
      await this.bot.editKeyboard(ctx.chatId, messageId, screen.text, screen.keyboard);
      return;
    }
    const sent = await this.bot.sendKeyboard(ctx.chatId, screen.text, screen.keyboard);
    if (dialogId !== null && sent !== null) await this.repository.setMessage(dialogId, sent);
  }

  private flow(ctx: BotContext): DialogContext {
    return { today: ctx.today, budgetName: ctx.budgetName };
  }

  private lookups(ctx: BotContext): DialogLookups {
    return {
      ownAccounts: () => this.repository.ownAccounts(ctx.budgetId, ctx.userId),
      budgetAccounts: () => this.repository.budgetAccounts(ctx.budgetId),
      categories: (type) => this.repository.categories(ctx.budgetId, type),
      envelopes: () => this.repository.envelopes(ctx.budgetId),
    };
  }

  private expiry(): Date {
    return new Date(this.now().getTime() + DIALOG_TTL_MS);
  }

  private async quietly(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch {
      // The reply itself failed (Telegram down, rate limit): nothing else to do.
    }
  }
}
```

Пояснения:
- `BOT_REPLIES` импортируется из сервиса привязки как значение. Сервис привязки импортирует `TelegramCommandService` только как тип (`import type`), поэтому цикла при выполнении нет.
- `calendarEventInputSchema.parse` заполняет значения по умолчанию: `interval`, `weekdays`, `participantUserIds`, `description` и прочие. Поэтому событие из бота проходит ту же проверку, что и тело HTTP-запроса. Ошибка zod не является `HttpException` и показывается как «Не получилось сохранить».

- [ ] **Step 5: Делегирование из сервиса привязки**

В `apps/api/src/telegram/telegram-link.application.service.ts` три правки.

1. После строки `import { parseTelegramUpdate, webhookSecretMatches } from './telegram-update.js';` заменить её на две строки:

```ts
import type { TelegramCommandService } from './bot/telegram-command.service.js';
import { parseTelegramUpdate, webhookSecretMatches, type BotInput } from './telegram-update.js';
```

2. В конструкторе после параметра `private readonly config: Pick<ApiConfig, 'telegram' | 'mail'>,` добавить:

```ts
    private readonly commands: TelegramCommandService | null = null,
```

3. В `handleUpdate` заменить строку

```ts
        if (action.code === null) return this.reply(action.chatId, BOT_REPLIES.help);
```

на:

```ts
        if (action.code === null) return this.delegate({ kind: 'help', chatId: action.chatId });
```

Затем блок (из задачи 2)

```ts
      case 'help':
      case 'command':
      case 'text':
        return this.reply(action.chatId, BOT_REPLIES.help);
      case 'callback':
      case 'ignore':
```

заменить на:

```ts
      case 'help':
      case 'command':
      case 'text':
      case 'callback':
        return this.delegate(action);
      case 'ignore':
```

Перед методом `private async linkChat(` добавить метод:

```ts
  /** Commands, plain text and buttons belong to the command service; without it, the old help. */
  private async delegate(action: BotInput | { kind: 'help'; chatId: bigint }): Promise<void> {
    if (this.commands) return this.commands.handle(action);
    if (action.kind !== 'callback') return this.reply(action.chatId, BOT_REPLIES.help);
  }
```

- [ ] **Step 6: Модуль**

Полностью заменить `apps/api/src/telegram/telegram.module.ts`:

```ts
import { type DynamicModule, Module } from '@nestjs/common';

import { TokenService } from '../auth/token.service.js';
import { CalendarApplicationService } from '../calendar/calendar.application.service.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import type { ApiConfig } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { PlansCalendarApplicationService } from '../plans-calendar/plans-calendar.application.service.js';
import { TransactionV2ApplicationService } from '../v2-transactions/transaction-v2.application.service.js';
import { DirectTransferApplicationService } from '../v2-transfers/direct-transfer.application.service.js';
import { TelegramBotRepository } from './bot/telegram-bot.repository.js';
import { TelegramCommandService } from './bot/telegram-command.service.js';
import {
  HttpTelegramBotClient,
  TELEGRAM_BOT_CLIENT,
  type TelegramBotClient,
} from './telegram-bot.client.js';
import { TelegramLinkApplicationService } from './telegram-link.application.service.js';
import { TelegramLinkController } from './telegram-link.controller.js';
import { TelegramSettingsApplicationService } from './telegram-settings.application.service.js';
import { TelegramSettingsController } from './telegram-settings.controller.js';
import { TelegramWebhookController } from './telegram-webhook.controller.js';
import { TelegramRepository } from './telegram.repository.js';

@Module({})
export class TelegramModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: TelegramModule,
      controllers: [TelegramLinkController, TelegramWebhookController, TelegramSettingsController],
      providers: [
        {
          provide: TelegramRepository,
          useFactory: (prisma: PrismaService) => new TelegramRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: TELEGRAM_BOT_CLIENT,
          useFactory: (): TelegramBotClient | null =>
            config.telegram
              ? new HttpTelegramBotClient(config.telegram.botToken, config.telegram.apiBaseUrl)
              : null,
        },
        {
          // Services are built here as their own modules build them: importing those modules a
          // second time would register their controllers twice.
          provide: TelegramCommandService,
          useFactory: (
            prisma: PrismaService,
            bot: TelegramBotClient | null,
          ): TelegramCommandService | null =>
            bot
              ? new TelegramCommandService(
                  new TelegramBotRepository(prisma),
                  bot,
                  {
                    transactions: new TransactionV2ApplicationService(
                      prisma,
                      new IdempotencyService(),
                      new PlanModelPolicy(prisma),
                    ),
                    transfers: new DirectTransferApplicationService(
                      prisma,
                      new IdempotencyService(),
                      new PlanModelPolicy(prisma),
                    ),
                    calendar: new CalendarApplicationService(
                      prisma,
                      new IdempotencyService(),
                      new PlanModelPolicy(prisma),
                      new PlansCalendarApplicationService(prisma, new PlanModelPolicy(prisma)),
                    ),
                  },
                  config.mail.webBaseUrl,
                )
              : null,
          inject: [PrismaService, TELEGRAM_BOT_CLIENT],
        },
        {
          provide: TelegramLinkApplicationService,
          useFactory: (
            repository: TelegramRepository,
            tokens: TokenService,
            bot: TelegramBotClient | null,
            commands: TelegramCommandService | null,
          ) => new TelegramLinkApplicationService(repository, tokens, bot, config, commands),
          inject: [TelegramRepository, TokenService, TELEGRAM_BOT_CLIENT, TelegramCommandService],
        },
        {
          provide: TelegramSettingsApplicationService,
          useFactory: (repository: TelegramRepository) =>
            new TelegramSettingsApplicationService(repository, config.telegram !== undefined),
          inject: [TelegramRepository],
        },
      ],
      exports: [TelegramRepository],
    };
  }
}
```

Проверить конструктор `DirectTransferApplicationService` в `apps/api/src/v2-transfers/direct-transfer.module.ts`: он принимает `(prisma, new IdempotencyService(), new PlanModelPolicy(prisma))`. Если аргументы другие, повторить ровно как в его модуле.

- [ ] **Step 7: Интеграционный тест диалогов (падающий до шагов 3–6, если запускать раньше)**

Файл `apps/api/test/telegram-bot-dialogs.integration.test.ts`:

```ts
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

beforeAll(async () => {
  vi.stubGlobal('fetch', fakeFetch);
  await env.start(telegramEnv);
  anna = await env.register();
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
```

- [ ] **Step 8: Проверки**

Run: `cd apps/api && pnpm exec vitest run src/telegram`
Expected: PASS.

Run: `cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts test/telegram-bot-dialogs.integration.test.ts test/telegram-linking.integration.test.ts`
Expected: PASS.

Если падает:
- **Тест расхода.** Проверить, что регистрация создаёт хотя бы одну категорию расхода. Если нет, перед `fillExpense` вызвать `await env.categoryId(anna.budgetId, 'EXPENSE')`.
- **Тест перевода по полю `comment`.** Проверить имя поля в `model Transfer` (`prisma/schema.prisma`). Если поля нет, убрать эту проверку и записать отступление.
- **Тест ограничения частоты.** Проверить, что другие тесты не пишут в тот же чат. Каждый тест привязывает новый чат.

Run: `pnpm typecheck && pnpm lint`
Expected: PASS, 0 errors.

Run: `pnpm --filter @harmofin/api test`
Expected: PASS, включая `di-explicit-inject.test.ts`.

Run: `pnpm test:integration`
Expected: PASS.

- [ ] **Step 9: Review по чек-листу**

Выполнить `git add apps/api/src/telegram apps/api/test/telegram-bot-dialogs.integration.test.ts`, затем просмотреть `git diff --staged`.

- **financial:**
  - запись идёт только через `TransactionV2ApplicationService.create`, `DirectTransferApplicationService.create` и `CalendarApplicationService.createEvent`;
  - статус `CONFIRMED`;
  - ключ идемпотентности — `telegram:<id диалога>`, и одновременное двойное «Провести» дало одну запись;
  - сумма уходит строкой;
  - у дохода `envelopeId: null`;
  - отказ сервиса не создаёт записи и показывается пользователю.
- **security:**
  - цепочка проверок: чат, ACTIVE, переключатель, участие, бюджет, роль;
  - списки фильтруются по `budget_id` в запросе;
  - для операций предлагаются только свои счета;
  - диалог другого пользователя или бюджета сбрасывается;
  - лимит 30 в минуту;
  - нет логирования текста, сумм и `chat_id`;
  - исключения не выходят наружу, webhook отвечает 200.
- **backend:**
  - сервисы построены через `new` в `useFactory`, без повторного импорта модулей;
  - `saveStep` оптимистичный по `version`;
  - `startDialog` заменяет диалог в транзакции;
  - нет новых зависимостей.
- **QA:** покрыты выключенные команды, чат без привязки, `/help`, VIEWER, лимит, полный расход с аудитом, двойное нажатие, отказ сервиса, устаревшая кнопка, `/cancel`, истёкший диалог, только свои счета, доход, перевод на чужой счёт, событие.
- **final:**
  - `telegram-linking.integration.test.ts` проходит без изменений;
  - лишних файлов нет.

- [ ] **Step 10: Commit**

```bash
git branch --show-current
git commit -m "feat(telegram): ввод расходов, доходов, переводов и событий через бота"
```

Добавить строку в «Ход выполнения».
