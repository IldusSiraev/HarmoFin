import { describe, expect, it } from 'vitest';

import { digestDedupeKey, digestSlot, digestWindowStart } from './digest-schedule.js';

const DAY = 86_400_000;

describe('digestSlot', () => {
  it('is due from 08:00 to 11:59 local time', () => {
    // Moscow is UTC+3 all year.
    expect(digestSlot(new Date('2026-10-31T04:59:00.000Z'), 'Europe/Moscow', 'DAILY')).toBeNull();
    expect(digestSlot(new Date('2026-10-31T05:00:00.000Z'), 'Europe/Moscow', 'DAILY')).toBe(
      '2026-10-31',
    );
    expect(digestSlot(new Date('2026-10-31T08:59:00.000Z'), 'Europe/Moscow', 'DAILY')).toBe(
      '2026-10-31',
    );
    expect(digestSlot(new Date('2026-10-31T09:00:00.000Z'), 'Europe/Moscow', 'DAILY')).toBeNull();
  });

  it('sends the weekly digest on Monday only', () => {
    // 2026-11-02 is a Monday.
    expect(digestSlot(new Date('2026-11-02T06:00:00.000Z'), 'Europe/Moscow', 'WEEKLY')).toBe(
      '2026-11-02',
    );
    expect(digestSlot(new Date('2026-11-03T06:00:00.000Z'), 'Europe/Moscow', 'WEEKLY')).toBeNull();
  });

  it('follows daylight saving time', () => {
    // Berlin: UTC+2 until 25 Oct 2026, UTC+1 after.
    expect(digestSlot(new Date('2026-10-24T06:00:00.000Z'), 'Europe/Berlin', 'DAILY')).toBe(
      '2026-10-24',
    );
    expect(digestSlot(new Date('2026-10-26T06:00:00.000Z'), 'Europe/Berlin', 'DAILY')).toBeNull();
    expect(digestSlot(new Date('2026-10-26T07:00:00.000Z'), 'Europe/Berlin', 'DAILY')).toBe(
      '2026-10-26',
    );
  });
});

describe('digestWindowStart', () => {
  const now = new Date('2026-10-31T05:00:00.000Z');

  it('continues from the previous digest', () => {
    const previous = new Date('2026-10-30T05:10:00.000Z');
    expect(digestWindowStart(now, 'DAILY', previous)).toEqual(previous);
  });

  it('never looks back further than the frequency allows', () => {
    expect(digestWindowStart(now, 'DAILY', null)).toEqual(new Date(now.getTime() - DAY));
    expect(digestWindowStart(now, 'WEEKLY', new Date('2026-09-01T00:00:00.000Z'))).toEqual(
      new Date(now.getTime() - 7 * DAY),
    );
  });
});

describe('digestDedupeKey', () => {
  it('names the frequency and the local date', () => {
    expect(digestDedupeKey('WEEKLY', '2026-11-02')).toBe('digest:WEEKLY:2026-11-02');
  });
});
