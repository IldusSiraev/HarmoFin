import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import { enqueueUrgentEmail } from './delivery/enqueue.js';

/**
 * Срочное письмо ставится в очередь в той же транзакции, только для только что созданного
 * уведомления.
 */
export class NotificationRuleHandler {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(now: Date, budgetId?: string): Promise<void> {
    const budgets = await this.prisma.budget.findMany({
      where: {
        status: 'ACTIVE',
        // Only plan model 2 budgets are supported; any other budget is skipped untouched.
        planModelVersion: 2,
        workspace: { status: 'ACTIVE' },
        ...(budgetId ? { id: budgetId } : {}),
      },
      select: {
        id: true,
        workspaceId: true,
        timezone: true,
        workspace: {
          select: {
            memberships: {
              where: { isActive: true, role: { in: ['OWNER', 'EDITOR'] } },
              select: { userId: true },
            },
          },
        },
      },
    });
    for (const budget of budgets) {
      await this.prisma.$transaction(async (tx) => {
        await evaluateBudget(tx, budget, now);
      });
    }
  }
}

type ActiveBudget = {
  id: string;
  workspaceId: string;
  timezone: string;
  workspace: { memberships: Array<{ userId: string }> };
};

/**
 * Plan model 2: only occurrence-level due/overdue notifications. No balance SQL, no deficit or
 * "free money" rules (those are the actionable dashboard). The notification carries only ids, the
 * plan name and the date; amounts and remainders never go into title, body or audit payload.
 * "Remainder > 0" is evaluated only to decide whether the occurrence still needs attention.
 * Recipient is the plan owner when they are an active OWNER or EDITOR; open plan notifications
 * of anyone else are resolved.
 */
async function evaluateBudget(
  tx: Prisma.TransactionClient,
  budget: ActiveBudget,
  now: Date,
): Promise<void> {
  const today = localDate(now, budget.timezone);
  const recipientIds = budget.workspace.memberships.map((membership) => membership.userId);
  const occurrences = await tx.planOccurrence.findMany({
    where: {
      budgetId: budget.id,
      status: { in: ['PENDING', 'DUE'] },
      scheduledOn: { lte: dateValue(today) },
    },
    select: {
      id: true,
      planName: true,
      planType: true,
      scheduledOn: true,
      amountMinor: true,
      plan: { select: { ownerUserId: true } },
      payments: {
        where: {
          budgetId: budget.id,
          transaction: { status: 'CONFIRMED', deletedAt: null },
        },
        select: { transaction: { select: { amountMinor: true } } },
      },
    },
  });

  const writers = new Set(recipientIds);
  const active = new Set<string>();
  for (const occurrence of occurrences) {
    const paid = occurrence.payments.reduce((sum, item) => sum + item.transaction.amountMinor, 0n);
    if (occurrence.amountMinor - paid <= 0n) continue;
    const ownerId = occurrence.plan.ownerUserId;
    // A plan of a member who left already belongs to the creator (same transaction as leaving).
    if (!writers.has(ownerId)) continue;
    const type = isoDate(occurrence.scheduledOn) < today ? 'PLAN_OVERDUE' : 'PLAN_TODAY';
    active.add(`${occurrence.id}:${type}:${ownerId}`);
    await createOccurrenceNotification(tx, budget, ownerId, type, occurrence);
  }

  const unresolved = await tx.notification.findMany({
    where: {
      budgetId: budget.id,
      userId: { in: recipientIds },
      resolvedAt: null,
      notificationType: { in: ['PLAN_TODAY', 'PLAN_OVERDUE'] },
      occurrenceId: { not: null },
    },
    select: {
      id: true,
      userId: true,
      notificationType: true,
      occurrenceId: true,
      actionPath: true,
    },
  });
  for (const notification of unresolved) {
    const stillActive =
      notification.occurrenceId !== null &&
      active.has(
        `${notification.occurrenceId}:${notification.notificationType}:${notification.userId}`,
      );
    if (stillActive) continue;
    await resolveNotification(tx, budget, notification);
  }

  const forExRecipients = await tx.notification.findMany({
    where: {
      budgetId: budget.id,
      resolvedAt: null,
      notificationType: { in: ['PLAN_TODAY', 'PLAN_OVERDUE'] },
      userId: { notIn: recipientIds },
    },
    select: {
      id: true,
      userId: true,
      notificationType: true,
      occurrenceId: true,
      actionPath: true,
    },
  });
  for (const notification of forExRecipients) {
    await resolveNotification(tx, budget, notification);
  }
}

