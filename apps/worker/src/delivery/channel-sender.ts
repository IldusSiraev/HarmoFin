import type { ClaimedDelivery } from './delivery.repository.js';
import type { DeliveryFacts } from './eligibility.js';

export type DeliveryChannel = 'EMAIL' | 'TELEGRAM' | 'PUSH';

/** Channels that receive the family digest; push carries urgent notifications only. */
export type DigestChannel = Exclude<DeliveryChannel, 'PUSH'>;

export type SendResult = { outcome: 'sent' } | { outcome: 'cancelled'; reason: string };

/**
 * Builds and sends one message of its channel. Called only after the common re-check passed.
 * Returns `cancelled` when there is nothing to send; throws to retry (see the error classes).
 */
export interface ChannelSender {
  send(delivery: ClaimedDelivery, facts: DeliveryFacts, now: Date): Promise<SendResult>;
}

export type ChannelSenders = Partial<Record<DeliveryChannel, ChannelSender>>;

/** Try again at `retryAt` without spending an attempt (Telegram 429 with retry_after). */
export class RetryLaterError extends Error {
  constructor(
    readonly retryAt: Date,
    readonly code: string,
  ) {
    super(code);
    this.name = 'RetryLaterError';
  }
}

/** The message can never be delivered as is (Telegram 4xx): fail at once, no retries. */
export class PermanentSendError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PermanentSendError';
  }
}
