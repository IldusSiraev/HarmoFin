import { describe, expect, it } from 'vitest';

import {
  V2MoneyOverflowError,
  assignmentBalance,
  calculateSpendable,
  periodFunded,
  type SpendableInput,
  type SpendableResult,
} from './v2-money.domain.js';

const BIGINT_MAX = 9_223_372_036_854_775_807n;

describe('periodFunded', () => {
  it.each([
    [0n, 0n, 0n, 0n, 0n],
    [0n, 65n, 0n, 0n, 65n],
    [0n, 65n, 0n, 10n, 55n],
    [5n, 60n, 0n, 0n, 65n],
    [0n, 55n, 10n, 0n, 65n],
    [0n, 65n, 10n, 15n, 60n],
    [0n, 5n, 0n, 10n, -5n],
  ])('funded = %s: (%s) + (%s) + (%s) − (%s)', (opening, assigned, movedIn, movedOut, expected) => {
    expect(periodFunded(opening, assigned, movedIn, movedOut)).toBe(expected);
  });

  it('expenses do not change funding: funded 65, spent 20, balance 45; move-out 10 => funded 55', () => {
    const funded = periodFunded(0n, 65n, 0n, 0n);
    expect(assignmentBalance(funded, 20n)).toBe(45n);
    const afterMoveOut = periodFunded(0n, 65n, 0n, 10n);
    expect(afterMoveOut).toBe(55n);
  });
});

describe('assignmentBalance', () => {
  it.each([
    [65n, 20n, 45n],
    [0n, 0n, 0n],
    [10n, 10n, 0n],
    [10n, 15n, -5n],
  ])('balance = %s: %s − %s', (funded, spent, expected) => {
    expect(assignmentBalance(funded, spent)).toBe(expected);
  });
});

describe('calculateSpendable', () => {
  const allZeros: SpendableResult = {
    spendableNow: 0n,
    mandatoryProtected: 0n,
    mandatoryGap: 0n,
    freeToAssign: 0n,
    unbackedAssignments: 0n,
  };

  const spendableCases: ReadonlyArray<[string, SpendableInput, SpendableResult]> = [
    [
      'zero boundary: no cash and no balances',
      { cash: 0n, current: 0n, mandatory: 0n, mandatoryDue: 0n, otherBalances: [] },
      allZeros,
    ],
    [
      'spec example: due exceeds mandatory, gap visible, spendable capped by cash after protection',
      { cash: 100n, current: 65n, mandatory: 35n, mandatoryDue: 45n, otherBalances: [] },
      {
        spendableNow: 55n,
        mandatoryProtected: 45n,
        mandatoryGap: 10n,
        freeToAssign: 0n,
        unbackedAssignments: 0n,
      },
    ],
    [
      'mandatory balance covering due: no gap, spendable limited by current balance',
      { cash: 200n, current: 50n, mandatory: 80n, mandatoryDue: 30n, otherBalances: [] },
      {
        spendableNow: 50n,
        mandatoryProtected: 80n,
        mandatoryGap: 0n,
        freeToAssign: 70n,
        unbackedAssignments: 0n,
      },
    ],
    [
      'negative current balance -10 creates no free cash',
      { cash: 0n, current: -10n, mandatory: 0n, mandatoryDue: 0n, otherBalances: [] },
      allZeros,
    ],
    [
      'negative other balance is not protected and does not increase spendable',
      { cash: 100n, current: 65n, mandatory: 0n, mandatoryDue: 0n, otherBalances: [-10n] },
      {
        spendableNow: 65n,
        mandatoryProtected: 0n,
        mandatoryGap: 0n,
        freeToAssign: 35n,
        unbackedAssignments: 0n,
      },
    ],
    [
      'protected savings 20 caps spendable without deducting unassigned wish 20',
      { cash: 50n, current: 65n, mandatory: 0n, mandatoryDue: 0n, otherBalances: [20n, -20n] },
      {
        spendableNow: 30n,
        mandatoryProtected: 0n,
        mandatoryGap: 0n,
        freeToAssign: 0n,
        unbackedAssignments: 35n,
      },
    ],
    [
      'cash shortage: spendable capped by protected cash, unbacked assignments visible',
      { cash: 50n, current: 80n, mandatory: 0n, mandatoryDue: 0n, otherBalances: [] },
      {
        spendableNow: 50n,
        mandatoryProtected: 0n,
        mandatoryGap: 0n,
        freeToAssign: 0n,
        unbackedAssignments: 30n,
      },
    ],
  ];

  it.each(spendableCases)('%s', (_label, input, expected) => {
    expect(calculateSpendable(input)).toEqual(expected);
  });

  it('spec example in minor units: cash 10 000 000, current 6 500 000 => spendable 5 500 000', () => {
    expect(
      calculateSpendable({
        cash: 10_000_000n,
        current: 6_500_000n,
        mandatory: 3_500_000n,
        mandatoryDue: 4_500_000n,
        otherBalances: [],
      }).spendableNow,
    ).toBe(5_500_000n);
  });
});

