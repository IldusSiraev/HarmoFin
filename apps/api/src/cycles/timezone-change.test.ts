import { describe, expect, it } from 'vitest';

import { shiftTimedEvent, shiftWallClock } from './timezone-change.js';

describe('shiftWallClock', () => {
  it('keeps wall-clock time when moving Moscow -> Yekaterinburg', () => {
    // 18:00 Moscow (UTC+3) = 15:00Z; 18:00 Yekaterinburg (UTC+5) = 13:00Z
    expect(
      shiftWallClock(new Date('2026-11-05T15:00:00Z'), 'Europe/Moscow', 'Asia/Yekaterinburg'),
    ).toEqual(new Date('2026-11-05T13:00:00Z'));
  });

  it('uses the offset on the event date (DST zone)', () => {
    // 10:00 Berlin in July (UTC+2) = 08:00Z -> 10:00 UTC
    expect(shiftWallClock(new Date('2026-07-01T08:00:00Z'), 'Europe/Berlin', 'UTC')).toEqual(
      new Date('2026-07-01T10:00:00Z'),
    );
  });

  it('is the identity for the same zone', () => {
    const instant = new Date('2026-11-05T15:00:00Z');
    expect(shiftWallClock(instant, 'Europe/Moscow', 'Europe/Moscow')).toEqual(instant);
  });
});

describe('shiftTimedEvent', () => {
  it('preserves stored duration when the target zone has a spring-forward gap', () => {
    // 02:30 UTC wall clock moved to Berlin on 2027-03-28 lands in the 02:00-03:00 gap, so shifting
    // start and end independently would collapse or distort the 30 minute event.
    const startsAt = new Date('2027-03-28T02:30:00Z');
    const endsAt = new Date('2027-03-28T03:00:00Z');
    const shifted = shiftTimedEvent(startsAt, endsAt, 'UTC', 'Europe/Berlin');
    expect(shifted.endsAt.getTime() - shifted.startsAt.getTime()).toBe(30 * 60_000);
  });

  it('shifts both instants by the same wall-clock rule outside gaps', () => {
    const shifted = shiftTimedEvent(
      new Date('2026-12-05T15:00:00Z'),
      new Date('2026-12-05T16:00:00Z'),
      'Europe/Moscow',
      'Asia/Yekaterinburg',
    );
    expect(shifted.startsAt).toEqual(new Date('2026-12-05T13:00:00Z'));
    expect(shifted.endsAt).toEqual(new Date('2026-12-05T14:00:00Z'));
  });
});
