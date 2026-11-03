import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { TokenService } from '../auth/token.service.js';
import type { ApiConfig } from '../config/env.js';
import { webButton, type TelegramBotClient, type TelegramButton } from './telegram-bot.client.js';
import type { TelegramRepository } from './telegram.repository.js';
import type { TelegramCommandService } from './bot/telegram-command.service.js';
import { parseTelegramUpdate, webhookSecretMatches, type BotInput } from './telegram-update.js';

const LINK_CODE_TTL_MS = 15 * 60_000;

type Meta = { requestId?: string };
type LinkOutcome = 'linked' | 'invalid' | 'taken';

export const BOT_REPLIES = {
  linked: 'Аккаунт HarmoFin привязан. Включите уведомления в настройках приложения.',
  invalid: 'Ссылка устарела. Получите новую в настройках HarmoFin.',
  taken: 'Этот чат уже привязан к другому аккаунту HarmoFin.',
  help: 'Чтобы подключить уведомления, откройте настройки HarmoFin. Отключить — /stop.',
  stopped: 'Уведомления отключены. Подключить снова можно в настройках HarmoFin.',
} as const;

const CONSENT_MESSAGE = 'Подтвердите согласие на отправку уведомлений через Telegram.';

/**
 * Links a private Telegram chat to the account through a one-time t.me deep link, and handles the
 * bot's webhook updates (/start <code>, /stop, blocked bot). Only the HMAC digest of a code is
 * stored; the chat id never reaches audit values or logs.
 */
export class TelegramLinkApplicationService {
  constructor(
    private readonly repository: TelegramRepository,
    private readonly tokens: TokenService,
    private readonly bot: TelegramBotClient | null,
    private readonly config: Pick<ApiConfig, 'telegram' | 'mail'>,
    private readonly commands: TelegramCommandService | null = null,
  ) {}

  get available(): boolean {
    return this.config.telegram !== undefined && this.bot !== null;
  }

  webhookSecretValid(received: string | undefined): boolean {
    const telegram = this.config.telegram;
    return telegram !== undefined && webhookSecretMatches(received, telegram.webhookSecret);
  }

  async issueLink(
    userId: string,
    consent: boolean,
    meta: Meta,
  ): Promise<{ url: string; expiresAt: string }> {
    const telegram = this.config.telegram;
    if (!telegram) {
      throw new ConflictException({
        code: 'TELEGRAM_UNAVAILABLE',
        detail: 'Telegram-бот не подключён на сервере.',
      });
    }
    if (!consent) {
      throw new UnprocessableEntityException({
        code: 'TELEGRAM_CONSENT_REQUIRED',
        detail: CONSENT_MESSAGE,
        fieldErrors: [{ field: 'consent', message: CONSENT_MESSAGE, code: 'custom' }],
      });
    }
    const rawCode = this.tokens.createRawToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
    await this.repository.transaction(async (tx) => {
      const user = await this.repository.findUserStatus(tx, userId);
      if (!user || user.status !== 'ACTIVE') {
        throw new NotFoundException({
          code: 'RESOURCE_NOT_FOUND',
          detail: 'Пользователь не найден.',
        });
      }
      await this.repository.replaceOpenCodes(tx, {
        userId,
        codeHash: this.tokens.digest(rawCode),
        consentedAt: now,
        expiresAt,
      });
      await this.repository.audit(tx, userId, {
        entityType: 'telegram_link',
        entityId: userId,
        action: 'TELEGRAM_LINK_REQUESTED',
        source: 'API',
        ...(meta.requestId ? { requestId: meta.requestId } : {}),
      });
    });
    const url = new URL(`https://t.me/${telegram.botUsername}`);
    url.searchParams.set('start', rawCode);
    return { url: url.toString(), expiresAt: expiresAt.toISOString() };
  }

  async unlinkFromWeb(userId: string, meta: Meta): Promise<void> {
    await this.repository.transaction((tx) =>
      this.repository.removeLink(tx, userId, {
        reason: 'web',
        source: 'API',
        ...(meta.requestId ? { requestId: meta.requestId } : {}),
      }),
    );
  }

  async handleUpdate(update: unknown): Promise<void> {
    const action = parseTelegramUpdate(update);
    switch (action.kind) {
      case 'start': {
        if (action.code === null) return this.delegate({ kind: 'help', chatId: action.chatId });
        const outcome = await this.linkChat(action.chatId, action.code);
        const buttons =
          outcome === 'linked'
            ? webButton(this.config.mail.webBaseUrl, 'Настройки', '/app/settings/telegram')
            : [];
        return this.reply(action.chatId, BOT_REPLIES[outcome], buttons);
      }
      case 'stop':
        await this.unlinkChat(action.chatId, 'stop');
        return this.reply(action.chatId, BOT_REPLIES.stopped);
      case 'blocked':
        await this.unlinkChat(action.chatId, 'blocked');
        return;
      case 'help':
      case 'command':
      case 'text':
      case 'callback':
        return this.delegate(action);
      case 'ignore':
        return;
    }
  }

  /** Commands, plain text and buttons belong to the command service; without it, the old help. */
  private async delegate(action: BotInput | { kind: 'help'; chatId: bigint }): Promise<void> {
    if (this.commands) return this.commands.handle(action);
    if (action.kind !== 'callback') return this.reply(action.chatId, BOT_REPLIES.help);
  }

  private async linkChat(chatId: bigint, code: string): Promise<LinkOutcome> {
    try {
      return await this.repository.transaction(async (tx) => {
        const now = new Date();
        const row = await this.repository.findOpenCode(tx, this.tokens.digest(code), now);
        if (!row || row.user.status !== 'ACTIVE') return 'invalid';
        const holder = await this.repository.findLinkByChat(tx, chatId);
        if (holder && holder.userId !== row.userId) return 'taken';
        if (!(await this.repository.consumeCode(tx, row.id, now))) return 'invalid';
        if (holder) {
          await this.repository.refreshLink(tx, holder.id, row.consentedAt, now);
          return 'linked';
        }
        await this.repository.removeLink(tx, row.userId, {
          reason: 'replaced',
          source: 'TELEGRAM',
        });
        const link = await this.repository.createLink(tx, {
          userId: row.userId,
          chatId,
          consentedAt: row.consentedAt,
          now,
        });
        await this.repository.audit(tx, row.userId, {
          entityType: 'telegram_link',
          entityId: link.id,
          action: 'TELEGRAM_LINKED',
          source: 'TELEGRAM',
        });
        return 'linked';
      });
    } catch (error) {
      // Two /start updates racing for the same chat: the unique chat_id decides.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return 'taken';
      }
      throw error;
    }
  }

  private async unlinkChat(chatId: bigint, reason: 'stop' | 'blocked'): Promise<void> {
    await this.repository.transaction(async (tx) => {
      const link = await this.repository.findLinkByChat(tx, chatId);
      if (link) await this.repository.removeLink(tx, link.userId, { reason, source: 'TELEGRAM' });
    });
  }

  /** Best effort: a failed reply (rate limit, network) never undoes the link. */
  private async reply(chatId: bigint, text: string, buttons: TelegramButton[] = []): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.sendMessage(chatId, text, buttons);
    } catch {
      // Only the bot's reply is lost; the error may carry nothing worth logging.
    }
  }
}
