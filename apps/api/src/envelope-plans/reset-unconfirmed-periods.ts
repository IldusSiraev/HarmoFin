import type { Prisma } from '@prisma/client';

/**
 * True when the budget holds confirmed financial facts that fix the calendar: a CONFIRMED
 * transaction, any assignment or movement, a CONFIRMED period target or a stored cycle revision.
 * Calendar settings (cycle, later timezone) may only change without them. Caller holds the
 * budget lock; every query filters budget_id.
 */
export async function hasConfirmedPlanHistory(
  tx: Prisma.TransactionClient,
  budgetId: string,
): Promise<boolean> {
  const [transactions, assignments, movements, targets, revisions] = await Promise.all([
    tx.transaction.count({ where: { budgetId, status: 'CONFIRMED' }, take: 1 }),
    tx.envelopeAssignment.count({ where: { budgetId }, take: 1 }),
    tx.envelopeMovement.count({ where: { budgetId }, take: 1 }),
    tx.envelopePeriod.count({ where: { budgetId, targetStatus: 'CONFIRMED' }, take: 1 }),
    tx.budgetCycleRevision.count({ where: { budgetId }, take: 1 }),
  ]);
  return transactions + assignments + movements + targets + revisions > 0;
}

/**
 * Removes the structural UNSET/DRAFT period rows of a budget that nothing references (no
 * assignment, no movement). CONFIRMED targets and referenced rows are never touched, so the
 * helper cannot change history. The caller holds the budget lock and rebuilds drafts afterwards
 * through FundingRuleRepository.getOrCreatePeriod. Returns the number of removed rows.
 */
export async function resetUnconfirmedPeriods(
  tx: Prisma.TransactionClient,
  budgetId: string,
): Promise<number> {
  const result = await tx.envelopePeriod.deleteMany({
    where: {
      budgetId,
      targetStatus: { in: ['UNSET', 'DRAFT'] },
      assignments: { none: {} },
      movementsAsSource: { none: {} },
      movementsAsDestination: { none: {} },
    },
  });
  return result.count;
}