describe('overflow guard (PostgreSQL BIGINT range)', () => {
  const above = BIGINT_MAX + 1n;
  const below = -BIGINT_MAX - 2n;

  it('rejects inputs outside the BIGINT range with a typed error', () => {
    expect(() => periodFunded(above, 0n, 0n, 0n)).toThrow(V2MoneyOverflowError);
    expect(() => periodFunded(0n, above, 0n, 0n)).toThrow(V2MoneyOverflowError);
    expect(() => periodFunded(0n, 0n, above, 0n)).toThrow(V2MoneyOverflowError);
    expect(() => periodFunded(0n, 0n, 0n, above)).toThrow(V2MoneyOverflowError);
    expect(() => periodFunded(below, 0n, 0n, 0n)).toThrow(V2MoneyOverflowError);
    expect(() => assignmentBalance(above, 0n)).toThrow(V2MoneyOverflowError);
    expect(() => assignmentBalance(below, 0n)).toThrow(V2MoneyOverflowError);
    const spendable = (overrides: Partial<SpendableInput>): SpendableInput => ({
      cash: 0n,
      current: 0n,
      mandatory: 0n,
      mandatoryDue: 0n,
      otherBalances: [],
      ...overrides,
    });
    expect(() => calculateSpendable(spendable({ cash: above }))).toThrow(V2MoneyOverflowError);
    expect(() => calculateSpendable(spendable({ current: below }))).toThrow(V2MoneyOverflowError);
    expect(() => calculateSpendable(spendable({ mandatory: above }))).toThrow(V2MoneyOverflowError);
    expect(() => calculateSpendable(spendable({ mandatoryDue: below }))).toThrow(
      V2MoneyOverflowError,
    );
    expect(() => calculateSpendable(spendable({ otherBalances: [above] }))).toThrow(
      V2MoneyOverflowError,
    );
  });

  it('rejects sums that exceed the BIGINT range even with in-range inputs', () => {
    expect(() => periodFunded(BIGINT_MAX, 1n, 0n, 0n)).toThrow(V2MoneyOverflowError);
    expect(() => periodFunded(BIGINT_MAX, 0n, 1n, 0n)).toThrow(V2MoneyOverflowError);
    expect(() => assignmentBalance(-BIGINT_MAX - 1n, 1n)).toThrow(V2MoneyOverflowError);
    expect(() =>
      calculateSpendable({
        cash: 0n,
        current: BIGINT_MAX,
        mandatory: 1n,
        mandatoryDue: 0n,
        otherBalances: [],
      }),
    ).toThrow(V2MoneyOverflowError);
    expect(() =>
      calculateSpendable({
        cash: 0n,
        current: 0n,
        mandatory: 0n,
        mandatoryDue: 0n,
        otherBalances: [BIGINT_MAX, 1n],
      }),
    ).toThrow(V2MoneyOverflowError);
  });

  it('accepts values exactly on the BIGINT boundary', () => {
    expect(periodFunded(0n, BIGINT_MAX, 0n, 0n)).toBe(BIGINT_MAX);
    expect(periodFunded(-BIGINT_MAX, -1n, 0n, 0n)).toBe(-BIGINT_MAX - 1n);
    expect(assignmentBalance(-BIGINT_MAX, 1n)).toBe(-BIGINT_MAX - 1n);
    expect(
      calculateSpendable({
        cash: BIGINT_MAX,
        current: BIGINT_MAX,
        mandatory: 0n,
        mandatoryDue: 0n,
        otherBalances: [],
      }).spendableNow,
    ).toBe(BIGINT_MAX);
  });
});

describe('non-bigint money input', () => {
  it('rejects JavaScript number/float values', () => {
    expect(() => periodFunded(1 as unknown as bigint, 0n, 0n, 0n)).toThrow(TypeError);
    expect(() => periodFunded(0n, 1.5 as unknown as bigint, 0n, 0n)).toThrow(TypeError);
    expect(() => assignmentBalance(65 as unknown as bigint, 20n)).toThrow(TypeError);
    expect(() =>
      calculateSpendable({
        cash: 1 as unknown as bigint,
        current: 0n,
        mandatory: 0n,
        mandatoryDue: 0n,
        otherBalances: [],
      }),
    ).toThrow(TypeError);
    expect(() =>
      calculateSpendable({
        cash: 0n,
        current: 0n,
        mandatory: 0n,
        mandatoryDue: 0n,
        otherBalances: [1n, 1.5 as unknown as bigint],
      }),
    ).toThrow(TypeError);
  });
});
