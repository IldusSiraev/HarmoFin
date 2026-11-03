import { describe, expect, it } from 'vitest';

import {
  calendarEventInputSchema,
  calendarFeedQuerySchema,
  resolveReminders,
} from './calendar.schemas.js';

const timed = {
  title: 'Кружок рисования',
  allDay: false,
  date: '2026-11-03',
  startTime: '17:00',
  endTime: '18:30',
  recurrence: 'WEEKLY',
  weekdays: [2],
  participantUserIds: [],
};
const allDay = (extra: Record<string, unknown> = {}) => ({
  title: 'Поездка',
  allDay: true,
  date: '2026-10-31',
  recurrence: 'NONE',
  participantUserIds: [],
  ...extra,
});

function fields(value: unknown): string[] {
  const result = calendarEventInputSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('calendarEventInputSchema', () => {
  it('accepts a timed weekly event and fills defaults', () => {
    expect(calendarEventInputSchema.parse(timed)).toMatchObject({
      interval: 1,
      reminders: null,
      description: null,
      endDate: null,
      repeatUntil: null,
    });
  });

  it('accepts an all-day event without times', () => {
    expect(fields(allDay({ recurrence: 'YEARLY' }))).toEqual([]);
  });

  it('requires both times for a timed event and an end not before the start', () => {
    expect(fields({ ...timed, startTime: undefined })).toContain('startTime');
    expect(fields({ ...timed, endTime: '16:30' })).toContain('endTime');
  });

  it('rejects times on an all-day event, an end date before the date and a span over 31 days', () => {
    expect(fields({ ...timed, allDay: true })).toContain('startTime');
    expect(fields(allDay({ endDate: '2026-10-30' }))).toContain('endDate');
    expect(fields(allDay({ date: '2026-07-01', endDate: '2026-08-01' }))).toContain('endDate');
    expect(fields(allDay({ date: '2026-07-01', endDate: '2026-07-31' }))).toEqual([]);
  });

  it('checks weekdays, repeatUntil, interval and reminder', () => {
    expect(fields({ ...timed, weekdays: [] })).toContain('weekdays');
    expect(fields({ ...timed, recurrence: 'DAILY' })).toContain('weekdays');
    expect(fields({ ...timed, repeatUntil: '2026-11-01' })).toContain('repeatUntil');
    expect(
      fields({ ...timed, recurrence: 'NONE', weekdays: [], repeatUntil: '2026-12-01' }),
    ).toContain('repeatUntil');
    expect(fields({ ...timed, interval: 100 })).toContain('interval');
    expect(fields({ ...timed, reminderMinutes: 45 })).toContain('reminderMinutes');
    expect(fields({ ...timed, weekdays: [2, 2] })).toContain('weekdays');
  });

  it('trims the title and rejects a blank one and unknown fields', () => {
    expect(calendarEventInputSchema.parse({ ...timed, title: '  Врач  ' }).title).toBe('Врач');
    expect(fields({ ...timed, title: '   ' })).toContain('title');
    expect(calendarEventInputSchema.safeParse({ ...timed, color: 'red' }).success).toBe(false);
  });
});

describe('calendar reminders', () => {
  const messages = (value: unknown): string[] => {
    const result = calendarEventInputSchema.safeParse(value);
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  };

  it('sorts the reminders and accepts every offset of the list', () => {
    expect(
      calendarEventInputSchema.parse({ ...timed, reminders: [1440, 0, 60] }).reminders,
    ).toEqual([0, 60, 1440]);
    for (const minutes of [0, 5, 15, 30, 60, 120, 1440, 2880, 10080]) {
      expect(fields({ ...timed, reminders: [minutes] })).toEqual([]);
      expect(fields({ ...timed, reminderMinutes: minutes })).toEqual([]);
    }
  });

  it('maps the deprecated reminderMinutes onto reminders', () => {
    expect(calendarEventInputSchema.parse({ ...timed, reminderMinutes: 60 }).reminders).toEqual([
      60,
    ]);
    expect(calendarEventInputSchema.parse({ ...timed, reminderMinutes: null }).reminders).toEqual(
      [],
    );
    expect(calendarEventInputSchema.parse(timed)).not.toHaveProperty('reminderMinutes');
  });

  it('accepts both fields when reminderMinutes is the smallest reminder', () => {
    expect(
      calendarEventInputSchema.parse({ ...timed, reminders: [60, 15], reminderMinutes: 15 })
        .reminders,
    ).toEqual([15, 60]);
    expect(
      calendarEventInputSchema.parse({ ...timed, reminders: [], reminderMinutes: null }).reminders,
    ).toEqual([]);
  });

  it('rejects four reminders, an unknown offset, repeats and disagreeing fields', () => {
    expect(fields({ ...timed, reminders: [0, 5, 15, 30] })).toEqual(['reminders']);
    expect(messages({ ...timed, reminders: [0, 5, 15, 30] })).toEqual([
      'Можно выбрать до трёх напоминаний.',
    ]);
    expect(fields({ ...timed, reminders: [45] })).toEqual(['reminders.0']);
    expect(messages({ ...timed, reminders: [45] })).toEqual(['Выберите напоминание из списка.']);
    expect(messages({ ...timed, reminders: [60, 60] })).toEqual([
      'Напоминания не должны повторяться.',
    ]);
    expect(messages({ ...timed, reminders: [15, 60], reminderMinutes: 60 })).toEqual([
      'Напоминания не совпадают с reminderMinutes.',
    ]);
    expect(messages({ ...timed, reminders: [], reminderMinutes: 60 })).toEqual([
      'Напоминания не совпадают с reminderMinutes.',
    ]);
  });
});

describe('resolveReminders', () => {
  it('prefers reminders, then reminderMinutes, and says null when neither is given', () => {
    expect(resolveReminders([60, 5], 5)).toEqual([5, 60]);
    expect(resolveReminders(undefined, 1440)).toEqual([1440]);
    expect(resolveReminders(undefined, null)).toEqual([]);
    expect(resolveReminders(undefined, undefined)).toBeNull();
  });
});

describe('calendarFeedQuerySchema', () => {
  it('parses a range and the flag', () => {
    expect(
      calendarFeedQuerySchema.parse({
        from: '2026-10-26',
        to: '2026-12-06',
        includePlans: 'false',
      }),
    ).toEqual({ from: '2026-10-26', to: '2026-12-06', includePlans: false });
  });

  it('rejects a reversed range and a range longer than 62 days', () => {
    expect(
      calendarFeedQuerySchema.safeParse({ from: '2026-11-02', to: '2026-11-01' }).success,
    ).toBe(false);
    expect(
      calendarFeedQuerySchema.safeParse({ from: '2026-01-01', to: '2026-03-04' }).success,
    ).toBe(false);
    expect(
      calendarFeedQuerySchema.safeParse({ from: '2026-01-01', to: '2026-03-03' }).success,
    ).toBe(true);
  });
});
