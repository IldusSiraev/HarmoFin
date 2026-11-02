import type { PrismaClient } from '@prisma/client';

import type { WorkerJobHandler } from '../job-runner.js';
import {
  PermanentSendError,
  RetryLaterError,
  type ChannelSenders,
  type DeliveryChannel,
} from './channel-sender.js';
import type { ClaimedDelivery, DeliveryRepository } from './delivery.repository.js';
import { cancelReason, loadDeliveryFacts } from './eligibility.js';

export { hashUnsubscribeToken } from './email-sender.js';

export type DeliveryOutcome = 'sent' | 'cancelled' | 'retried' | 'failed';
export type DeliveryFailure = { deliveryId: string; errorName: string };

function errorName(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code.slice(0, 64);
  return error instanceof Error ? error.name : 'Unknown error';
}

/**
 * Sends the outbox through the sender of each row's channel. Only channels with a configured sender
 * are claimed. Every message is re-checked right before sending; its text (and amounts, only with
 * consent) is built at that moment and never stored. A failure of one message schedules a retry for
 * that message only and the run moves on. Only the delivery id and the error class reach logs.
 */
export class DeliverNotificationsHandler implements WorkerJobHandler {
  private readonly channels: DeliveryChannel[];

  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: DeliveryRepository,
    private readonly senders: ChannelSenders,
    private readonly hooks: {
      onOutcome?: (kind: string, outcome: DeliveryOutcome) => void;
      onFailure?: (failure: DeliveryFailure) => void;
    } = {},
    private readonly batchSize = 20,
  ) {
    this.channels = (['EMAIL', 'TELEGRAM', 'PUSH'] as const).filter((channel) => senders[channel]);
  }

  async execute(now: Date, budgetId?: string): Promise<void> {
    if (this.channels.length === 0) return;
    const batch = await this.repository.claim(this.batchSize, now, budgetId, this.channels);
    for (const delivery of batch) {
      try {
        const outcome = await this.deliver(delivery, now);
        this.hooks.onOutcome?.(delivery.kind, outcome);
      } catch (error) {
        const outcome = await this.handleError(delivery, error, now);
        this.hooks.onOutcome?.(delivery.kind, outcome);
      }
    }
  }

  private async deliver(delivery: ClaimedDelivery, now: Date): Promise<'sent' | 'cancelled'> {
    const sender = this.senders[delivery.channel];
    if (!sender) {
      await this.repository.cancel(delivery.id, 'CHANNEL_UNAVAILABLE');
      return 'cancelled';
    }
    const facts = await loadDeliveryFacts(this.prisma, delivery);
    const reason = cancelReason(delivery.kind, facts, delivery.channel);
    if (reason) {
      await this.repository.cancel(delivery.id, reason);
      return 'cancelled';
    }
    const result = await sender.send(delivery, facts, now);
    if (result.outcome === 'cancelled') {
      await this.repository.cancel(delivery.id, result.reason);
      return 'cancelled';
    }
    await this.markSentAfterSend(delivery.id, now);
    return 'sent';
  }

  private async handleError(
    delivery: ClaimedDelivery,
    error: unknown,
    now: Date,
  ): Promise<DeliveryOutcome> {
    const name = errorName(error);
    if (error instanceof RetryLaterError) {
      await this.repository.postpone(delivery.id, error.retryAt, name);
      return 'retried';
    }
    this.hooks.onFailure?.({ deliveryId: delivery.id, errorName: name });
    if (error instanceof PermanentSendError) {
      await this.repository.fail(delivery.id, name);
      return 'failed';
    }
    const failed = await this.repository.retryOrFail(delivery.id, delivery.attempts, now, name);
    return failed ? 'failed' : 'retried';
  }

  /**
   * The message is already out: a failing status write must not schedule a retry, or the recipient
   * gets a duplicate (and for email the first letter's unsubscribe link is overwritten). One more
   * write is tried; if that fails too, the failure is reported and the row is left to its lease.
   */
  private async markSentAfterSend(id: string, now: Date): Promise<void> {
    try {
      await this.repository.markSent(id, now);
    } catch {
      try {
        await this.repository.markSent(id, now);
      } catch (error) {
        this.hooks.onFailure?.({ deliveryId: id, errorName: errorName(error) });
      }
    }
  }
}
