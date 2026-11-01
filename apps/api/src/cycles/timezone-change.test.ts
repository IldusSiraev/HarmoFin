import { describe, expect, it } from 'vitest';

import { shiftWallClock } from './timezone-change.js';

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
