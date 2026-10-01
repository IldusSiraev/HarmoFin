import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient, type PlanOccurrenceStatus } from '@prisma/client';

import { datesForPlanInWindow } from './recurrence.js';

export class PlanOccurrenceHandler {
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
        planModelActivatedOn: true,
      },
    });
    for (const budget of budgets) {
      const today = localDate(now, budget.timezone);
      await this.prisma.$transaction(async (tx) => {
        await transitionDueOccurrences(tx, budget.workspaceId, budget.id, today);
        if (budget.planModelVersion === 2 && budget.planModelActivatedOn) {
          await materializeV2Occurrences(
            tx,
            budget.workspaceId,
            budget.id,
            today,
            isoDate(budget.planModelActivatedOn),
          );
        } else {
          await materializeOccurrences(tx, budget.workspaceId, budget.id, today);
        }
      });
    }
  }
}

async function transitionDueOccurrences(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  budgetId: string,
  today: string,
): Promise<void> {
  const records = await tx.planOccurrence.findMany({
    where: { budgetId, status: 'PENDING', scheduledOn: { lte: dateValue(today) } },
    select: occurrenceAuditSelect,
  });
  if (records.length === 0) return;

  await tx.planOccurrence.updateMany({
    where: { id: { in: records.map((record) => record.id) } },
    data: { status: 'DUE' },
  });
  await Promise.all(
    records.map((record) =>
      tx.auditEvent.create({
        data: {
          id: randomUUID(),
          actorUserId: null,
          workspaceId,
          budgetId,
          entityType: 'plan_occurrence',
          entityId: record.id,
          action: 'DUE',
          source: 'WORKER',
          newValues: occurrenceAuditValues(record, 'DUE'),
        },
      }),
    ),
  );
}

/**
 * v2 budgets: materialize mandatory EXPENSE plans from max(plan.startOn, activation) to today+60
 * (not limited to today-7, so a long worker downtime still yields past-due obligations). Rows
 * already present in any status are never rewritten; plan rows are locked to prevent duplicates.
 */
async function materializeV2Occurrences(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  budgetId: string,
  today: string,
  activatedOn: string,
): Promise<void> {
  const to = addDays(today, 60);
  await tx.$queryRaw`
    SELECT "id" FROM "regular_plans"
    WHERE "budget_id" = ${budgetId}::uuid AND "is_active" = true AND "deleted_at" IS NULL
    ORDER BY "id"
    FOR UPDATE
  `;
  const plans = await tx.regularPlan.findMany({
    where: {
      budgetId,
      isActive: true,
      deletedAt: null,
      planType: 'EXPENSE',
      startOn: { lte: dateValue(to) },
      OR: [{ endOn: null }, { endOn: { gte: dateValue(activatedOn) } }],
      envelope: { is: { budgetId, envelopeType: 'MANDATORY_EXPENSES', archivedAt: null } },
    },
    select: planSelect,
    orderBy: { id: 'asc' },
  });
  if (plans.length === 0) return;
  const existing = await tx.planOccurrence.findMany({
    where: {
      budgetId,
      planId: { in: plans.map((plan) => plan.id) },
      scheduledOn: { gte: dateValue(activatedOn), lte: dateValue(to) },
    },
    select: { planId: true, scheduledOn: true },
  });
  const known = new Set(existing.map((row) => `${row.planId}:${isoDate(row.scheduledOn)}`));

  for (const plan of plans) {
    const startOn = isoDate(plan.startOn);
    const from = startOn >= activatedOn ? startOn : activatedOn;
    const rows: Array<{ id: string; date: string; status: PlanOccurrenceStatus }> = [];
    for (const date of datesForPlanInWindow(
      {
        anchorOn: isoDate(plan.anchorOn),
        startOn,
        endOn: plan.endOn ? isoDate(plan.endOn) : null,
        recurrence: plan.recurrence,
        intervalMonths: plan.intervalMonths,
      },
      { from, to },
    )) {
      const key = `${plan.id}:${date}`;
      if (known.has(key)) continue;
      known.add(key);
      rows.push({ id: randomUUID(), date, status: date <= today ? 'DUE' : 'PENDING' });
    }
    if (rows.length === 0) continue;
    await tx.planOccurrence.createMany({
      data: rows.map((row) => ({
        id: row.id,
        workspaceId,
        budgetId,
        planId: plan.id,
        scheduledOn: dateValue(row.date),
        planName: plan.name,
        planType: plan.planType,
        amountMinor: plan.amountMinor,
        currency: plan.currency,
        scale: plan.scale,
        accountId: plan.accountId,
        categoryId: plan.categoryId,
        envelopeId: plan.envelopeId,
        comment: plan.comment,
        status: row.status,
      })),
    });
    await Promise.all(
      rows.map((row) =>
        tx.auditEvent.create({
          data: {
            id: randomUUID(),
            actorUserId: null,
            workspaceId,
            budgetId,
            entityType: 'plan_occurrence',
            entityId: row.id,
            action: 'CREATED',
            source: 'WORKER',
            newValues: occurrenceAuditValues(
              {
                planId: plan.id,
                scheduledOn: dateValue(row.date),
                planType: plan.planType,
                amountMinor: plan.amountMinor,
                status: row.status,
                transactionId: null,
                cancellationReason: null,
              },
              row.status,
            ),
          },
        }),
      ),
    );
  }
}

