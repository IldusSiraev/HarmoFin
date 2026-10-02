import type { EnvelopeAssignmentType, Prisma, TransactionStatus } from '@prisma/client';

export type ExportTransactionV2Row = {
  id: string;
  accountingModelVersion: number;
  occurredOn: Date;
  transactionType: 'INCOME' | 'EXPENSE';
  status: TransactionStatus;
  amountMinor: bigint;
  currency: string;
  accountName: string;
  categoryName: string;
  purposeName: string | null;
  sourceDescription: string | null;
  merchantName: string | null;
  comment: string | null;
  isPlanned: boolean;
  createdAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  deletedAt: Date | null;
};

export type ExportAssignmentV2Row = {
  sourceKind: 'ASSIGNMENT' | 'MOVEMENT';
  id: string;
  effectiveOn: string;
  assignmentType: EnvelopeAssignmentType | null;
  status: 'CONFIRMED';
  amountMinor: bigint;
  envelopeName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  sourceEnvelopeName: string | null;
  sourcePeriodStart: string | null;
  sourcePeriodEnd: string | null;
  destinationEnvelopeName: string | null;
  destinationPeriodStart: string | null;
  destinationPeriodEnd: string | null;
  sourceIncomeTransactionId: string | null;
};

const dateText = (value: Date | undefined | null) =>
  value ? value.toISOString().slice(0, 10) : null;

/**
 * Read-only CSV sources of model 2. Every query is scoped by budget_id (and the active budget
 * chain) inside the caller's snapshot transaction; nothing is written.
 */
export class CsvExportV2Repository {
  /** Real transactions of both epochs, every status, oldest first. */
  async transactions(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    take: number,
  ): Promise<ExportTransactionV2Row[]> {
    const rows = await tx.transaction.findMany({
      where: { budgetId, budget: activeBudgetWhere(userId, budgetId) },
      orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take,
      select: {
        id: true,
        accountingModelVersion: true,
        occurredOn: true,
        transactionType: true,
        status: true,
        amountMinor: true,
        currency: true,
        sourceDescription: true,
        merchantName: true,
        comment: true,
        isPlanned: true,
        createdAt: true,
        confirmedAt: true,
        cancelledAt: true,
        deletedAt: true,
        account: { select: { name: true } },
        category: { select: { name: true } },
        envelope: { select: { name: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      accountingModelVersion: row.accountingModelVersion,
      occurredOn: row.occurredOn,
      transactionType: row.transactionType,
      status: row.status,
      amountMinor: row.amountMinor,
      currency: row.currency,
      accountName: row.account.name,
      categoryName: row.category.name,
      purposeName: row.envelope?.name ?? null,
      sourceDescription: row.sourceDescription,
      merchantName: row.merchantName,
      comment: row.comment,
      isPlanned: row.isPlanned,
      createdAt: row.createdAt,
      confirmedAt: row.confirmedAt,
      cancelledAt: row.cancelledAt,
      deletedAt: row.deletedAt,
    }));
  }

  /** CONFIRMED v2 assignments and movements, oldest first; `take` applies to each source. */
  async assignments(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    take: number,
  ): Promise<ExportAssignmentV2Row[]> {
    const where = {
      budgetId,
      budget: activeBudgetWhere(userId, budgetId),
      status: 'CONFIRMED' as const,
    };
    const orderBy = [{ effectiveOn: 'asc' as const }, { id: 'asc' as const }];
    const period = { select: { startsOn: true, endsOn: true } };
    const envelope = { select: { name: true } };
    const [assignments, movements] = await Promise.all([
      tx.envelopeAssignment.findMany({
        where,
        orderBy,
        take,
        select: {
          id: true,
          type: true,
          amountMinor: true,
          effectiveOn: true,
          sourceIncomeTransactionId: true,
          envelope,
          period,
        },
      }),
      tx.envelopeMovement.findMany({
        where,
        orderBy,
        take,
        select: {
          id: true,
          amountMinor: true,
          effectiveOn: true,
          sourceEnvelope: envelope,
          sourcePeriod: period,
          destinationEnvelope: envelope,
          destinationPeriod: period,
        },
      }),
    ]);
    const empty = {
      assignmentType: null,
      envelopeName: null,
      periodStart: null,
      periodEnd: null,
      sourceEnvelopeName: null,
      sourcePeriodStart: null,
      sourcePeriodEnd: null,
      destinationEnvelopeName: null,
      destinationPeriodStart: null,
      destinationPeriodEnd: null,
      sourceIncomeTransactionId: null,
    };
    const result: ExportAssignmentV2Row[] = [
      ...assignments.map((row) => ({
        ...empty,
        sourceKind: 'ASSIGNMENT' as const,
        id: row.id,
        effectiveOn: dateText(row.effectiveOn)!,
        status: 'CONFIRMED' as const,
        amountMinor: row.amountMinor,
        assignmentType: row.type,
        envelopeName: row.envelope.name,
        periodStart: dateText(row.period?.startsOn),
        periodEnd: dateText(row.period?.endsOn),
        sourceIncomeTransactionId: row.sourceIncomeTransactionId,
      })),
      ...movements.map((row) => ({
        ...empty,
        sourceKind: 'MOVEMENT' as const,
        id: row.id,
        effectiveOn: dateText(row.effectiveOn)!,
        status: 'CONFIRMED' as const,
        amountMinor: row.amountMinor,
        sourceEnvelopeName: row.sourceEnvelope.name,
        sourcePeriodStart: dateText(row.sourcePeriod?.startsOn),
        sourcePeriodEnd: dateText(row.sourcePeriod?.endsOn),
        destinationEnvelopeName: row.destinationEnvelope?.name ?? null,
        destinationPeriodStart: dateText(row.destinationPeriod?.startsOn),
        destinationPeriodEnd: dateText(row.destinationPeriod?.endsOn),
      })),
    ];
    return result.sort(
      (left, right) =>
        left.effectiveOn.localeCompare(right.effectiveOn) ||
        left.sourceKind.localeCompare(right.sourceKind) ||
        left.id.localeCompare(right.id),
    );
  }
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
