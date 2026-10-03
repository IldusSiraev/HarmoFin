import type { PlanOccurrenceDto } from '../../composables/useBudgetReferenceData.js';
import type { TransactionJournalV2Item } from '../../composables/useEnvelopePlanV2.js';

export interface DayAggregate {
  incomeMinor: bigint;
  expenseMinor: bigint;
  netMinor: bigint;
  dot: 'none' | 'upcoming' | 'overdue';
}

type TransactionForAggregate = Pick<
  TransactionJournalV2Item,
  'occurredOn' | 'amountMinor' | 'transactionType'
>;
type OccurrenceForAggregate = Pick<PlanOccurrenceDto, 'scheduledOn' | 'status'>;

export function buildDayAggregates(
  transactions: ReadonlyArray<TransactionForAggregate>,
  occurrences: ReadonlyArray<OccurrenceForAggregate>,
  today: string,
): Record<string, DayAggregate> {
  const byDate: Record<string, DayAggregate> = {};

  for (const transaction of transactions) {
    const amount = BigInt(transaction.amountMinor);
    const isIncome = transaction.transactionType === 'INCOME';
    const existing = byDate[transaction.occurredOn] ?? emptyAggregate();
    byDate[transaction.occurredOn] = {
      ...existing,
      incomeMinor: existing.incomeMinor + (isIncome ? amount : 0n),
      expenseMinor: existing.expenseMinor + (isIncome ? 0n : amount),
      netMinor: existing.netMinor + (isIncome ? amount : -amount),
    };
  }

  for (const occurrence of occurrences) {
    if (occurrence.status !== 'PENDING' && occurrence.status !== 'DUE') continue;
    const overdue = occurrence.status === 'DUE' && occurrence.scheduledOn < today;
    const existing = byDate[occurrence.scheduledOn] ?? emptyAggregate();
    const dot = overdue || existing.dot === 'overdue' ? 'overdue' : 'upcoming';
    byDate[occurrence.scheduledOn] = { ...existing, dot };
  }

  return byDate;
}

function emptyAggregate(): DayAggregate {
  return { incomeMinor: 0n, expenseMinor: 0n, netMinor: 0n, dot: 'none' };
}
