import type {
  EnvelopeType,
  FundingRuleType,
  Prisma,
  WorkspaceMembershipRole,
} from '@prisma/client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PreviewIncome = {
  id: string;
  amountMinor: bigint;
  categoryId: string | null;
};

export type PreviewEnvelope = {
  id: string;
  name: string;
  envelopeType: EnvelopeType;
  periodSlot: 'FIRST' | 'SECOND' | null;
  archivedAt: Date | null;
};

export type PreviewRule = {
  envelopeId: string;
  type: FundingRuleType;
  priority: number;
  fixedMinor: bigint | null;
  percentBasisPoints: number | null;
};

/** Read-only queries of the funding preview. Every query filters budget_id. */
export class FundingPreviewRepository {
  /** Owners of the envelopes a confirm touches: named directly or through target period rows. */
  async findEnvelopeOwners(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeIds: ReadonlySet<string>,
    periodIds: readonly string[],
  ): Promise<Array<{ ownerUserId: string }>> {
    const guarded = new Set(envelopeIds);
    if (periodIds.length > 0) {
      const periods = await tx.envelopePeriod.findMany({
        where: { budgetId, id: { in: [...periodIds] } },
        select: { envelopeId: true },
      });
      for (const period of periods) guarded.add(period.envelopeId);
    }
    if (guarded.size === 0) return [];
    return tx.envelope.findMany({
      where: { budgetId, id: { in: [...guarded] } },
      select: { ownerUserId: true },
    });
  }

  async findMemberRole(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembershipRole | null> {
    const membership = await tx.workspaceMembership.findFirst({
      where: { workspaceId, userId, isActive: true },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  /** A confirmed, not deleted INCOME of this budget; null otherwise. */
  async findIncome(
    tx: Prisma.TransactionClient,
    budgetId: string,
    incomeId: string,
  ): Promise<PreviewIncome | null> {
    if (!UUID_PATTERN.test(incomeId)) return null;
    const income = await tx.transaction.findFirst({
      where: {
        id: incomeId,
        budgetId,
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        deletedAt: null,
      },
      select: { id: true, amountMinor: true, categoryId: true },
    });
    return income;
  }

  /** Confirmed INCOME-sourced assignments of one income, summed per envelope. */
  async incomeAssignedByEnvelope(
    tx: Prisma.TransactionClient,
    budgetId: string,
    incomeId: string,
  ): Promise<Map<string, bigint>> {
    const rows = await tx.envelopeAssignment.groupBy({
      by: ['envelopeId'],
      where: {
        budgetId,
        sourceIncomeTransactionId: incomeId,
        type: 'INCOME',
        status: 'CONFIRMED',
      },
      _sum: { amountMinor: true },
    });
    return new Map(rows.map((row) => [row.envelopeId, row._sum.amountMinor ?? 0n]));
  }

  async listEnvelopes(tx: Prisma.TransactionClient, budgetId: string): Promise<PreviewEnvelope[]> {
    return tx.envelope.findMany({
      where: { budgetId },
      select: { id: true, name: true, envelopeType: true, periodSlot: true, archivedAt: true },
      orderBy: { id: 'asc' },
    });
  }

  /** The single rule per envelope (oldest wins, like FundingRuleRepository.findRule). */
  async listRules(tx: Prisma.TransactionClient, budgetId: string): Promise<PreviewRule[]> {
    const rows = await tx.envelopeFundingRule.findMany({
      where: { budgetId },
      select: {
        envelopeId: true,
        type: true,
        priority: true,
        fixedMinor: true,
        percentBasisPoints: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const seen = new Set<string>();
    const result: PreviewRule[] = [];
    for (const row of rows) {
      if (seen.has(row.envelopeId)) continue;
      seen.add(row.envelopeId);
      result.push(row);
    }
    return result;
  }

  async categorySuggestion(
    tx: Prisma.TransactionClient,
    budgetId: string,
  ): Promise<{
    enabled: boolean;
    sourceCategoryId: string | null;
    targetEnvelopeId: string | null;
  }> {
    const budget = await tx.budget.findUniqueOrThrow({
      where: { id: budgetId },
      select: {
        incomeAllocationRuleEnabled: true,
        incomeAllocationSourceCategoryId: true,
        incomeAllocationTargetEnvelopeId: true,
      },
    });
    return {
      enabled: budget.incomeAllocationRuleEnabled,
      sourceCategoryId: budget.incomeAllocationSourceCategoryId,
      targetEnvelopeId: budget.incomeAllocationTargetEnvelopeId,
    };
  }
}
