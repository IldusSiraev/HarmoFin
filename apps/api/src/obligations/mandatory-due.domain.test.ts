import { describe, expect, it } from 'vitest';

import {
  mandatoryFundingGap,
  mandatoryLineId,
  mandatorySliceGaps,
} from './mandatory-due.domain.js';

describe('mandatoryFundingGap', () => {
  it('равен нехватке, когда баланс меньше потребности', () => {
    expect(mandatoryFundingGap(4_500_000n, 1_000_000n)).toBe(3_500_000n);
  });

  it('равен нулю, когда баланс покрывает потребность или превышает её', () => {
    expect(mandatoryFundingGap(300_000n, 300_000n)).toBe(0n);
    expect(mandatoryFundingGap(0n, 100_000n)).toBe(0n);
  });

  it('отрицательный баланс не увеличивает нехватку сверх потребности', () => {
    expect(mandatoryFundingGap(500_000n, -200_000n)).toBe(500_000n);
  });

  it('отрицательная потребность не даёт отрицательную нехватку', () => {
    expect(mandatoryFundingGap(-1n, 0n)).toBe(0n);
  });

  it('работает с bigint за пределами Number.MAX_SAFE_INTEGER', () => {
    expect(mandatoryFundingGap(9_007_199_254_740_993n, 1n)).toBe(9_007_199_254_740_992n);
  });
});

describe('mandatoryLineId', () => {
  it('канон: envelopeId, два разделителя, слайс', () => {
    expect(mandatoryLineId('env-1', 'MANDATORY_CURRENT')).toBe('env-1||MANDATORY_CURRENT');
    expect(mandatoryLineId('env-1', 'MANDATORY_NEXT')).toBe('env-1||MANDATORY_NEXT');
  });
});

describe('mandatorySliceGaps', () => {
  it('баланс 0: нехватка делится по слайсам, просрочка в текущем', () => {
    expect(mandatorySliceGaps(500_000n, 3_000_000n, 0n)).toEqual({
      currentGapMinor: 500_000n,
      nextGapMinor: 3_000_000n,
      totalGapMinor: 3_500_000n,
    });
  });

  it('баланс гасит текущий слайс; остаток нехватки падает на следующий', () => {
    expect(mandatorySliceGaps(500_000n, 3_000_000n, 200_000n)).toEqual({
      currentGapMinor: 300_000n,
      nextGapMinor: 3_000_000n,
      totalGapMinor: 3_300_000n,
    });
  });

  it('баланс покрывает текущий: нехватка только в следующем', () => {
    expect(mandatorySliceGaps(3_500_000n, 1_000_000n, 3_500_000n)).toEqual({
      currentGapMinor: 0n,
      nextGapMinor: 1_000_000n,
      totalGapMinor: 1_000_000n,
    });
  });

  it('баланс покрывает всю потребность: нехватки нет', () => {
    expect(mandatorySliceGaps(1_000_000n, 2_000_000n, 5_000_000n)).toEqual({
      currentGapMinor: 0n,
      nextGapMinor: 0n,
      totalGapMinor: 0n,
    });
  });

  it('баланс меньше просроченного текущего: нехватка только в текущем', () => {
    expect(mandatorySliceGaps(2_000_000n, 0n, 500_000n)).toEqual({
      currentGapMinor: 1_500_000n,
      nextGapMinor: 0n,
      totalGapMinor: 1_500_000n,
    });
  });

  it('отрицательные входные значения не дают отрицательных нехваток', () => {
    expect(mandatorySliceGaps(-5n, -1n, -1n)).toEqual({
      currentGapMinor: 0n,
      nextGapMinor: 0n,
      totalGapMinor: 0n,
    });
  });

  it('инвариант: currentGap + nextGap === totalGap === fundingGap(сумма, баланс)', () => {
    let state = 987654321;
    const next = (max: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state % max;
    };
    const nonNegative = (value: bigint) => (value > 0n ? value : 0n);
    for (let i = 0; i < 300; i += 1) {
      const dueCurrent = BigInt(next(50_000) - 10_000);
      const dueNext = BigInt(next(50_000) - 10_000);
      const balance = BigInt(next(60_000) - 15_000);
      const gaps = mandatorySliceGaps(dueCurrent, dueNext, balance);
      expect(gaps.currentGapMinor >= 0n).toBe(true);
      expect(gaps.nextGapMinor >= 0n).toBe(true);
      expect(gaps.currentGapMinor + gaps.nextGapMinor).toBe(gaps.totalGapMinor);
      expect(gaps.totalGapMinor).toBe(
        mandatoryFundingGap(nonNegative(dueCurrent) + nonNegative(dueNext), balance),
      );
    }
  });
});
