import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import {
  NotificationRepository,
  type NotificationListInput,
  type NotificationRecord,
} from './notification.repository.js';

export type NotificationView = {
  id: string;
  budgetId: string;
  notificationType: string;
  occurrenceId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  title: string;
  body: string;
  actionPath: string | null;
  readAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

@Injectable()
export class NotificationApplicationService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(
    userId: string,
    budgetId: string,
    input: NotificationListInput,
  ): Promise<{ items: NotificationView[]; nextCursor: string | null }> {
    const budget = await this.repository.findAccessibleBudget(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const result = await this.repository.list(userId, budgetId, input);
    return {
      items: result.items.map((notification) => this.toView(notification)),
      nextCursor: result.nextCursor,
    };
  }

  async markRead(
    userId: string,
    budgetId: string,
    notificationId: string,
    key: string,
    requestId?: string,
  ): Promise<NotificationView> {
    const budget = await this.repository.findAccessibleBudget(userId, budgetId);
    if (!budget) throw resourceNotFound();
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<NotificationView>(
        tx,
        idempotencyInput(budgetId, userId, key, `notification.read:${notificationId}`, {}),
        async () => {
          const current = await this.repository.findForMutation(
            tx,
            userId,
            budgetId,
            notificationId,
          );
          if (!current) throw resourceNotFound();
          const notification = await this.repository.markRead(tx, current, userId, requestId);
          return { status: 200, body: this.toView(notification) };
        },
      );
      return result.body;
    });
  }

  async markAllRead(
    userId: string,
    budgetId: string,
    key: string,
    requestId?: string,
  ): Promise<{ updatedCount: number }> {
    const budget = await this.repository.findAccessibleBudget(userId, budgetId);
    if (!budget) throw resourceNotFound();
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<{ updatedCount: number }>(
        tx,
        idempotencyInput(budgetId, userId, key, 'notification.read-all', {}),
        async () => ({
          status: 200,
          body: {
            updatedCount: await this.repository.markAllRead(tx, userId, budgetId, requestId),
          },
        }),
      );
      return result.body;
    });
  }

  private toView(notification: NotificationRecord): NotificationView {
    return {
      id: notification.id,
      budgetId: notification.budgetId,
      notificationType: notification.notificationType,
      occurrenceId: notification.occurrenceId,
      relatedEntityType: notification.relatedEntityType,
      relatedEntityId: notification.relatedEntityId,
      title: notification.title,
      body: notification.body,
      actionPath: notification.actionPath,
      readAt: notification.readAt?.toISOString() ?? null,
      resolvedAt: notification.resolvedAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
    };
  }
}

function idempotencyInput(
  budgetId: string,
  actorUserId: string,
  key: string,
  operation: string,
  body: unknown,
) {
  return {
    budgetId,
    actorUserId,
    key,
    operation,
    requestHash: createHash('sha256').update(JSON.stringify({ operation, body })).digest('hex'),
  };
}
