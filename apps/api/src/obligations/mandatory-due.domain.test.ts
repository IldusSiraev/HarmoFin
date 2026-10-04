import { describe, expect, it } from 'vitest';

import { mandatoryFundingGap } from './mandatory-due.domain.js';

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
