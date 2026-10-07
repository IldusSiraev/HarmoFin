import { createHash } from 'node:crypto';

export type FundingSourceKind = 'INCOME' | 'OPENING' | 'FREE';

/**
 * Everything a funding preview depends on. R03b computes it while building the preview and R04
 * recomputes it from real data under locks; equal state gives an equal `previewHash`.
 * All money is bigint minor units. Derived values (suggested lines) are intentionally NOT part of
 * the state: they are a pure function of it.
 */
export type FundingPreviewState = {
  budgetId: string;
  /** Calculation date in the budget timezone (YYYY-MM-DD). */
  asOf: string;
  sourceKind: FundingSourceKind;
  incomeTransactionId: string | null;
  incomeAmountMinor: bigint | null;
  incomeCategoryId: string | null;
  /** Confirmed INCOME assignments already made from this income. */
  incomeAssignedMinor: bigint;
  /** Per-envelope split of those assignments (drives SUGGESTED_FIXED/PERCENT needs). */
  incomeAssignedByEnvelope: Array<{ envelopeId: string; amountMinor: bigint }>;
  /** Envelope metadata that decides eligibility and scope of lines. */
  envelopes: Array<{
    envelopeId: string;
    envelopeType: string;
    periodSlot: string | null;
    archived: boolean;
  }>;
  /** Current and next period ranges used for scoping. */
  periodRanges: {
    current: { id: string; start: string; end: string };
    next: { id: string; start: string; end: string };
  };
  /** Period row of the category-suggestion target (may be a next-period row), if any. */
  categoryTargetPeriod: {
    periodId: string;
    envelopeId: string;
    targetMinor: bigint | null;
    targetStatus: string;
  } | null;
  cashMinor: bigint;
  freeToAssignMinor: bigint;
  sourceAvailableMinor: bigint;
  balances: Array<{
    envelopeId: string;
    periodId: string | null;
    fundedMinor: bigint;
    spentMinor: bigint;
  }>;
  mandatoryDueMinor: bigint;
  /** Unpaid mandatory slice of the current period (on or before currentPeriod.end, overdue included). */
  mandatoryDueCurrentMinor: bigint;
  /** Unpaid mandatory slice of the next period ((currentPeriod.end, nextPeriod.end]). */
  mandatoryDueNextMinor: bigint;
  rules: Array<{
    envelopeId: string;
    type: string;
    priority: number;
    fixedMinor: bigint | null;
    percentBasisPoints: number | null;
  }>;
  /** Current-period rows of period envelopes that take part in the preview. */
  periods: Array<{
    periodId: string;
    envelopeId: string;
    targetMinor: bigint | null;
    targetStatus: string;
  }>;
  selectedDraftPeriodIds: string[];
  categorySuggestion: {
    enabled: boolean;
    sourceCategoryId: string | null;
    targetEnvelopeId: string | null;
  };
  /** Optional `lineId` targets a specific suggestion line (e.g. a mandatory slice). */
  overrides: Array<{
    envelopeId: string;
    periodId: string | null;
    amountMinor: bigint;
    lineId?: string;
  }>;
};

function canonicalize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => [key, canonicalize(item)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

function sortedByJson<T>(items: readonly T[]): T[] {
  return items
    .map((item) => ({ item, key: JSON.stringify(canonicalize(item)) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ item }) => item);
}

/** Canonical JSON: sorted keys, bigint as strings, order-independent collections. */
export function canonicalFundingStateJson(state: FundingPreviewState): string {
  return JSON.stringify(
    canonicalize({
      ...state,
      balances: sortedByJson(state.balances),
      rules: sortedByJson(state.rules),
      incomeAssignedByEnvelope: sortedByJson(state.incomeAssignedByEnvelope),
      envelopes: sortedByJson(state.envelopes),
      periods: sortedByJson(state.periods),
      selectedDraftPeriodIds: [...state.selectedDraftPeriodIds].sort(),
      overrides: sortedByJson(state.overrides),
    }),
  );
}

/** sha256 hex of the canonical state; shared by preview (R03b) and confirm (R04). */
export function computePreviewHash(state: FundingPreviewState): string {
  return createHash('sha256').update(canonicalFundingStateJson(state)).digest('hex');
}
