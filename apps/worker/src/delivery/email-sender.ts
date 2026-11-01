import { createHash, randomBytes } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import type { Mailer } from '../mail/mailer.js';
import {
  renderDigest,
  renderUrgent,
  type MailLinks,
  type RenderedMail,
} from '../mail/templates.js';
import type { ChannelSender, SendResult } from './channel-sender.js';
import type { ClaimedDelivery, DeliveryRepository } from './delivery.repository.js';
import { loadDigestContent } from './digest-content.js';
import type { DeliveryFacts } from './eligibility.js';
import { loadUrgentContent } from './urgent-content.js';

/** Same digest as apps/api/src/notification-settings/unsubscribe-token.ts. */
export function hashUnsubscribeToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Letters over SMTP. A fresh unsubscribe token is minted per letter; only its SHA-256 is stored,
 * before sending, so the link in a delivered letter works even if the status write fails.
 */
export class EmailSender implements ChannelSender {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: DeliveryRepository,
    private readonly mailer: Mailer,
    private readonly webBaseUrl: string,
  ) {}

  async send(delivery: ClaimedDelivery, facts: DeliveryFacts): Promise<SendResult> {
    const token = randomBytes(32).toString('base64url');
    const links: MailLinks = { webBaseUrl: this.webBaseUrl, unsubscribeToken: token };
    const mail = await this.render(delivery, facts.setting!.includeAmounts, links);
    if (!mail) {
      return {
        outcome: 'cancelled',
        reason: delivery.kind === 'DIGEST' ? 'DIGEST_EMPTY' : 'NOTIFICATION_MISSING',
      };
    }
    await this.repository.prepareToken(delivery.id, hashUnsubscribeToken(token));
    await this.mailer.send({ to: facts.user!.email, ...mail });
    return { outcome: 'sent' };
  }

  private async render(
    delivery: ClaimedDelivery,
    includeAmounts: boolean,
    links: MailLinks,
  ): Promise<RenderedMail | null> {
    if (delivery.kind === 'URGENT') {
      const content = await loadUrgentContent(this.prisma, delivery, includeAmounts);
      return content ? renderUrgent(content, links) : null;
    }
    const content = await loadDigestContent(this.prisma, delivery, includeAmounts);
    return content ? renderDigest(content, links) : null;
  }
}
