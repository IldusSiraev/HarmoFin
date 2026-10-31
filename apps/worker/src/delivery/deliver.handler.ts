import { createHash, randomBytes } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import type { WorkerJobHandler } from '../job-runner.js';
import type { Mailer } from '../mail/mailer.js';
import {
  renderDigest,
  renderUrgent,
  type MailLinks,
  type RenderedMail,
} from '../mail/templates.js';
import type { ClaimedDelivery, DeliveryRepository } from './delivery.repository.js';
import { loadDigestContent } from './digest-content.js';
import { cancelReason, loadDeliveryFacts } from './eligibility.js';
import { loadUrgentContent } from './urgent-content.js';

export type DeliveryOutcome = 'sent' | 'cancelled' | 'retried' | 'failed';
export type DeliveryFailure = { deliveryId: string; errorName: string };

/** Same digest as apps/api/src/notification-settings/unsubscribe-token.ts. */
export function hashUnsubscribeToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function errorName(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code.slice(0, 64);
  return error instanceof Error ? error.name : 'Unknown error';
}

/**
 * Sends the email outbox. Every letter is re-checked right before sending, its text (and amounts,
 * only with consent) is built at that moment and never stored. A failure of one letter schedules a
 * retry for that letter only and the run moves on; the job itself completes. Only the delivery id
 * and the error class reach logs.
 */
export class DeliverNotificationsHandler implements WorkerJobHandler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: DeliveryRepository,
    private readonly mailer: Mailer,
    private readonly webBaseUrl: string,
    private readonly hooks: {
      onOutcome?: (kind: string, outcome: DeliveryOutcome) => void;
      onFailure?: (failure: DeliveryFailure) => void;
    } = {},
    private readonly batchSize = 20,
  ) {}

  async execute(now: Date, budgetId?: string): Promise<void> {
    const batch = await this.repository.claim(this.batchSize, now, budgetId);
    for (const delivery of batch) {
      try {
        const outcome = await this.deliver(delivery, now);
        this.hooks.onOutcome?.(delivery.kind, outcome);
      } catch (error) {
        const name = errorName(error);
        const failed = await this.repository.retryOrFail(delivery.id, delivery.attempts, now, name);
        this.hooks.onOutcome?.(delivery.kind, failed ? 'failed' : 'retried');
        this.hooks.onFailure?.({ deliveryId: delivery.id, errorName: name });
      }
    }
  }

  private async deliver(delivery: ClaimedDelivery, now: Date): Promise<'sent' | 'cancelled'> {
    const facts = await loadDeliveryFacts(this.prisma, delivery);
    const reason = cancelReason(delivery.kind, facts);
    if (reason) {
      await this.repository.cancel(delivery.id, reason);
      return 'cancelled';
    }
    const token = randomBytes(32).toString('base64url');
    const links: MailLinks = { webBaseUrl: this.webBaseUrl, unsubscribeToken: token };
    const mail = await this.render(delivery, facts.setting!.includeAmounts, links);
    if (!mail) {
      await this.repository.cancel(
        delivery.id,
        delivery.kind === 'DIGEST' ? 'DIGEST_EMPTY' : 'NOTIFICATION_MISSING',
      );
      return 'cancelled';
    }
    await this.repository.prepareToken(delivery.id, hashUnsubscribeToken(token));
    await this.mailer.send({ to: facts.user!.email, ...mail });
    await this.repository.markSent(delivery.id, now);
    return 'sent';
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
