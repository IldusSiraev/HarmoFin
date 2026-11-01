import type { PrismaClient } from '@prisma/client';

import {
  PermanentSendError,
  RetryLaterError,
  type ChannelSender,
  type SendResult,
} from '../delivery/channel-sender.js';
import type { ClaimedDelivery } from '../delivery/delivery.repository.js';
import { loadDigestContent } from '../delivery/digest-content.js';
import type { DeliveryFacts } from '../delivery/eligibility.js';
import { loadUrgentContent } from '../delivery/urgent-content.js';
import type { TelegramBotApi, TelegramMessage } from './bot-api.js';
import { renderTelegramDigest, renderTelegramUrgent } from './templates.js';
import { unlinkUnavailableChat } from './unlink.js';

const DEFAULT_RETRY_AFTER_SECONDS = 60;

/**
 * Messages to the linked private chat. Bot API answers: 429 waits for retry_after without spending
 * an attempt; 403 or "chat not found" unlinks the chat and cancels; other 4xx fail at once; 5xx and
 * network errors are retried by the handler.
 */
export class TelegramSender implements ChannelSender {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly api: Pick<TelegramBotApi, 'sendMessage'>,
    private readonly webBaseUrl: string,
  ) {}

  async send(delivery: ClaimedDelivery, facts: DeliveryFacts, now: Date): Promise<SendResult> {
    const link = await this.prisma.telegramLink.findUnique({
      where: { userId: delivery.userId },
      select: { chatId: true },
    });
    if (!link) return { outcome: 'cancelled', reason: 'TELEGRAM_NOT_LINKED' };
    const message = await this.render(delivery, facts.setting!.includeAmounts);
    if (!message) {
      return {
        outcome: 'cancelled',
        reason: delivery.kind === 'DIGEST' ? 'DIGEST_EMPTY' : 'NOTIFICATION_MISSING',
      };
    }

    const result = await this.api.sendMessage(link.chatId, message);
    if (result.ok) return { outcome: 'sent' };
    if (result.status === 429) {
      const seconds = result.retryAfter ?? DEFAULT_RETRY_AFTER_SECONDS;
      throw new RetryLaterError(new Date(now.getTime() + seconds * 1_000), 'TELEGRAM_429');
    }
    if (
      result.status === 403 ||
      (result.status === 400 && /chat not found/i.test(result.description))
    ) {
      await unlinkUnavailableChat(this.prisma, link.chatId);
      return { outcome: 'cancelled', reason: 'TELEGRAM_CHAT_UNAVAILABLE' };
    }
    if (result.status >= 400 && result.status < 500) {
      throw new PermanentSendError(`TELEGRAM_${result.status}`);
    }
    throw Object.assign(new Error('Telegram server error'), { code: `TELEGRAM_${result.status}` });
  }

  private async render(
    delivery: ClaimedDelivery,
    includeAmounts: boolean,
  ): Promise<TelegramMessage | null> {
    if (delivery.kind === 'URGENT') {
      const content = await loadUrgentContent(this.prisma, delivery, includeAmounts);
      return content ? renderTelegramUrgent(content, this.webBaseUrl) : null;
    }
    const content = await loadDigestContent(this.prisma, delivery, includeAmounts);
    return content ? renderTelegramDigest(content, this.webBaseUrl) : null;
  }
}
