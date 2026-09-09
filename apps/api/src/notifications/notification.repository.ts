import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { PrismaService } from '../database/prisma.service.js';

export type NotificationRecord = {
  id: string;
  budgetId: string;
  notificationType: string;
  occurrenceId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  title: string;
  body: string;
  actionPath: string | null;
  readAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

export type NotificationListInput = {
  state: 'unread' | 'read' | 'all';
  limit: number;
  cursor?: string | undefined;
};

export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  runTransaction<T>(write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(write);
  }

  findAccessibleBudget(userId: string, budgetId: string) {
    return this.prisma.budget.findFirst({
      where: activeBudgetWhere(userId, budgetId),
      select: { id: true, workspaceId: true },
    });
  }

  async list(userId: string, budgetId: string, input: NotificationListInput) {
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    const rows = await this.prisma.notification.findMany({
      where: {
        budgetId,
        userId,
        budget: activeBudgetWhere(userId, budgetId),
        ...(input.state === 'unread' ? { readAt: null } : {}),
        ...(input.state === 'read' ? { readAt: { not: null } } : {}),
        ...(cursor ? cursorCondition(cursor) : {}),
      },
      select: notificationSelect,
      orderBy: [{ readAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
    });
    const hasNext = rows.length > input.limit;
    const items = hasNext ? rows.slice(0, input.limit) : rows;
    return { items, nextCursor: hasNext && items.at(-1) ? encodeCursor(items.at(-1)!) : null };
  }

  async findForMutation(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    notificationId: string,
  ): Promise<NotificationRecord | null> {
    const accessible = await tx.notification.findFirst({
      where: { id: notificationId, budgetId, userId, budget: activeBudgetWhere(userId, budgetId) },
      select: { id: true },
    });
    if (!accessible) return null;
    await tx.$queryRaw`
      SELECT "id" FROM "notifications"
      WHERE "id" = ${notificationId}::uuid
        AND "budget_id" = ${budgetId}::uuid
        AND "user_id" = ${userId}::uuid
      FOR UPDATE
    `;
    return tx.notification.findFirst({
      where: { id: notificationId, budgetId, userId, budget: activeBudgetWhere(userId, budgetId) },
      select: notificationSelect,
    });
  }

  async markRead(
    tx: Prisma.TransactionClient,
    current: NotificationRecord,
    userId: string,
    requestId?: string,
  ): Promise<NotificationRecord> {
    if (current.readAt) return current;
    const readAt = new Date();
    const notification = await tx.notification.update({
      where: { id: current.id },
      data: { readAt },
      select: notificationSelect,
    });
    await this.createAudit(tx, notification, userId, requestId, 'READ', current);
    return notification;
  }

  async markAllRead(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    requestId?: string,
  ): Promise<number> {
    const notifications = await tx.notification.findMany({
      where: { budgetId, userId, readAt: null, budget: activeBudgetWhere(userId, budgetId) },
      select: notificationSelect,
    });
    if (notifications.length === 0) return 0;
    const readAt = new Date();
    await tx.notification.updateMany({
      where: { id: { in: notifications.map((notification) => notification.id) } },
      data: { readAt },
    });
    await Promise.all(
      notifications.map((notification) =>
        this.createAudit(tx, { ...notification, readAt }, userId, requestId, 'READ', notification),
      ),
    );
    return notifications.length;
  }

  private async createAudit(
    tx: Prisma.TransactionClient,
    notification: NotificationRecord,
    userId: string,
    requestId: string | undefined,
    action: string,
    previous?: NotificationRecord,
  ) {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: userId,
        workspaceId: await workspaceIdFor(tx, notification.budgetId),
        budgetId: notification.budgetId,
        entityType: 'notification',
        entityId: notification.id,
        action,
        source: 'API',
        requestId: requestId ?? null,
        ...(previous ? { oldValues: auditValues(previous) } : {}),
        newValues: auditValues(notification),
      },
    });
  }
}

async function workspaceIdFor(tx: Prisma.TransactionClient, budgetId: string): Promise<string> {
  const budget = await tx.budget.findUniqueOrThrow({
    where: { id: budgetId },
    select: { workspaceId: true },
  });
  return budget.workspaceId;
}

function auditValues(notification: NotificationRecord) {
  return {
    notificationType: notification.notificationType,
    occurrenceId: notification.occurrenceId,
    relatedEntityType: notification.relatedEntityType,
    relatedEntityId: notification.relatedEntityId,
    actionPath: notification.actionPath,
    readAt: notification.readAt?.toISOString() ?? null,
    resolvedAt: notification.resolvedAt?.toISOString() ?? null,
  };
}

function activeBudgetWhere(userId: string, budgetId: string) {
  return {
    id: budgetId,
    status: 'ACTIVE' as const,
    workspace: {
      status: 'ACTIVE' as const,
      memberships: { some: { userId, isActive: true } },
    },
  };
}

type NotificationCursor = { v: 1; unread: boolean; createdAt: string; id: string };

function encodeCursor(row: { readAt: Date | null; createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      unread: row.readAt === null,
      createdAt: row.createdAt.toISOString(),
      id: row.id,
    }),
  ).toString('base64url');
}

function decodeCursor(value: string): NotificationCursor {
  try {
    const cursor = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Partial<NotificationCursor>;
    if (
      cursor.v !== 1 ||
      typeof cursor.unread !== 'boolean' ||
      typeof cursor.createdAt !== 'string' ||
      typeof cursor.id !== 'string' ||
      Number.isNaN(new Date(cursor.createdAt).getTime()) ||
      !isUuid(cursor.id)
    ) {
      throw new Error();
    }
    return cursor as NotificationCursor;
  } catch {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      detail: 'Некорректный курсор уведомлений.',
    });
  }
}

function cursorCondition(cursor: NotificationCursor): Prisma.NotificationWhereInput {
  const createdAt = new Date(cursor.createdAt);
  if (cursor.unread) {
    return {
      OR: [
        { readAt: null, createdAt: { lt: createdAt } },
        { readAt: null, createdAt, id: { lt: cursor.id } },
        { readAt: { not: null } },
      ],
    };
  }
  return {
    readAt: { not: null },
    OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: cursor.id } }],
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const notificationSelect = {
  id: true,
  budgetId: true,
  notificationType: true,
  occurrenceId: true,
  relatedEntityType: true,
  relatedEntityId: true,
  title: true,
  body: true,
  actionPath: true,
  readAt: true,
  resolvedAt: true,
  createdAt: true,
} as const;
