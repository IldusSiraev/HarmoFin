export type FundingRuleKind =
  'SUM_OF_PLANS' | 'FIXED_PER_PERIOD' | 'SUGGESTED_FIXED' | 'PERCENT_OF_INCOME';

export interface FundingRuleInput {
  envelopeId: string;
  periodId: string | null;
  priority: number;
  kind: FundingRuleKind;
  /** Потребность в minor units; для DRAFT/UNSET периода вызывающий передаёт 0n. */
  needMinor: bigint;
  percentBasisPoints?: number;
  alreadyAllocatedFromIncomeMinor?: bigint;
  /** Идентификатор строки (например, обязательный слайс); возвращается в строке suggestions. */
  lineId?: string;
  /** Строка идёт после всех обычных строк (ближние period-строки имеют приоритет). */
  slotAfterPeriod?: boolean;
}

export interface FundingSuggestionLine {
  envelopeId: string;
  periodId: string | null;
  amountMinor: bigint;
  lineId?: string;
}

export interface SuggestFundingInput {
  available: bigint;
  incomeAmount: bigint | null;
  orderedRules: readonly FundingRuleInput[];
  categoryOverride?: { envelopeId: string; periodId: string | null };
}

const nonNegative = (value: bigint): bigint => (value > 0n ? value : 0n);

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function needOf(rule: FundingRuleInput, incomeAmount: bigint | null): bigint {
  if (rule.kind === 'PERCENT_OF_INCOME') {
    const share = ((incomeAmount ?? 0n) * BigInt(rule.percentBasisPoints ?? 0)) / 10_000n;
    return nonNegative(share - (rule.alreadyAllocatedFromIncomeMinor ?? 0n));
  }
  return nonNegative(rule.needMinor);
}

/** Queue order of rule lines: `slotAfterPeriod` last, then priority, envelopeId, periodId. */
export function compareFundingRules(a: FundingRuleInput, b: FundingRuleInput): number {
  return (
    Number(Boolean(a.slotAfterPeriod)) - Number(Boolean(b.slotAfterPeriod)) ||
    a.priority - b.priority ||
    compareText(a.envelopeId, b.envelopeId) ||
    compareText(a.periodId ?? '', b.periodId ?? '')
  );
}

/**
 * Чистый расчёт предложений: обычный порядок (priority, envelopeId, periodId),
 * каждая строка = min(остаток, потребность), сумма не превышает available.
 * Строки с `slotAfterPeriod` идут после всех остальных, между собой тем же порядком.
 */
export function suggestFunding(input: SuggestFundingInput): FundingSuggestionLine[] {
  const available = nonNegative(input.available);

  if (input.categoryOverride) {
    const cap = input.incomeAmount === null ? available : nonNegative(input.incomeAmount);
    const amountMinor = cap < available ? cap : available;
    if (amountMinor <= 0n) return [];
    return [
      {
        envelopeId: input.categoryOverride.envelopeId,
        periodId: input.categoryOverride.periodId,
        amountMinor,
      },
    ];
  }

  const ordered = [...input.orderedRules].sort(compareFundingRules);

  const lines: FundingSuggestionLine[] = [];
  let remaining = available;
  for (const rule of ordered) {
    if (remaining <= 0n) break;
    const need = needOf(rule, input.incomeAmount);
    const amountMinor = need < remaining ? need : remaining;
    if (amountMinor <= 0n) continue;
    lines.push({
      envelopeId: rule.envelopeId,
      periodId: rule.periodId,
      amountMinor,
      ...(rule.lineId !== undefined ? { lineId: rule.lineId } : {}),
    });
    remaining -= amountMinor;
  }
  return lines;
}
