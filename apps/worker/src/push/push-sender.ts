import type { PrismaClient } from '@prisma/client';

import {
  PermanentSendError,
  RetryLaterError,
  type ChannelSender,
  type SendResult,
} from '../delivery/channel-sender.js';
import type { ClaimedDelivery } from '../delivery/delivery.repository.js';
import type { DeliveryFacts } from '../delivery/eligibility.js';
import { loadUrgentContent } from '../delivery/urgent-content.js';
import { pushTopic, renderPushPayload } from './payload.js';
import { activeSessionWhere, removePushSubscriptions } from './subscriptions.js';
import { summarizePush, type DeviceOutcome } from './summary.js';
import type { PushTransport } from './web-push-transport.js';

const TTL_SECONDS = 43_200;

/**
 * One urgent notification to every device of the user's active sessions, never with amounts.
 * Devices subscribed with another VAPID key, or answered 404/410/403, are removed. Any transient
 * failure retries the whole row: a retried push carries the same tag, so a device that already
 * shows it replaces it silently.
 */
export class PushSender implements ChannelSender {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly transport: PushTransport,
    private readonly vapidPublicKey: string,
  ) {}

  async send(delivery: ClaimedDelivery, _facts: DeliveryFacts, now: Date): Promise<SendResult> {
    if (delivery.kind !== 'URGENT' || !delivery.notificationId) {
      return { outcome: 'cancelled', reason: 'DIGEST_DISABLED' };
    }
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId: delivery.userId, session: activeSessionWhere(now) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, endpoint: true, p256dh: true, auth: true, applicationServerKey: true },
    });
    await removePushSubscriptions(
      this.prisma,
      subscriptions
        .filter((row) => row.applicationServerKey !== this.vapidPublicKey)
        .map((row) => row.id),
      'key',
    );
    const targets = subscriptions.filter((row) => row.applicationServerKey === this.vapidPublicKey);
    if (targets.length === 0) return { outcome: 'cancelled', reason: 'PUSH_NO_DEVICES' };

    const content = await loadUrgentContent(this.prisma, delivery, false);
    if (!content) return { outcome: 'cancelled', reason: 'NOTIFICATION_MISSING' };
    const payload = JSON.stringify(renderPushPayload(content, delivery.notificationId));
    const options = { ttlSeconds: TTL_SECONDS, topic: pushTopic(delivery.notificationId) };

    const outcomes: DeviceOutcome[] = [];
    for (const target of targets) {
      try {
        const result = await this.transport.send(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          payload,
          options,
        );
        outcomes.push({ id: target.id, result });
      } catch {
        outcomes.push({ id: target.id, result: 'network' });
      }
    }
    const summary = summarizePush(outcomes, now);
    if (summary.delivered.length > 0) {
      await this.prisma.pushSubscription.updateMany({
        where: { id: { in: summary.delivered } },
        data: { lastSuccessAt: now },
      });
    }
    await removePushSubscriptions(this.prisma, summary.gone, 'gone');

    if (summary.transient) {
      throw Object.assign(new Error('Push service error'), { code: summary.transient });
    }
    if (summary.retryAt) throw new RetryLaterError(summary.retryAt, 'PUSH_429');
    if (summary.delivered.length > 0) return { outcome: 'sent' };
    if (summary.permanent) throw new PermanentSendError(summary.permanent);
    return { outcome: 'cancelled', reason: 'PUSH_NO_DEVICES' };
  }
}
