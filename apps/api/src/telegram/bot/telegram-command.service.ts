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
import type { BotViewRenderer } from './telegram-bot-views.js';

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
    private readonly views: BotViewRenderer | null = null,
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
    const view = this.views ? await this.views.render(command, ctx) : null;
    if (view) return this.show(ctx, null, null, view);
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
    const view = this.accountsLink(screen);
    if (messageId !== null) {
      await this.bot.editKeyboard(ctx.chatId, messageId, view.text, view.keyboard);
      return;
    }
    const sent = await this.bot.sendKeyboard(ctx.chatId, view.text, view.keyboard);
    if (dialogId !== null && sent !== null) await this.repository.setMessage(dialogId, sent);
  }

  /**
   * Spec §«/expense», п.2 and §«/transfer», п.2: the empty own-accounts screen gives a link to
   * the app; the pure dialog module does not know the base URL, so it is added right here.
   */
  private accountsLink(screen: Screen): Screen {
    if (!screen.text.includes('Нет своих счетов')) return screen;
    const [link] = webButton(this.webBaseUrl, 'Открыть «Счета»', '/app/accounts');
    return link ? { text: screen.text, keyboard: [...screen.keyboard, [link]] } : screen;
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
