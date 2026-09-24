import type {
  PlanOccurrenceDto,
  TransactionDto,
} from '../../composables/useBudgetReferenceData.js';

export interface DayAggregate {
  netMinor: bigint;
  dot: 'none' | 'upcoming' | 'overdue';
}

type TransactionForAggregate = Pick<
  TransactionDto,
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
    const signed =
      transaction.transactionType === 'INCOME'
        ? BigInt(transaction.amountMinor)
        : -BigInt(transaction.amountMinor);
    const existing = byDate[transaction.occurredOn] ?? { netMinor: 0n, dot: 'none' as const };
    byDate[transaction.occurredOn] = { ...existing, netMinor: existing.netMinor + signed };
  }

  for (const occurrence of occurrences) {
    if (occurrence.status !== 'PENDING' && occurrence.status !== 'DUE') continue;
    const overdue = occurrence.status === 'DUE' && occurrence.scheduledOn < today;
    const existing = byDate[occurrence.scheduledOn] ?? { netMinor: 0n, dot: 'none' as const };
    const dot = overdue || existing.dot === 'overdue' ? 'overdue' : 'upcoming';
    byDate[occurrence.scheduledOn] = { ...existing, dot };
  }

  return byDate;
}
