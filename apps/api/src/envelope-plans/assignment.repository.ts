import { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { resourceNotFound } from '../common/reference-data/reference-data.errors.js';

export type EnvelopeRecord = {
  id: string;
  archivedAt: Date | null;
  hasPeriods: boolean;
};

export type PeriodRecord = {
  id: string;
  startsOn: Date;
  endsOn: Date;
};

export type AssignmentCreateParams = {
  budgetId: string;
  workspaceId: string;
  actorUserId: string;
  envelopeId: string;
  periodId: string | null;
  sourceKind: 'OPENING' | 'FREE' | 'INCOME';
  amountMinor: bigint;
  effectiveOn: Date;
  sourceIncomeTransactionId: string | null;
  requestId?: string | undefined;
};

export type IncomeRecord = {
  id: string;
  amountMinor: bigint;
};

export type AssignmentModifyParams = {
  budgetId: string;
  workspaceId: string;
  actorUserId: string;
  assignmentId: string;
  oldAmountMinor: bigint;
  requestId?: string | undefined;
};

export type LockedAssignment = {
  id: string;
  amountMinor: bigint;
  status: 'CONFIRMED' | 'DELETED';
  type: 'OPENING' | 'FREE' | 'INCOME';
  effectiveOn: Date;
  envelopeId: string;
  periodId: string | null;
  sourceIncomeTransactionId: string | null;
};

type RawLockedAssignment = {
  id: unknown;
  amount_minor: string | bigint | number;
  status: string;
  type: string;
  effective_on: string | Date;
  envelope_id: unknown;
  period_id: string | null;
  source_income_transaction_id: string | null;
};

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(`${value}T00:00:00Z`);
}

export class AssignmentRepository {
  async lockBudget(tx: Prisma.TransactionClient, budgetId: string): Promise<void> {
    await tx.$queryRaw`
      SELECT "id" FROM "budgets"
      WHERE "id" = ${budgetId}::uuid
      FOR UPDATE
    `;
  }

  async requireBudgetTimezone(tx: Prisma.TransactionClient, budgetId: string): Promise<string> {
    const budget = await tx.budget.findUnique({
      where: { id: budgetId },
      select: { timezone: true },
    });
    if (!budget) {
      throw resourceNotFound();
    }
    return budget.timezone;
  }

  async lockIncome(
    tx: Prisma.TransactionClient,
    budgetId: string,
    incomeId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw`
      SELECT "id" FROM "transactions"
      WHERE "id" = ${incomeId}::uuid AND "budget_id" = ${budgetId}::uuid
      FOR UPDATE
    `;
    if ((rows as unknown as unknown[]).length === 0) {
      throw resourceNotFound();
    }
  }

  async requireIncome(
    tx: Prisma.TransactionClient,
    budgetId: string,
    incomeId: string,
  ): Promise<IncomeRecord> {
    const income = await tx.transaction.findFirst({
      where: { id: incomeId, budgetId },
      select: { id: true, amountMinor: true, transactionType: true, status: true, deletedAt: true },
    });
    if (
      !income ||
      income.deletedAt ||
      income.transactionType !== 'INCOME' ||
      income.status !== 'CONFIRMED'
    ) {
      throw resourceNotFound();
    }
    return { id: income.id, amountMinor: income.amountMinor };
  }

  async sumIncomeAssigned(
    tx: Prisma.TransactionClient,
    budgetId: string,
    incomeId: string,
  ): Promise<bigint> {
    const [row] = (await tx.$queryRaw`
      SELECT COALESCE(SUM(e."amount_minor"), 0) AS assigned
      FROM "envelope_assignments" e
      WHERE e."budget_id" = ${budgetId}::uuid
        AND e."source_income_transaction_id" = ${incomeId}::uuid
        AND e."type" = 'INCOME'
        AND e."status" = 'CONFIRMED'
    `) as unknown as Array<{ assigned: string | bigint | number }>;
    return BigInt(String((row ?? { assigned: 0n }).assigned));
  }

  async listConfirmedIncomeAssignments(
    tx: Prisma.TransactionClient,
    budgetId: string,
    incomeId: string,
  ): Promise<Array<{ id: string; amountMinor: bigint }>> {
    return tx.envelopeAssignment.findMany({
      where: {
        budgetId,
        sourceIncomeTransactionId: incomeId,
        type: 'INCOME',
        status: 'CONFIRMED',
      },
      select: { id: true, amountMinor: true },
      orderBy: { id: 'asc' },
    });
  }

  async requireEnvelope(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
  ): Promise<EnvelopeRecord> {
    const envelope = await tx.envelope.findFirst({
      where: { id: envelopeId, budgetId },
      select: { id: true, archivedAt: true },
    });
    if (!envelope) {
      throw resourceNotFound();
    }
    const periodCount = await tx.envelopePeriod.count({
      where: { budgetId, envelopeId },
    });
    return { id: envelope.id, archivedAt: envelope.archivedAt, hasPeriods: periodCount > 0 };
  }

  async findPeriod(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
    periodId: string,
  ): Promise<PeriodRecord | null> {
    const period = await tx.envelopePeriod.findFirst({
      where: { id: periodId, budgetId, envelopeId },
      select: { id: true, startsOn: true, endsOn: true },
    });
    return period;
  }

  async hasConfirmedFact(
    tx: Prisma.TransactionClient,
    budgetId: string,
    asOf: Date,
  ): Promise<boolean> {
    const count = await tx.transaction.count({
      where: {
        budgetId,
        status: 'CONFIRMED',
        deletedAt: null,
        occurredOn: { lte: asOf },
      },
    });
    return count > 0;
  }

