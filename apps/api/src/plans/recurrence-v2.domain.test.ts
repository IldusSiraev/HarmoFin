import { describe, expect, it } from 'vitest';

import { datesForPlanV2InWindow, type RecurrencePlanV2 } from './recurrence-v2.domain.js';

const plan = (over: Partial<RecurrencePlanV2>): RecurrencePlanV2 => ({
  anchorOn: '2026-01-31',
  startOn: '2026-01-31',
  endOn: null,
  recurrence: 'MONTHLY',
  intervalMonths: null,
  ...over,
});

// Golden cases mirror apps/worker/src/recurrence.ts (same calendar rules).
describe('datesForPlanV2InWindow (equivalent to worker recurrence)', () => {
  it('ONE_TIME returns startOn only inside window and endOn', () => {
    const p = plan({ recurrence: 'ONE_TIME', startOn: '2026-03-10', anchorOn: '2026-03-10' });
    expect(datesForPlanV2InWindow(p, { from: '2026-03-01', to: '2026-03-31' })).toEqual([
      '2026-03-10',
    ]);
    expect(datesForPlanV2InWindow(p, { from: '2026-03-11', to: '2026-03-31' })).toEqual([]);
    expect(
      datesForPlanV2InWindow(
        { ...p, endOn: '2026-03-09' },
        { from: '2026-03-01', to: '2026-03-31' },
      ),
    ).toEqual([]);
  });

  it('MONTHLY clamps the anchor day to month end, including leap year', () => {
    expect(datesForPlanV2InWindow(plan({}), { from: '2026-01-01', to: '2026-04-30' })).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    expect(
      datesForPlanV2InWindow(plan({ anchorOn: '2028-01-31', startOn: '2028-01-31' }), {
        from: '2028-02-01',
        to: '2028-02-29',
      }),
    ).toEqual(['2028-02-29']);
  });

  it('MONTHLY never emits dates before startOn or after endOn', () => {
    expect(
      datesForPlanV2InWindow(
        plan({ anchorOn: '2026-01-10', startOn: '2026-02-15', endOn: '2026-04-10' }),
        { from: '2026-01-01', to: '2026-12-31' },
      ),
    ).toEqual(['2026-03-10', '2026-04-10']);
  });

  it('EVERY_N_MONTHS steps from the startOn month', () => {
    expect(
      datesForPlanV2InWindow(
        plan({
          recurrence: 'EVERY_N_MONTHS',
          intervalMonths: 3,
          anchorOn: '2026-01-30',
          startOn: '2026-01-30',
        }),
        { from: '2026-01-01', to: '2026-12-31' },
      ),
    ).toEqual(['2026-01-30', '2026-04-30', '2026-07-30', '2026-10-30']);
    expect(
      datesForPlanV2InWindow(plan({ recurrence: 'EVERY_N_MONTHS', intervalMonths: 0 }), {
        from: '2026-01-01',
        to: '2026-12-31',
      }),
    ).toEqual([]);
  });

  it('YEARLY clamps Feb 29 on non-leap years', () => {
    expect(
      datesForPlanV2InWindow(
        plan({ recurrence: 'YEARLY', anchorOn: '2028-02-29', startOn: '2027-01-01' }),
        { from: '2027-01-01', to: '2029-12-31' },
      ),
    ).toEqual(['2027-02-28', '2028-02-29', '2029-02-28']);
  });

  it('returns nothing for an inverted window or an ended plan', () => {
    expect(datesForPlanV2InWindow(plan({}), { from: '2026-05-01', to: '2026-04-01' })).toEqual([]);
    expect(
      datesForPlanV2InWindow(plan({ endOn: '2026-01-01' }), {
        from: '2026-02-01',
        to: '2026-03-01',
      }),
    ).toEqual([]);
  });
});
