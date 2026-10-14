import { describe, expect, it } from 'vitest';

import { type FundingPreviewState, computePreviewHash } from './funding-state.js';

const base = (): FundingPreviewState => ({
  budgetId: 'b',
  asOf: '2026-10-01',
  sourceKind: 'INCOME',
  incomeTransactionId: 'i',
  incomeAmountMinor: 8_000_000n,
  incomeCategoryId: 'c',
  incomeAssignedMinor: 0n,
  incomeAssignedByEnvelope: [{ envelopeId: 'e1', amountMinor: 5n }],
  envelopes: [
    { envelopeId: 'e1', envelopeType: 'MANDATORY_EXPENSES', periodSlot: null, archived: false },
    { envelopeId: 'e2', envelopeType: 'CURRENT_EXPENSES', periodSlot: 'FIRST', archived: false },
  ],
  periodRanges: {
    current: { id: 'FIRST', start: '2026-10-01', end: '2026-10-14' },
    next: { id: 'SECOND', start: '2026-10-15', end: '2026-10-31' },
  },
  categoryTargetPeriod: null,
  cashMinor: 38_000_000n,
  freeToAssignMinor: 38_000_000n,
  sourceAvailableMinor: 8_000_000n,
  balances: [
    { envelopeId: 'e1', periodId: null, fundedMinor: 1n, spentMinor: 0n },
    { envelopeId: 'e2', periodId: 'p', fundedMinor: 2n, spentMinor: 1n },
  ],
  mandatoryDueMinor: 4_000_000n,
  mandatoryDueCurrentMinor: 4_000_000n,
  mandatoryDueNextMinor: 0n,
  rules: [
    {
      envelopeId: 'e1',
      type: 'SUM_OF_PLANS',
      priority: 1,
      fixedMinor: null,
      percentBasisPoints: null,
    },
  ],
  periods: [{ periodId: 'p', envelopeId: 'e2', targetMinor: 6_500_000n, targetStatus: 'DRAFT' }],
  selectedDraftPeriodIds: ['p'],
  categorySuggestion: { enabled: false, sourceCategoryId: null, targetEnvelopeId: null },
  overrides: [],
});

describe('computePreviewHash', () => {
  it('is stable and independent of collection order', () => {
    const state = base();
    const reordered = { ...base(), balances: [...state.balances].reverse() };
    expect(computePreviewHash(state)).toMatch(/^[0-9a-f]{64}$/);
    expect(computePreviewHash(reordered)).toBe(computePreviewHash(state));
  });

  it('changes with any state input', () => {
    const hash = computePreviewHash(base());
    expect(computePreviewHash({ ...base(), mandatoryDueMinor: 1n })).not.toBe(hash);
    expect(computePreviewHash({ ...base(), mandatoryDueCurrentMinor: 1n })).not.toBe(hash);
    expect(computePreviewHash({ ...base(), mandatoryDueNextMinor: 9n })).not.toBe(hash);
    expect(computePreviewHash({ ...base(), selectedDraftPeriodIds: [] })).not.toBe(hash);
    expect(
      computePreviewHash({
        ...base(),
        incomeAssignedByEnvelope: [{ envelopeId: 'e2', amountMinor: 5n }],
      }),
    ).not.toBe(hash);
    const envelopes = base().envelopes;
    expect(
      computePreviewHash({
        ...base(),
        envelopes: [{ ...envelopes[0]!, archived: true }, envelopes[1]!],
      }),
    ).not.toBe(hash);
    expect(
      computePreviewHash({
        ...base(),
        envelopes: [envelopes[0]!, { ...envelopes[1]!, periodSlot: 'SECOND' }],
      }),
    ).not.toBe(hash);
    expect(
      computePreviewHash({
        ...base(),
        periodRanges: {
          ...base().periodRanges,
          next: { id: 'SECOND', start: '2026-10-16', end: '2026-10-31' },
        },
      }),
    ).not.toBe(hash);
    expect(
      computePreviewHash({
        ...base(),
        categoryTargetPeriod: {
          periodId: 'n',
          envelopeId: 'e2',
          targetMinor: 1n,
          targetStatus: 'DRAFT',
        },
      }),
    ).not.toBe(hash);
    expect(
      computePreviewHash({
        ...base(),
        overrides: [{ envelopeId: 'e1', periodId: null, amountMinor: 1n }],
      }),
    ).not.toBe(hash);
  });
});
