import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient, type NotificationType } from '@prisma/client';

export class NotificationRuleHandler {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(now: Date, budgetId?: string): Promise<void> {
    const budgets = await this.prisma.budget.findMany({
      where: {
        status: 'ACTIVE',
        workspace: { status: 'ACTIVE' },
        ...(budgetId ? { id: budgetId } : {}),
      },
      select: {
        id: true,
        workspaceId: true,
        timezone: true,
        planModelVersion: true,
        workspace: { select: { ownerId: true } },
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
  planModelVersion: number;
  workspace: { ownerId: string };
};

type BalanceRecord = { id: string; name: string; balanceMinor: bigint };

async function evaluateBudget(
  tx: Prisma.TransactionClient,
  budget: ActiveBudget,
  now: Date,
): Promise<void> {
  if (budget.planModelVersion === 2) {
    await evaluateBudgetV2(tx, budget, now);
    return;
  }
  const today = localDate(now, budget.timezone);
  const upcoming = addDays(today, 3);
  const obligationEnd = addDays(today, 30);
  const ownerId = budget.workspace.ownerId;

  await Promise.all([
    createOccurrenceNotifications(tx, budget, ownerId, 'PLAN_UPCOMING', 'PENDING', upcoming),
    createOccurrenceNotifications(tx, budget, ownerId, 'PLAN_TODAY', 'DUE', today),
    createOverdueNotifications(tx, budget, ownerId, today),
  ]);

  const [unallocatedIncomeMinor, accounts, envelopes] = await Promise.all([
    unallocatedIncome(tx, budget.id),
    accountBalances(tx, budget.id),
    envelopeBalances(tx, budget.id),
  ]);

  await ensureStateNotification(
    tx,
    budget,
    ownerId,
    'UNALLOCATED_INCOME',
    'budget',
    budget.id,
    unallocatedIncomeMinor > 0n,
    'Есть нераспределённый доход',
    'Распределите доход по конвертам.',
    '/app/operations',
  );
  for (const account of accounts) {
    await ensureStateNotification(
      tx,
      budget,
      ownerId,
      'NEGATIVE_ACCOUNT',
      'account',
      account.id,
      account.balanceMinor < 0n,
      'Отрицательный остаток счёта',
      `Счёт «${account.name}» имеет отрицательный остаток.`,
      '/app/accounts',
    );
  }
  for (const envelope of envelopes) {
    await ensureStateNotification(
      tx,
      budget,
      ownerId,
      'NEGATIVE_ENVELOPE',
      'envelope',
      envelope.id,
      envelope.balanceMinor < 0n,
      'Отрицательный остаток конверта',
      `Конверт «${envelope.name}» имеет отрицательный остаток.`,
      '/app/envelopes',
    );
  }

  const mandatory = await tx.envelope.findMany({
    where: { budgetId: budget.id, archivedAt: null, envelopeType: 'MANDATORY_EXPENSES' },
    select: { id: true, name: true },
  });
  for (const envelope of mandatory) {
    const [balanceMinor, obligations] = await Promise.all([
      envelopeBalance(tx, budget.id, envelope.id),
      tx.planOccurrence.aggregate({
        where: {
          budgetId: budget.id,
          envelopeId: envelope.id,
          planType: 'EXPENSE',
          status: { in: ['PENDING', 'DUE'] },
          scheduledOn: { gte: dateValue(today), lte: dateValue(obligationEnd) },
        },
        _sum: { amountMinor: true },
      }),
    ]);
    const requiredMinor = obligations._sum.amountMinor ?? 0n;
    await ensureStateNotification(
      tx,
      budget,
      ownerId,
      'INSUFFICIENT_MANDATORY_OBLIGATIONS',
      'envelope',
      envelope.id,
      requiredMinor > balanceMinor,
      'Недостаточно средств на обязательства',
      `Конверту «${envelope.name}» не хватает средств на ближайшие обязательства.`,
      '/app/plans',
    );
  }
}

const LEGACY_STATE_TYPES: NotificationType[] = [
  'PLAN_UPCOMING',
  'UNALLOCATED_INCOME',
  'NEGATIVE_ACCOUNT',
  'NEGATIVE_ENVELOPE',
  'INSUFFICIENT_MANDATORY_OBLIGATIONS',
];

/**
 * Plan model 2: only occurrence-level due/overdue notifications. No balance SQL, no deficit or
 * "free money" rules (those are the actionable dashboard). The notification carries only ids, the
 * plan name and the date; amounts and remainders never go into title, body or audit payload.
 * "Remainder > 0" is evaluated only to decide whether the occurrence still needs attention.
 */
async function evaluateBudgetV2(
  tx: Prisma.TransactionClient,
  budget: ActiveBudget,
  now: Date,
): Promise<void> {
  const today = localDate(now, budget.timezone);
  const ownerId = budget.workspace.ownerId;
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
      payments: {
        where: {
          budgetId: budget.id,
          transaction: { status: 'CONFIRMED', deletedAt: null },
        },
        select: { transaction: { select: { amountMinor: true } } },
      },
    },
  });

