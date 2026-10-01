import { describe, expect, it } from 'vitest';

import { cycleAndPeriodFor, type CycleSettings } from './cycle-period.domain.js';
import { previewCycleRevision } from './cycle-revision.domain.js';

const timezone = 'Europe/Moscow';
const settings = (cycleStartDay: number, periodBoundaryOffset: number): CycleSettings => ({
  cycleStartDay,
  periodBoundaryOffset,
  timezone,
});

function shift(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

type Interval = { start: string; end: string };

function expectContiguous(intervals: Interval[]): void {
  for (const [index, interval] of intervals.entries()) {
    expect(interval.start <= interval.end).toBe(true);
    if (index > 0) expect(shift(intervals[index - 1]!.end, 1)).toBe(interval.start);
  }
}

describe('previewCycleRevision', () => {
  it('follows the plan example with a truncated last slice', () => {
    const result = previewCycleRevision({
      oldSettings: settings(10, 15),
      newSettings: settings(1, 15),
      asOf: '2026-09-24',
      confirmedPeriodEnds: [{ id: 'p1', end: '2026-09-09' }],
    });
    expect(result.preservedPeriodIds).toEqual(['p1']);
    expect(result.effectiveOn).toBe('2026-10-01');
    expect(result.transitionRanges).toEqual([
      { start: '2026-09-10', end: '2026-09-24' },
      { start: '2026-09-25', end: '2026-09-30' },
    ]);
  });

  it('uses the last confirmed end as anchor when it is after asOf', () => {
    const result = previewCycleRevision({
      oldSettings: settings(10, 15),
      newSettings: settings(1, 15),
      asOf: '2026-09-12',
      confirmedPeriodEnds: [
        { id: 'p1', end: '2026-09-09' },
        { id: 'p2', end: '2026-09-24' },
        { id: 'p1', end: '2026-09-09' },
      ],
    });
    expect(result.preservedPeriodIds).toEqual(['p1', 'p2']);
    expect(result.effectiveOn).toBe('2026-10-01');
    expect(result.transitionRanges).toEqual([{ start: '2026-09-25', end: '2026-09-30' }]);
  });

  it('returns no ranges without gap', () => {
    const result = previewCycleRevision({
      oldSettings: settings(10, 15),
      newSettings: settings(1, 15),
      asOf: '2026-09-24',
      confirmedPeriodEnds: [{ id: 'p1', end: '2026-09-30' }],
    });
    expect(result.transitionRanges).toEqual([]);
    expect(result.effectiveOn).toBe('2026-10-01');
  });

  it('works without confirmed periods', () => {
    const result = previewCycleRevision({
      oldSettings: settings(10, 15),
      newSettings: settings(1, 15),
      asOf: '2026-09-24',
      confirmedPeriodEnds: [],
    });
    expect(result.preservedPeriodIds).toEqual([]);
    expect(result.transitionRanges[0]!.start).toBe('2026-09-10');
    expect(result.transitionRanges.at(-1)!.end).toBe('2026-09-30');
  });

  it.each(['2026-09-24', '2026-09-25', '2026-10-09', '2026-10-10'])(
    'has no gaps at boundary %s',
    (asOf) => {
      const result = previewCycleRevision({
        oldSettings: settings(10, 15),
        newSettings: settings(1, 15),
        asOf,
        confirmedPeriodEnds: [],
      });
      expectContiguous(result.transitionRanges);
      expect(shift(result.transitionRanges.at(-1)!.end, 1)).toBe(result.effectiveOn);
    },
  );

  it.each([
    ['2028-02-10', settings(28, 1), settings(10, 15)],
    ['2028-02-29', settings(10, 15), settings(28, 27)],
    ['2027-02-28', settings(28, 15), settings(1, 1)],
    ['2027-02-15', settings(10, 15), settings(28, 10)],
  ])('has no gaps across February for %s', (asOf, oldSettings, newSettings) => {
    const result = previewCycleRevision({
      oldSettings,
      newSettings,
      asOf,
      confirmedPeriodEnds: [],
    });
    expectContiguous(result.transitionRanges);
    expect(shift(result.transitionRanges.at(-1)!.end, 1)).toBe(result.effectiveOn);
  });

  it('covers every day exactly once on a grid', { timeout: 60_000 }, () => {
    const days = [1, 2, 10, 15, 25, 28];
    const offsets = [1, 9, 15, 27];
    const asOfs = [
      '2026-09-24',
      '2026-10-10',
      '2027-02-27',
      '2027-02-28',
      '2028-02-29',
      '2028-03-01',
    ];
    let checked = 0;
    for (const oldDay of days)
      for (const oldOffset of offsets)
        for (const newDay of days)
          for (const newOffset of offsets)
            for (const asOf of asOfs)
              for (const withConfirmed of [false, true]) {
                const oldSettings = settings(oldDay, oldOffset);
                const newSettings = settings(newDay, newOffset);
                const current = cycleAndPeriodFor(oldSettings, asOf).period;
                const confirmed: Array<Interval & { id: string }> = [];
                if (withConfirmed) {
                  const previous = cycleAndPeriodFor(oldSettings, shift(current.start, -1)).period;
                  confirmed.push({ id: 'c1', start: previous.start, end: previous.end });
                }
                const result = previewCycleRevision({
                  oldSettings,
                  newSettings,
                  asOf,
                  confirmedPeriodEnds: confirmed.map(({ id, end }) => ({ id, end })),
                });
                const timeline: Interval[] = [
                  ...confirmed.map(({ start, end }) => ({ start, end })),
                  ...result.transitionRanges,
                ];
                const limit = shift(result.effectiveOn, 62);
                let cursor = result.effectiveOn;
                while (cursor < limit) {
                  const period = cycleAndPeriodFor(newSettings, cursor).period;
                  expect(period.start).toBe(cursor);
                  timeline.push({ start: period.start, end: period.end });
                  cursor = shift(period.end, 1);
                }
                expectContiguous(timeline);
                // Transition must start right after confirmed history or at the old period start.
                if (confirmed.length > 0 && result.transitionRanges.length > 0) {
                  expect(result.transitionRanges[0]!.start).toBe(shift(confirmed[0]!.end, 1));
                }
                checked += 1;
              }
    expect(checked).toBe(days.length ** 2 * offsets.length ** 2 * asOfs.length * 2);
  });

  it('rejects invalid input with RangeError', () => {
    const base = {
      oldSettings: settings(10, 15),
      newSettings: settings(1, 15),
      asOf: '2026-09-24',
      confirmedPeriodEnds: [],
    };
    expect(() => previewCycleRevision({ ...base, newSettings: settings(0, 15) })).toThrow(
      RangeError,
    );
    expect(() => previewCycleRevision({ ...base, newSettings: settings(29, 15) })).toThrow(
      RangeError,
    );
    expect(() => previewCycleRevision({ ...base, oldSettings: settings(10, 0) })).toThrow(
      RangeError,
    );
    expect(() => previewCycleRevision({ ...base, oldSettings: settings(10, 28) })).toThrow(
      RangeError,
    );
    expect(() => previewCycleRevision({ ...base, asOf: '2026-02-30' })).toThrow(RangeError);
    expect(() => previewCycleRevision({ ...base, asOf: 'bad' })).toThrow(RangeError);
    expect(() =>
      previewCycleRevision({ ...base, confirmedPeriodEnds: [{ id: 'x', end: 'nope' }] }),
    ).toThrow(RangeError);
  });
});