async function resolveNotification(
  tx: Prisma.TransactionClient,
  budget: ActiveBudget,
  notification: {
    id: string;
    userId: string;
    notificationType: string;
    occurrenceId: string | null;
    actionPath: string | null;
  },
): Promise<void> {
  const result = await tx.notification.updateMany({
    where: { id: notification.id, budgetId: budget.id, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  if (result.count === 0) return;
  await createNotificationAudit(tx, budget, notification.userId, notification.id, {
    notificationType: notification.notificationType,
    occurrenceId: notification.occurrenceId,
    relatedEntityType: null,
    relatedEntityId: null,
    actionPath: notification.actionPath ?? '/app/plans',
    state: 'RESOLVED',
  });
}

async function createOccurrenceNotification(
  tx: Prisma.TransactionClient,
  budget: ActiveBudget,
  userId: string,
  type: 'PLAN_TODAY' | 'PLAN_OVERDUE',
  occurrence: { id: string; planName: string; scheduledOn: Date },
): Promise<void> {
  const copy = occurrenceCopy(type, occurrence.planName, isoDate(occurrence.scheduledOn));
  const notificationId = randomUUID();
  const result = await tx.notification.createMany({
    data: {
      id: notificationId,
      workspaceId: budget.workspaceId,
      budgetId: budget.id,
      userId,
      notificationType: type,
      occurrenceId: occurrence.id,
      title: copy.title,
      body: copy.body,
      actionPath: `/app/plans?occurrence=${occurrence.id}`,
      notificationKey: `occurrence:${occurrence.id}:${type}`,
    },
    skipDuplicates: true,
  });
  if (result.count === 0) return;
  if (type === 'PLAN_OVERDUE') {
    await enqueueUrgentEmail(tx, {
      notificationId,
      workspaceId: budget.workspaceId,
      budgetId: budget.id,
      userId,
      now: new Date(),
    });
  }
  await createNotificationAudit(tx, budget, userId, notificationId, {
    notificationType: type,
    occurrenceId: occurrence.id,
    relatedEntityType: null,
    relatedEntityId: null,
    actionPath: `/app/plans?occurrence=${occurrence.id}`,
    state: 'CREATED',
  });
}

async function createNotificationAudit(
  tx: Prisma.TransactionClient,
  budget: ActiveBudget,
  userId: string,
  notificationId: string,
  values: {
    notificationType: string;
    occurrenceId: string | null;
    relatedEntityType: string | null;
    relatedEntityId: string | null;
    actionPath: string;
    state: 'CREATED' | 'RESOLVED';
  },
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      id: randomUUID(),
      actorUserId: null,
      workspaceId: budget.workspaceId,
      budgetId: budget.id,
      entityType: 'notification',
      entityId: notificationId,
      action: values.state,
      source: 'WORKER',
      newValues: values,
    },
  });
}

function occurrenceCopy(type: 'PLAN_TODAY' | 'PLAN_OVERDUE', name: string, date: string) {
  if (type === 'PLAN_TODAY') {
    return { title: 'Плановый платёж сегодня', body: `Сегодня запланировано: «${name}».` };
  }
  return { title: 'Просроченный план', body: `План «${name}» просрочен с ${date}.` };
}

function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
