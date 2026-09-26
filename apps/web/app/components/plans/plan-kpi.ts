import type { PlanOccurrenceDto } from '../../composables/useBudgetReferenceData.js';

export interface PlanKpi {
  plannedIncomeMinor: string;
  plannedExpenseMinor: string;
  balanceMinor: string;
  totalPlans: number;
}

type OccurrenceForKpi = Pick<PlanOccurrenceDto, 'planType' | 'amountMinor' | 'status'>;

export function computePlanKpi(
  monthOccurrences: ReadonlyArray<OccurrenceForKpi>,
  activePlanCount: number,
): PlanKpi {
  let income = 0n;
  let expense = 0n;

  for (const occurrence of monthOccurrences) {
    if (occurrence.status === 'CANCELLED') continue;
    const amount = BigInt(occurrence.amountMinor);
    if (occurrence.planType === 'INCOME') income += amount;
    else expense += amount;
  }

  return {
    plannedIncomeMinor: income.toString(),
    plannedExpenseMinor: expense.toString(),
    balanceMinor: (income - expense).toString(),
    totalPlans: activePlanCount,
  };
}
