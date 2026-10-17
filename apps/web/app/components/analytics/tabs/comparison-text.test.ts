import { describe, expect, it } from 'vitest';

import type { PeriodComparisonV2Row } from '../../../composables/useEnvelopePlanV2.js';
import { comparisonText } from './comparison-text.js';

const base: PeriodComparisonV2Row = {
  asOf: '2026-03-20',
  periodStart: '2026-03-15',
  periodEnd: '2026-03-31',
  daysElapsed: 6,
  spentMinor: '80000',
  limitTotalMinor: '500000',
  spentOfLimitPermille: 160,
  previousPeriodStart: '2026-03-01',
  previousPeriodEnd: '2026-03-14',
  previousSameDaySpentMinor: '100000',
  previousTotalSpentMinor: '150000',
  deltaMinor: '-20000',
  deltaBasisPoints: -2000,
};
const flat = (text: string) => text.replace(/\s/g, ' ');

describe('comparisonText', () => {
  it('меньше, чем к этому дню прошлого периода', () => {
    expect(flat(comparisonText(base))).toBe(
      'К этому дню прошлого периода: на 20% меньше (−200,00 ₽).',
    );
  });

  it('больше', () => {
    expect(flat(comparisonText({ ...base, deltaMinor: '5000', deltaBasisPoints: 500 }))).toBe(
      'К этому дню прошлого периода: на 5% больше (+50,00 ₽).',
    );
  });

  it('столько же', () => {
    expect(comparisonText({ ...base, deltaMinor: '0', deltaBasisPoints: 0 })).toBe(
      'Столько же, сколько к этому дню прошлого периода.',
    );
  });

  it('в прошлом периоде расходов не было', () => {
    expect(
      comparisonText({ ...base, previousSameDaySpentMinor: '0', deltaBasisPoints: null }),
    ).toBe('В прошлом периоде к этому дню расходов не было.');
  });

  it('меньше 1% показывается без нуля процентов', () => {
    expect(flat(comparisonText({ ...base, deltaMinor: '-50', deltaBasisPoints: -5 }))).toBe(
      'К этому дню прошлого периода: меньше чем на 1% (−0,50 ₽).',
    );
  });
});
