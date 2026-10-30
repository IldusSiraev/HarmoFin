import { describe, expect, it } from 'vitest';

import { calendarEventInputSchema, calendarFeedQuerySchema } from './calendar.schemas.js';

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
      reminderMinutes: null,
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
    expect(fields({ ...timed, reminderMinutes: 30 })).toContain('reminderMinutes');
    expect(fields({ ...timed, weekdays: [2, 2] })).toContain('weekdays');
  });

  it('trims the title and rejects a blank one and unknown fields', () => {
    expect(calendarEventInputSchema.parse({ ...timed, title: '  Врач  ' }).title).toBe('Врач');
    expect(fields({ ...timed, title: '   ' })).toContain('title');
    expect(calendarEventInputSchema.safeParse({ ...timed, color: 'red' }).success).toBe(false);
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
