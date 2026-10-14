import { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { resourceNotFound } from '../common/reference-data/reference-data.errors.js';

export type MovementCreateParams = {
  budgetId: string;
  workspaceId: string;
  actorUserId: string;
  sourceEnvelopeId: string;
  sourcePeriodId: string | null;
  destinationEnvelopeId: string | null;
  destinationPeriodId: string | null;
  amountMinor: bigint;
  effectiveOn: Date;
  requestId?: string | undefined;
};

export class MovementRepository {
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

  async requireEnvelope(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
  ): Promise<{ id: string }> {
    const envelope = await tx.envelope.findFirst({
      where: { id: envelopeId, budgetId },
      select: { id: true },
    });
    if (!envelope) {
      throw resourceNotFound();
    }
    return { id: envelope.id };
  }

  async lockEnvelopes(tx: Prisma.TransactionClient, envelopeIds: string[]): Promise<void> {
    const sortedEnvelopes = [...new Set(envelopeIds)].sort();
    for (const envelopeId of sortedEnvelopes) {
      await tx.$queryRaw`
        SELECT "id" FROM "envelopes"
        WHERE "id" = ${envelopeId}::uuid
        FOR UPDATE
      `;
    }
  }

  async requireEnvelopePeriod(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
    periodId: string,
  ): Promise<{ id: string }> {
    const period = await tx.envelopePeriod.findFirst({
      where: { id: periodId, budgetId, envelopeId },
      select: { id: true },
    });
    if (!period) {
      throw resourceNotFound();
    }
    return { id: period.id };
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

  async createMovement(
    tx: Prisma.TransactionClient,
    params: MovementCreateParams,
  ): Promise<{ id: string }> {
    const movement = await tx.envelopeMovement.create({
      data: {
        id: createUuidV7(),
        budgetId: params.budgetId,
        sourceEnvelopeId: params.sourceEnvelopeId,
        sourcePeriodId: params.sourcePeriodId,
        destinationEnvelopeId: params.destinationEnvelopeId,
        destinationPeriodId: params.destinationPeriodId,
        amountMinor: params.amountMinor,
        effectiveOn: params.effectiveOn,
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
        entityType: 'envelope-movement',
        entityId: movement.id,
        action: 'CREATED',
        source: 'API',
        requestId: params.requestId ?? null,
        newValues: {
          sourceEnvelopeId: params.sourceEnvelopeId,
          sourcePeriodId: params.sourcePeriodId,
          destinationEnvelopeId: params.destinationEnvelopeId,
          destinationPeriodId: params.destinationPeriodId,
          amountMinor: params.amountMinor.toString(),
          effectiveOn: params.effectiveOn.toISOString(),
        },
      },
    });
    return movement;
  }
}
