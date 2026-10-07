import { describe, expect, it } from 'vitest';
import { suggestFunding } from './rule-engine.js';

type Rule = Parameters<typeof suggestFunding>[0]['orderedRules'][number];

const rule = (over: Partial<Rule> & Pick<Rule, 'envelopeId'>): Rule => ({
  periodId: null,
  priority: 1,
  kind: 'SUM_OF_PLANS',
  needMinor: 0n,
  ...over,
});

const sum = (lines: Array<{ amountMinor: bigint }>) =>
  lines.reduce((total, line) => total + line.amountMinor, 0n);

describe('suggestFunding', () => {
  it('funds mandatory first, then current period target', () => {
    const lines = suggestFunding({
      available: 80_000n,
      incomeAmount: 80_000n,
      orderedRules: [
        rule({ envelopeId: 'mandatory', priority: 1, needMinor: 40_000n }),
        rule({ envelopeId: 'current', periodId: 'p1', priority: 2, needMinor: 65_000n }),
      ],
    });
    expect(lines).toEqual([
      { envelopeId: 'mandatory', periodId: null, amountMinor: 40_000n },
      { envelopeId: 'current', periodId: 'p1', amountMinor: 40_000n },
    ]);
  });

  it('second income covers remaining current need then savings', () => {
    const lines = suggestFunding({
      available: 30_000n,
      incomeAmount: 30_000n,
      orderedRules: [
        rule({ envelopeId: 'current', periodId: 'p1', priority: 2, needMinor: 25_000n }),
        rule({ envelopeId: 'savings', priority: 3, kind: 'SUGGESTED_FIXED', needMinor: 100_000n }),
      ],
    });
    expect(lines.map((l) => [l.envelopeId, l.amountMinor])).toEqual([
      ['current', 25_000n],
      ['savings', 5_000n],
    ]);
  });

  it('need is an input: old spending from funded period does not change it, explicit movementOut does', () => {
    const base = { available: 100_000n, incomeAmount: null };
    // Fully funded period: need 0 regardless of a past 20k expense.
    const funded = suggestFunding({
      ...base,
      orderedRules: [rule({ envelopeId: 'cur', periodId: 'p', needMinor: 0n })],
    });
    expect(funded).toEqual([]);
    // Explicit movementOut of 10k raises need by 10k.
    const moved = suggestFunding({
      ...base,
      orderedRules: [rule({ envelopeId: 'cur', periodId: 'p', needMinor: 10_000n })],
    });
    expect(moved).toEqual([{ envelopeId: 'cur', periodId: 'p', amountMinor: 10_000n }]);
  });

  it('category override yields a single line replacing rule suggestions', () => {
    const lines = suggestFunding({
      available: 50_000n,
      incomeAmount: 30_000n,
      orderedRules: [rule({ envelopeId: 'a', needMinor: 99_000n })],
      categoryOverride: { envelopeId: 'repair', periodId: 'p9' },
    });
    expect(lines).toEqual([{ envelopeId: 'repair', periodId: 'p9', amountMinor: 30_000n }]);
    const capped = suggestFunding({
      available: 10_000n,
      incomeAmount: 30_000n,
      orderedRules: [],
      categoryOverride: { envelopeId: 'repair', periodId: null },
    });
    expect(capped).toEqual([{ envelopeId: 'repair', periodId: null, amountMinor: 10_000n }]);
    const noIncome = suggestFunding({
      available: 7n,
      incomeAmount: null,
      orderedRules: [],
      categoryOverride: { envelopeId: 'repair', periodId: null },
    });
    expect(noIncome[0]?.amountMinor).toBe(7n);
  });

  it('percent of income floors; 1 kopeck at 30% gives no line', () => {
    const lines = suggestFunding({
      available: 1n,
      incomeAmount: 1n,
      orderedRules: [
        rule({ envelopeId: 'p', kind: 'PERCENT_OF_INCOME', percentBasisPoints: 3000 }),
      ],
    });
    expect(lines).toEqual([]);
  });

  it('percent of income subtracts already allocated and never goes negative', () => {
    const mk = (already: bigint) =>
      suggestFunding({
        available: 100_000n,
        incomeAmount: 10_000n,
        orderedRules: [
          rule({
            envelopeId: 'p',
            kind: 'PERCENT_OF_INCOME',
            percentBasisPoints: 3000,
            alreadyAllocatedFromIncomeMinor: already,
          }),
        ],
      });
    expect(mk(0n)[0]?.amountMinor).toBe(3_000n);
    expect(mk(1_000n)[0]?.amountMinor).toBe(2_000n);
    expect(mk(5_000n)).toEqual([]);
  });

  it('lineId возвращается в строке; строка без lineId не содержит поля', () => {
    const lines = suggestFunding({
      available: 1_000n,
      incomeAmount: null,
      orderedRules: [
        rule({ envelopeId: 'mandatory', needMinor: 400n, lineId: 'm||MANDATORY_CURRENT' }),
        rule({ envelopeId: 'current', periodId: 'p1', priority: 2, needMinor: 600n }),
      ],
    });
    expect(lines.map((l) => `${l.envelopeId}:${l.amountMinor}:${l.lineId ?? '-'}`)).toEqual([
      'mandatory:400:m||MANDATORY_CURRENT',
      'current:600:-',
    ]);
  });

  it('слот slotAfterPeriod идёт после обычных строк даже с меньшим приоритетом', () => {
    const lines = suggestFunding({
      available: 400n,
      incomeAmount: null,
      orderedRules: [
        rule({
          envelopeId: 'next',
          priority: 1,
          needMinor: 100n,
          lineId: 'm||MANDATORY_NEXT',
          slotAfterPeriod: true,
        }),
        rule({ envelopeId: 'cur', periodId: 'p1', priority: 0, needMinor: 200n }),
        rule({
          envelopeId: 'mandatory',
          priority: 2,
          needMinor: 100n,
          lineId: 'm||MANDATORY_CURRENT',
        }),
      ],
    });
    expect(lines.map((l) => `${l.envelopeId}:${l.amountMinor}`)).toEqual([
      'cur:200',
      'mandatory:100',
      'next:100',
    ]);
    expect(lines[2]?.lineId).toBe('m||MANDATORY_NEXT');
  });

  it('нулевая потребность не даёт строки, даже если задан lineId', () => {
    const lines = suggestFunding({
      available: 100n,
      incomeAmount: null,
      orderedRules: [
        rule({ envelopeId: 'm', needMinor: 0n, lineId: 'm||MANDATORY_NEXT' }),
        rule({ envelopeId: 'c', priority: 2, needMinor: 50n }),
      ],
    });
    expect(lines).toEqual([{ envelopeId: 'c', periodId: null, amountMinor: 50n }]);
  });

  it('orders by priority, envelopeId, then periodId deterministically', () => {
    const rules = [
      rule({ envelopeId: 'b', priority: 1, needMinor: 1n }),
      rule({ envelopeId: 'a', periodId: 'p2', priority: 1, needMinor: 1n }),
      rule({ envelopeId: 'a', periodId: 'p1', priority: 1, needMinor: 1n }),
      rule({ envelopeId: 'z', priority: 0, needMinor: 1n }),
    ];
    const lines = suggestFunding({ available: 100n, incomeAmount: null, orderedRules: rules });
    expect(lines.map((l) => `${l.envelopeId}:${l.periodId}`)).toEqual([
      'z:null',
      'a:p1',
      'a:p2',
      'b:null',
    ]);
  });

  it('empty rules, negative need and negative available give nothing', () => {
    expect(suggestFunding({ available: 10n, incomeAmount: null, orderedRules: [] })).toEqual([]);
    expect(
      suggestFunding({
        available: 10n,
        incomeAmount: null,
        orderedRules: [rule({ envelopeId: 'a', needMinor: -5n })],
      }),
    ).toEqual([]);
    expect(
      suggestFunding({
        available: -10n,
        incomeAmount: null,
        orderedRules: [rule({ envelopeId: 'a', needMinor: 5n })],
      }),
    ).toEqual([]);
  });

  it('does not mutate input', () => {
    const rules = [
      rule({ envelopeId: 'b', priority: 2, needMinor: 5n }),
      rule({ envelopeId: 'a', priority: 1, needMinor: 5n }),
    ];
    const snapshot = structuredClone(rules);
    suggestFunding({ available: 100n, incomeAmount: null, orderedRules: rules });
    expect(rules).toEqual(snapshot);
  });

  it('property: sum never exceeds available and lines are positive (seeded PRNG)', () => {
    let state = 123456789;
    const next = (max: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state % max;
    };
    const kinds = [
      'SUM_OF_PLANS',
      'FIXED_PER_PERIOD',
      'SUGGESTED_FIXED',
      'PERCENT_OF_INCOME',
    ] as const;
    for (let i = 0; i < 300; i += 1) {
      const available = BigInt(next(200_000) - 10_000);
      const income = next(4) === 0 ? null : BigInt(next(200_000));
      const orderedRules = Array.from({ length: next(6) }, (_, j) =>
        rule({
          envelopeId: `e${next(4)}`,
          periodId: next(2) === 0 ? null : `p${j}`,
          priority: next(3),
          kind: kinds[next(4)] as Rule['kind'],
          needMinor: BigInt(next(120_000) - 20_000),
          percentBasisPoints: next(10_001),
          alreadyAllocatedFromIncomeMinor: BigInt(next(20_000)),
        }),
      );
      const lines = suggestFunding({ available, incomeAmount: income, orderedRules });
      expect(sum(lines)).toBeLessThanOrEqual(available > 0n ? available : 0n);
      for (const line of lines) expect(line.amountMinor > 0n).toBe(true);
    }
  });
});
