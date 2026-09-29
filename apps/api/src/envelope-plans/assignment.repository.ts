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
}