const planSelect = {
  id: true,
  name: true,
  planType: true,
  amountMinor: true,
  currency: true,
  scale: true,
  anchorOn: true,
  startOn: true,
  endOn: true,
  recurrence: true,
  intervalMonths: true,
  accountId: true,
  categoryId: true,
  envelopeId: true,
  comment: true,
} as const;

async function materializeOccurrences(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  budgetId: string,
  today: string,
): Promise<void> {
  const from = addDays(today, -7);
  const to = addDays(today, 60);
  const plans = await tx.regularPlan.findMany({
    where: {
      budgetId,
      isActive: true,
      deletedAt: null,
      startOn: { lte: dateValue(to) },
      OR: [{ endOn: null }, { endOn: { gte: dateValue(from) } }],
    },
    select: {
      id: true,
      name: true,
      planType: true,
      amountMinor: true,
      currency: true,
      scale: true,
      anchorOn: true,
      startOn: true,
      endOn: true,
      recurrence: true,
      intervalMonths: true,
      accountId: true,
      categoryId: true,
      envelopeId: true,
      comment: true,
    },
  });

  for (const plan of plans) {
    for (const scheduledOn of datesForPlanInWindow(
      {
        anchorOn: isoDate(plan.anchorOn),
        startOn: isoDate(plan.startOn),
        endOn: plan.endOn ? isoDate(plan.endOn) : null,
        recurrence: plan.recurrence,
        intervalMonths: plan.intervalMonths,
      },
      { from, to },
    )) {
      const occurrenceId = randomUUID();
      const date = dateValue(scheduledOn);
      const result = await tx.planOccurrence.createMany({
        data: {
          id: occurrenceId,
          workspaceId,
          budgetId,
          planId: plan.id,
          scheduledOn: date,
          planName: plan.name,
          planType: plan.planType,
          amountMinor: plan.amountMinor,
          currency: plan.currency,
          scale: plan.scale,
          accountId: plan.accountId,
          categoryId: plan.categoryId,
          envelopeId: plan.envelopeId,
          comment: plan.comment,
        },
        skipDuplicates: true,
      });
      if (result.count === 0) continue;
      await tx.auditEvent.create({
        data: {
          id: randomUUID(),
          actorUserId: null,
          workspaceId,
          budgetId,
          entityType: 'plan_occurrence',
          entityId: occurrenceId,
          action: 'CREATED',
          source: 'WORKER',
          newValues: occurrenceAuditValues(
            {
              planId: plan.id,
              scheduledOn: date,
              planType: plan.planType,
              amountMinor: plan.amountMinor,
              status: 'PENDING',
              transactionId: null,
              cancellationReason: null,
            },
            'PENDING',
          ),
        },
      });
    }
  }
}

const occurrenceAuditSelect = {
  id: true,
  planId: true,
  scheduledOn: true,
  planType: true,
  amountMinor: true,
  status: true,
  transactionId: true,
  cancellationReason: true,
} as const;

function occurrenceAuditValues(
  occurrence: {
    planId: string;
    scheduledOn: Date;
    planType: string;
    amountMinor: bigint;
    status: PlanOccurrenceStatus;
    transactionId: string | null;
    cancellationReason: string | null;
  },
  status: PlanOccurrenceStatus,
) {
  return {
    planId: occurrence.planId,
    scheduledOn: isoDate(occurrence.scheduledOn),
    planType: occurrence.planType,
    amountMinor: occurrence.amountMinor.toString(),
    status,
    transactionId: occurrence.transactionId,
    cancellationReason: occurrence.cancellationReason,
  };
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
