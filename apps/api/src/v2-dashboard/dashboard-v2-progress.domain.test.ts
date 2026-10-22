import { describe, expect, it } from 'vitest';

import { envelopeProgress, obligationCoverage } from './dashboard-v2-progress.domain.js';

describe('obligationCoverage', () => {
  it('покрывает платежи одного конверта по порядку из его остатка', () => {
    const balances = new Map([['m', 3_500_000n]]);
    expect(
      obligationCoverage(
        [
          { envelopeId: 'm', unpaidMinor: 100_000n },
          { envelopeId: 'm', unpaidMinor: 4_500_000n },
          { envelopeId: 'm', unpaidMinor: 200_000n },
        ],
        balances,
      ),
    ).toEqual([
      { coverage: 'COVERED', shortfallMinor: 0n },
      { coverage: 'PARTIAL', shortfallMinor: 1_100_000n },
      { coverage: 'UNCOVERED', shortfallMinor: 200_000n },
    ]);
  });

  it('остаток одного обязательного конверта не покрывает платежи другого', () => {
    const balances = new Map([
      ['a', 500_000n],
      ['b', 0n],
    ]);
    expect(
      obligationCoverage(
        [
          { envelopeId: 'b', unpaidMinor: 300_000n },
          { envelopeId: 'a', unpaidMinor: 300_000n },
        ],
        balances,
      ),
    ).toEqual([
      { coverage: 'UNCOVERED', shortfallMinor: 300_000n },
      { coverage: 'COVERED', shortfallMinor: 0n },
    ]);
  });

  it('отрицательный или неизвестный остаток ничего не покрывает', () => {
    const balances = new Map([['m', -50_000n]]);
    expect(
      obligationCoverage(
        [
          { envelopeId: 'm', unpaidMinor: 10_000n },
          { envelopeId: 'x', unpaidMinor: 10_000n },
        ],
        balances,
      ),
    ).toEqual([
      { coverage: 'UNCOVERED', shortfallMinor: 10_000n },
      { coverage: 'UNCOVERED', shortfallMinor: 10_000n },
    ]);
  });
});

describe('envelopeProgress', () => {
  const base = {
    balance: 0n,
    targetAmountMinor: null,
    isMainPeriodEnvelope: false,
    mainPeriod: null,
    mandatoryDue: 0n,
  };

  it('SPENT: главный конверт периода — потрачено из было доступно', () => {
    expect(
      envelopeProgress({
        ...base,
        envelopeType: 'CURRENT_EXPENSES',
        isMainPeriodEnvelope: true,
        mainPeriod: { spent: 5_317_483n, available: 6_101_249n },
      }),
    ).toEqual({ kind: 'SPENT', valueMinor: 5_317_483n, maxMinor: 6_101_249n, shortfallMinor: null });
  });

  it('SPENT нет без настроенного периода, при нулевом доступном и у второй половины', () => {
    expect(
      envelopeProgress({ ...base, envelopeType: 'CURRENT_EXPENSES', isMainPeriodEnvelope: true }),
    ).toBeNull();
    expect(
      envelopeProgress({
        ...base,
        envelopeType: 'CURRENT_EXPENSES',
        isMainPeriodEnvelope: true,
        mainPeriod: { spent: 0n, available: 0n },
      }),
    ).toBeNull();
    expect(
      envelopeProgress({
        ...base,
        envelopeType: 'CURRENT_EXPENSES',
        mainPeriod: { spent: 1n, available: 10n },
      }),
    ).toBeNull();
  });

  it('COVERED: обязательный конверт — отложено из к оплате и недостача', () => {
    expect(
      envelopeProgress({
        ...base,
        envelopeType: 'MANDATORY_EXPENSES',
        balance: 2_608_957n,
        mandatoryDue: 7_984_300n,
      }),
    ).toEqual({
      kind: 'COVERED',
      valueMinor: 2_608_957n,
      maxMinor: 7_984_300n,
      shortfallMinor: 5_375_343n,
    });
    expect(
      envelopeProgress({
        ...base,
        envelopeType: 'MANDATORY_EXPENSES',
        balance: 9_000_000n,
        mandatoryDue: 7_984_300n,
      }),
    ).toEqual({
      kind: 'COVERED',
      valueMinor: 9_000_000n,
      maxMinor: 7_984_300n,
      shortfallMinor: 0n,
    });
  });

  it('COVERED: отрицательный остаток считается нулём; без платежей полосы нет', () => {
    expect(
      envelopeProgress({
        ...base,
        envelopeType: 'MANDATORY_EXPENSES',
        balance: -100n,
        mandatoryDue: 1_000n,
      }),
    ).toEqual({ kind: 'COVERED', valueMinor: 0n, maxMinor: 1_000n, shortfallMinor: 1_000n });
    expect(envelopeProgress({ ...base, envelopeType: 'MANDATORY_EXPENSES', balance: 5n })).toBeNull();
  });

  it('GOAL: накопления, резерв и свой конверт с целью', () => {
    for (const envelopeType of ['SAVINGS_GOAL', 'RESERVE', 'CUSTOM'] as const) {
      expect(
        envelopeProgress({ ...base, envelopeType, balance: 300_000n, targetAmountMinor: 2_000_000n }),
      ).toEqual({ kind: 'GOAL', valueMinor: 300_000n, maxMinor: 2_000_000n, shortfallMinor: null });
    }
  });

  it('нет полосы без цели, с нулевой целью и у FREE_MONEY', () => {
    expect(envelopeProgress({ ...base, envelopeType: 'SAVINGS_GOAL', balance: 1n })).toBeNull();
    expect(
      envelopeProgress({ ...base, envelopeType: 'SAVINGS_GOAL', targetAmountMinor: 0n }),
    ).toBeNull();
    expect(
      envelopeProgress({ ...base, envelopeType: 'FREE_MONEY', targetAmountMinor: 100n }),
    ).toBeNull();
  });
});