  const active = new Set<string>();
  for (const occurrence of occurrences) {
    const paid = occurrence.payments.reduce((sum, item) => sum + item.transaction.amountMinor, 0n);
    if (occurrence.amountMinor - paid <= 0n) continue;
    const type = isoDate(occurrence.scheduledOn) < today ? 'PLAN_OVERDUE' : 'PLAN_TODAY';
    active.add(`${occurrence.id}:${type}`);
    await createOccurrenceNotification(tx, budget, ownerId, type, occurrence);
  }

  const unresolved = await tx.notification.findMany({
    where: {
      budgetId: budget.id,
      userId: ownerId,
      resolvedAt: null,
      OR: [
        { notificationType: { in: ['PLAN_TODAY', 'PLAN_OVERDUE'] }, occurrenceId: { not: null } },
        { notificationType: { in: LEGACY_STATE_TYPES } },
      ],
    },
    select: { id: true, notificationType: true, occurrenceId: true, actionPath: true },
  });
  for (const notification of unresolved) {
    const stillActive =
      notification.occurrenceId !== null &&
      active.has(`${notification.occurrenceId}:${notification.notificationType}`);
    if (stillActive) continue;
    const result = await tx.notification.updateMany({
      where: { id: notification.id, budgetId: budget.id, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
    if (result.count === 0) continue;
    await createNotificationAudit(tx, budget, ownerId, notification.id, {
      notificationType: notification.notificationType,
      occurrenceId: notification.occurrenceId,
      relatedEntityType: null,
      relatedEntityId: null,
      actionPath: notification.actionPath ?? '/app/plans',
      state: 'RESOLVED',
    });
  }
}

async function createOccurrenceNotifications(
  tx: Prisma.TransactionClient,
  budget: ActiveBudget,
  userId: string,
  type: 'PLAN_UPCOMING' | 'PLAN_TODAY',
  status: 'PENDING' | 'DUE',
  scheduledOn: string,
): Promise<void> {
  const occurrences = await tx.planOccurrence.findMany({
    where: { budgetId: budget.id, status, scheduledOn: dateValue(scheduledOn) },
    select: { id: true, planName: true, scheduledOn: true },
  });
  await Promise.all(
    occurrences.map((occurrence) =>
      createOccurrenceNotification(tx, budget, userId, type, occurrence),
    ),
  );
}

async function createOverdueNotifications(
  tx: Prisma.TransactionClient,
  budget: ActiveBudget,
  userId: string,
  today: string,
): Promise<void> {
  const occurrences = await tx.planOccurrence.findMany({
    where: { budgetId: budget.id, status: 'DUE', scheduledOn: { lt: dateValue(today) } },
    select: { id: true, planName: true, scheduledOn: true },
  });
  await Promise.all(
    occurrences.map((occurrence) =>
      createOccurrenceNotification(tx, budget, userId, 'PLAN_OVERDUE', occurrence),
    ),
  );
}

async function createOccurrenceNotification(
  tx: Prisma.TransactionClient,
  budget: ActiveBudget,
  userId: string,
  type: 'PLAN_UPCOMING' | 'PLAN_TODAY' | 'PLAN_OVERDUE',
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
  await createNotificationAudit(tx, budget, userId, notificationId, {
    notificationType: type,
    occurrenceId: occurrence.id,
    relatedEntityType: null,
    relatedEntityId: null,
    actionPath: `/app/plans?occurrence=${occurrence.id}`,
    state: 'CREATED',
  });
}

async function ensureStateNotification(
  tx: Prisma.TransactionClient,
  budget: ActiveBudget,
  userId: string,
  type: Exclude<NotificationType, 'PLAN_UPCOMING' | 'PLAN_TODAY' | 'PLAN_OVERDUE'>,
  relatedEntityType: string,
  relatedEntityId: string,
  active: boolean,
  title: string,
  body: string,
  actionPath: string,
): Promise<void> {
  const existing = await tx.notification.findFirst({
    where: {
      budgetId: budget.id,
      userId,
      notificationType: type,
      occurrenceId: null,
      relatedEntityType,
      relatedEntityId,
      resolvedAt: null,
    },
    select: { id: true },
  });
  if (active && existing) return;
  if (active) {
    const notificationId = randomUUID();
    const result = await tx.notification.createMany({
      data: {
        id: notificationId,
        workspaceId: budget.workspaceId,
        budgetId: budget.id,
        userId,
        notificationType: type,
        relatedEntityType,
        relatedEntityId,
        title,
        body,
        actionPath,
        notificationKey: `${type}:${relatedEntityType}:${relatedEntityId}:${notificationId}`,
      },
      skipDuplicates: true,
    });
    if (result.count > 0) {
      await createNotificationAudit(tx, budget, userId, notificationId, {
        notificationType: type,
        occurrenceId: null,
        relatedEntityType,
        relatedEntityId,
        actionPath,
        state: 'CREATED',
      });
    }
    return;
  }
  if (!existing) return;
  const resolvedAt = new Date();
  await tx.notification.update({ where: { id: existing.id }, data: { resolvedAt } });
  await createNotificationAudit(tx, budget, userId, existing.id, {
    notificationType: type,
    occurrenceId: null,
    relatedEntityType,
    relatedEntityId,
    actionPath,
    state: 'RESOLVED',
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

async function unallocatedIncome(tx: Prisma.TransactionClient, budgetId: string): Promise<bigint> {
  const rows = await tx.$queryRaw<{ amountMinor: bigint }[]>`
    SELECT (
      COALESCE((
        SELECT SUM("amount_minor")
        FROM "transactions"
        WHERE "budget_id" = ${budgetId}::uuid
          AND "transaction_type" = 'INCOME'
          AND "status" = 'CONFIRMED'
      ), 0)
      - COALESCE((
        SELECT SUM("amount_minor")
        FROM "income_allocations"
        WHERE "budget_id" = ${budgetId}::uuid
          AND "status" = 'CONFIRMED'
      ), 0)
    )::BIGINT AS "amountMinor"
  `;
  return rows[0]?.amountMinor ?? 0n;
}

async function accountBalances(
  tx: Prisma.TransactionClient,
  budgetId: string,
): Promise<BalanceRecord[]> {
  const accounts = await tx.account.findMany({
    where: { budgetId, archivedAt: null },
    select: { id: true, name: true },
  });
  return Promise.all(
    accounts.map(async (account) => ({
      ...account,
      balanceMinor: await accountBalance(tx, budgetId, account.id),
    })),
  );
}

async function envelopeBalances(
  tx: Prisma.TransactionClient,
  budgetId: string,
): Promise<BalanceRecord[]> {
  const envelopes = await tx.envelope.findMany({
    where: { budgetId, archivedAt: null },
    select: { id: true, name: true },
  });
  return Promise.all(
    envelopes.map(async (envelope) => ({
      ...envelope,
      balanceMinor: await envelopeBalance(tx, budgetId, envelope.id),
    })),
  );
}

async function accountBalance(
  tx: Prisma.TransactionClient,
  budgetId: string,
  accountId: string,
): Promise<bigint> {
  const rows = await tx.$queryRaw<{ balanceMinor: bigint }[]>`
    SELECT (
      account."starting_balance_minor"
      + COALESCE((
        SELECT SUM(transaction."amount_minor") FROM "transactions" AS transaction
        WHERE transaction."budget_id" = ${budgetId}::uuid
          AND transaction."account_id" = ${accountId}::uuid
          AND transaction."transaction_type" = 'INCOME'
          AND transaction."status" = 'CONFIRMED'
      ), 0)
      - COALESCE((
        SELECT SUM(transaction."amount_minor") FROM "transactions" AS transaction
        WHERE transaction."budget_id" = ${budgetId}::uuid
          AND transaction."account_id" = ${accountId}::uuid
          AND transaction."transaction_type" = 'EXPENSE'
          AND transaction."status" = 'CONFIRMED'
      ), 0)
      - COALESCE((
        SELECT SUM(part."amount_minor") FROM "transfer_parts" AS part
        INNER JOIN "transfers" AS transfer
          ON transfer."id" = part."transfer_id"
          AND transfer."budget_id" = part."budget_id"
        WHERE part."budget_id" = ${budgetId}::uuid
          AND part."source_account_id" = ${accountId}::uuid
          AND transfer."status" = 'CONFIRMED'
      ), 0)
      + COALESCE((
        SELECT SUM(part."amount_minor") FROM "transfer_parts" AS part
        INNER JOIN "transfers" AS transfer
          ON transfer."id" = part."transfer_id"
          AND transfer."budget_id" = part."budget_id"
        WHERE part."budget_id" = ${budgetId}::uuid
          AND part."destination_account_id" = ${accountId}::uuid
          AND transfer."status" = 'CONFIRMED'
      ), 0)
    )::BIGINT AS "balanceMinor"
    FROM "accounts" AS account
    WHERE account."id" = ${accountId}::uuid AND account."budget_id" = ${budgetId}::uuid
  `;
  return rows[0]?.balanceMinor ?? 0n;
}

async function envelopeBalance(
  tx: Prisma.TransactionClient,
  budgetId: string,
  envelopeId: string,
): Promise<bigint> {
  const rows = await tx.$queryRaw<{ balanceMinor: bigint }[]>`
    SELECT (
      envelope."starting_balance_minor"
      + COALESCE((
        SELECT SUM(allocation."amount_minor") FROM "income_allocations" AS allocation
        WHERE allocation."budget_id" = ${budgetId}::uuid
          AND allocation."envelope_id" = ${envelopeId}::uuid
          AND allocation."status" = 'CONFIRMED'
      ), 0)
      - COALESCE((
        SELECT SUM(transaction."amount_minor") FROM "transactions" AS transaction
        WHERE transaction."budget_id" = ${budgetId}::uuid
          AND transaction."envelope_id" = ${envelopeId}::uuid
          AND transaction."transaction_type" = 'EXPENSE'
          AND transaction."status" = 'CONFIRMED'
      ), 0)
      - COALESCE((
        SELECT SUM(part."amount_minor") FROM "transfer_parts" AS part
        INNER JOIN "transfers" AS transfer
          ON transfer."id" = part."transfer_id"
          AND transfer."budget_id" = part."budget_id"
        WHERE part."budget_id" = ${budgetId}::uuid
          AND part."source_envelope_id" = ${envelopeId}::uuid
          AND transfer."status" = 'CONFIRMED'
      ), 0)
      + COALESCE((
        SELECT SUM(part."amount_minor") FROM "transfer_parts" AS part
        INNER JOIN "transfers" AS transfer
          ON transfer."id" = part."transfer_id"
          AND transfer."budget_id" = part."budget_id"
        WHERE part."budget_id" = ${budgetId}::uuid
          AND part."destination_envelope_id" = ${envelopeId}::uuid
          AND transfer."status" = 'CONFIRMED'
      ), 0)
    )::BIGINT AS "balanceMinor"
    FROM "envelopes" AS envelope
    WHERE envelope."id" = ${envelopeId}::uuid AND envelope."budget_id" = ${budgetId}::uuid
  `;
  return rows[0]?.balanceMinor ?? 0n;
}

function occurrenceCopy(
  type: 'PLAN_UPCOMING' | 'PLAN_TODAY' | 'PLAN_OVERDUE',
  name: string,
  date: string,
) {
  if (type === 'PLAN_UPCOMING') {
    return { title: 'Скоро плановый платёж', body: `План «${name}» ожидается ${date}.` };
  }
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

function addDays(value: string, days: number): string {
  const date = dateValue(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
