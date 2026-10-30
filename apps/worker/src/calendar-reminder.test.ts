import { describe, expect, it } from 'vitest';

import type { Occurrence } from './calendar-recurrence.js';
import {
  isReminderDue,
  reminderBody,
  reminderKey,
  reminderMoment,
  reminderWindow,
} from './calendar-reminder.js';

const tz = 'Europe/Moscow';
const timed: Occurrence = {
  occurrenceDate: '2026-11-03',
  startDate: '2026-11-03',
  endDate: '2026-11-03',
  startsAt: '2026-11-03T14:00:00.000Z',
  endsAt: '2026-11-03T15:30:00.000Z',
  startTime: '17:00',
  endTime: '18:30',
};
const allDay: Occurrence = {
  occurrenceDate: '2026-11-03',
  startDate: '2026-11-03',
  endDate: '2026-11-03',
  startsAt: null,
  endsAt: null,
  startTime: null,
  endTime: null,
};

describe('calendar reminder rule', () => {
  it('a timed occurrence is reminded reminderMinutes before its start', () => {
    expect(reminderMoment(timed, 60, tz).toISOString()).toBe('2026-11-03T13:00:00.000Z');
  });

  it('an all-day occurrence counts from 09:00 in the budget time zone', () => {
    expect(reminderMoment(allDay, 1440, tz).toISOString()).toBe('2026-11-02T06:00:00.000Z');
  });

  it('is due only within the last 30 minutes', () => {
    const moment = new Date('2026-11-03T13:00:00.000Z');
    expect(isReminderDue(moment, new Date('2026-11-03T12:59:59.000Z'))).toBe(false);
    expect(isReminderDue(moment, new Date('2026-11-03T13:00:00.000Z'))).toBe(true);
    expect(isReminderDue(moment, new Date('2026-11-03T13:29:59.000Z'))).toBe(true);
    expect(isReminderDue(moment, new Date('2026-11-03T13:30:00.000Z'))).toBe(false);
  });

  it('the expansion window covers the lookback and the reminder lead', () => {
    // 02.11 21:10Z = 03.11 00:10 МСК; −30 мин → 02.11; +7 дней → 10.11; ±1 день запаса.
    expect(reminderWindow(new Date('2026-11-02T21:10:00.000Z'), 10080, tz)).toEqual({
      from: '2026-11-01',
      to: '2026-11-11',
    });
  });

  it('writes relative Russian copy', () => {
    const now = new Date('2026-11-03T13:00:00.000Z');
    expect(reminderBody(timed, now, tz)).toBe('Сегодня в 17:00');
    expect(reminderBody(allDay, new Date('2026-11-02T06:00:00.000Z'), tz)).toBe(
      'Завтра, весь день',
    );
    expect(
      reminderBody({ ...timed, startDate: '2026-11-10', occurrenceDate: '2026-11-10' }, now, tz),
    ).toBe('10 ноября в 17:00');
  });

  it('builds the dedupe key', () => {
    expect(reminderKey('event-1', '2026-11-03', 60)).toBe('calendar:event-1:2026-11-03:60');
  });
});