  async cashAt(tx: Prisma.TransactionClient, budgetId: string, asOf: Date): Promise<bigint> {
    const [row] = (await tx.$queryRaw`
      SELECT (
        SELECT COALESCE(SUM(a."starting_balance_minor"), 0)
        FROM "accounts" a
        WHERE a."budget_id" = ${budgetId}::uuid
      )
      + (
        SELECT COALESCE(SUM(t."amount_minor"), 0)
        FROM "transactions" t
        WHERE t."budget_id" = ${budgetId}::uuid
          AND t."status" = 'CONFIRMED'
          AND t."deleted_at" IS NULL
          AND t."transaction_type" = 'INCOME'
          AND t."occurred_on" <= ${asOf}
      )
      - (
        SELECT COALESCE(SUM(e."amount_minor"), 0)
        FROM "transactions" e
        WHERE e."budget_id" = ${budgetId}::uuid
          AND e."status" = 'CONFIRMED'
          AND e."deleted_at" IS NULL
          AND e."transaction_type" = 'EXPENSE'
          AND e."occurred_on" <= ${asOf}
      ) AS cash
    `) as unknown as Array<{ cash: string | bigint | number }>;
    if (!row) {
      throw new Error('Cash row not found.');
    }
    return BigInt(String(row.cash));
  }

  async createAssignment(
    tx: Prisma.TransactionClient,
    params: AssignmentCreateParams,
  ): Promise<{ id: string }> {
    const assignment = await tx.envelopeAssignment.create({
      data: {
        id: createUuidV7(),
        budgetId: params.budgetId,
        envelopeId: params.envelopeId,
        type: params.sourceKind,
        amountMinor: params.amountMinor,
        effectiveOn: params.effectiveOn,
        periodId: params.periodId,
        sourceIncomeTransactionId: params.sourceIncomeTransactionId,
        status: 'CONFIRMED',
        createdByUserId: params.actorUserId,
      },
      select: { id: true },
    });
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.actorUserId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType: 'envelope-assignment',
        entityId: assignment.id,
        action: 'CREATED',
        source: 'API',
        requestId: params.requestId ?? null,
        newValues: {
          envelopeId: params.envelopeId,
          periodId: params.periodId,
          type: params.sourceKind,
          sourceIncomeTransactionId: params.sourceIncomeTransactionId,
          amountMinor: params.amountMinor.toString(),
          effectiveOn: params.effectiveOn.toISOString(),
        },
      },
    });
    return assignment;
  }

  async lockAssignment(
    tx: Prisma.TransactionClient,
    budgetId: string,
    assignmentId: string,
  ): Promise<LockedAssignment> {
    const rows = await tx.$queryRaw`
      SELECT e."id", e."amount_minor", e."status", e."type", e."effective_on",
             e."envelope_id", e."period_id", e."source_income_transaction_id"
      FROM "envelope_assignments" e
      WHERE e."id" = ${assignmentId}::uuid
        AND e."budget_id" = ${budgetId}::uuid
      FOR UPDATE
    `;
    const row = (rows as unknown as Array<RawLockedAssignment>)[0];
    if (!row) {
      throw resourceNotFound();
    }
    return {
      id: String(row.id),
      amountMinor: BigInt(String(row.amount_minor)),
      status: row.status as LockedAssignment['status'],
      type: row.type as LockedAssignment['type'],
      effectiveOn: toDate(row.effective_on),
      envelopeId: String(row.envelope_id),
      periodId: row.period_id ? String(row.period_id) : null,
      sourceIncomeTransactionId: row.source_income_transaction_id
        ? String(row.source_income_transaction_id)
        : null,
    };
  }

  async hasOutboundMovementsAfter(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
    periodId: string | null,
    fromOn: Date,
  ): Promise<boolean> {
    const [row] = (await tx.$queryRaw`
      SELECT EXISTS(
        SELECT 1
        FROM "envelope_movements" m
        WHERE m."budget_id" = ${budgetId}::uuid
          AND m."source_envelope_id" = ${envelopeId}::uuid
          AND m."status" = 'CONFIRMED'
          AND (${periodId}::uuid IS NULL
            OR m."source_period_id" IS NOT DISTINCT FROM ${periodId}::uuid)
          AND m."effective_on" >= ${fromOn}::date
      ) AS "has_movement"
    `) as unknown as Array<{ has_movement: boolean }>;
    return (row ?? { has_movement: false }).has_movement;
  }

  async reviseAssignmentAmount(
    tx: Prisma.TransactionClient,
    params: AssignmentModifyParams & { newAmountMinor: bigint },
  ): Promise<void> {
    await tx.envelopeAssignment.update({
      where: { id: params.assignmentId },
      data: { amountMinor: params.newAmountMinor },
    });
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.actorUserId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType: 'envelope-assignment',
        entityId: params.assignmentId,
        action: 'AMOUNT_REVISED',
        source: 'API',
        requestId: params.requestId ?? null,
        oldValues: { amountMinor: params.oldAmountMinor.toString() },
        newValues: { amountMinor: params.newAmountMinor.toString() },
      },
    });
  }

  async cancelAssignmentStatus(
    tx: Prisma.TransactionClient,
    params: AssignmentModifyParams,
  ): Promise<void> {
    await tx.envelopeAssignment.update({
      where: { id: params.assignmentId },
      data: { status: 'DELETED' },
    });
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.actorUserId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType: 'envelope-assignment',
        entityId: params.assignmentId,
        action: 'DELETED',
        source: 'API',
        requestId: params.requestId ?? null,
        oldValues: {
          amountMinor: params.oldAmountMinor.toString(),
          status: 'CONFIRMED',
        },
        newValues: { status: 'DELETED' },
      },
    });
  }
}
