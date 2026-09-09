import { describe, expect, it } from 'vitest';

import { datesForPlanInWindow } from './recurrence.js';

function plan(overrides: Partial<Parameters<typeof datesForPlanInWindow>[0]> = {}) {
  return {
    anchorOn: '2026-01-31',
    startOn: '2026-01-31',
    endOn: null,
    recurrence: 'MONTHLY' as const,
    intervalMonths: null,
    ...overrides,
  };
}

describe('datesForPlanInWindow', () => {
  it.each([
    ['monthly 31 clamps in non-leap February', plan(), '2026-02-28'],
    [
      'yearly leap-day clamps in 2027',
      plan({ anchorOn: '2024-02-29', startOn: '2024-02-29', recurrence: 'YEARLY' }),
      '2027-02-28',
    ],
    [
      'every three months preserves anchor',
      plan({ recurrence: 'EVERY_N_MONTHS', intervalMonths: 3 }),
      '2026-04-30',
    ],
  ])('%s', (_name, input, expected) => {
    expect(datesForPlanInWindow(input, { from: '2026-01-01', to: '2027-12-31' })).toContain(
      expected,
    );
  });

  it('excludes dates outside plan end date and requested window', () => {
    expect(
      datesForPlanInWindow(plan({ endOn: '2026-03-31' }), {
        from: '2026-02-01',
        to: '2026-04-30',
      }),
    ).toEqual(['2026-02-28', '2026-03-31']);
  });

  it('emits one-time plan only on start date', () => {
    expect(
      datesForPlanInWindow(plan({ recurrence: 'ONE_TIME' }), {
        from: '2026-01-01',
        to: '2026-12-31',
      }),
    ).toEqual(['2026-01-31']);
  });
});
