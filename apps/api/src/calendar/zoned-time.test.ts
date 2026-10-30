import { describe, expect, it } from 'vitest';

import { localToUtc, utcToLocal } from './zoned-time.js';

describe('zoned time', () => {
  it('converts local Moscow time to UTC and back', () => {
    const instant = localToUtc('2026-11-03', '17:00', 'Europe/Moscow');
    expect(instant.toISOString()).toBe('2026-11-03T14:00:00.000Z');
    expect(utcToLocal(instant, 'Europe/Moscow')).toEqual({ date: '2026-11-03', time: '17:00' });
  });

  it('uses the summer offset before and the winter offset after the Berlin switch', () => {
    expect(localToUtc('2026-10-24', '12:00', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-24T10:00:00.000Z',
    );
    expect(localToUtc('2026-10-26', '12:00', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-26T11:00:00.000Z',
    );
  });

  it('moves a non-existent spring local time forward', () => {
    // 29.03.2026 02:30 does not exist in Berlin; it becomes 03:30 CEST (01:30Z).
    expect(localToUtc('2026-03-29', '02:30', 'Europe/Berlin').toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
  });

  it('takes the first (summer) instant of an ambiguous autumn local time', () => {
    // 25.10.2026 02:30 happens twice in Berlin; the first is CEST (00:30Z).
    expect(localToUtc('2026-10-25', '02:30', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });
});
