import { describe, expect, it } from 'vitest';

import { calendarEventInputSchema } from './calendar.schemas.js';
import { toEventData, toLocalFields, toRecurringEvent } from './calendar-event.mapper.js';

const tz = 'Europe/Moscow';

describe('calendar event mapper', () => {
  it('stores a timed event as UTC instants of the budget time zone', () => {
    const data = toEventData(
      calendarEventInputSchema.parse({
        title: 'Кружок',
        allDay: false,
        date: '2026-11-03',
        startTime: '17:00',
        endTime: '18:30',
        recurrence: 'WEEKLY',
        weekdays: [2],
        participantUserIds: [],
        reminderMinutes: 60,
      }),
      tz,
    );
    expect(data).toMatchObject({
      allDay: false,
      startsOn: null,
      endsOn: null,
      startsAt: new Date('2026-11-03T14:00:00.000Z'),
      endsAt: new Date('2026-11-03T15:30:00.000Z'),
      recurrence: 'WEEKLY',
      interval: 1,
      weekdays: [2],
      repeatUntil: null,
      reminderMinutes: 60,
    });
    expect(toRecurringEvent(data, tz)).toEqual({
      allDay: false,
      startDate: '2026-11-03',
      endDate: '2026-11-03',
      startTime: '17:00',
      durationMinutes: 90,
      recurrence: 'WEEKLY',
      interval: 1,
      weekdays: [2],
      repeatUntil: null,
    });
    expect(toLocalFields(data, tz)).toEqual({
      date: '2026-11-03',
      endDate: '2026-11-03',
      startTime: '17:00',
      endTime: '18:30',
    });
  });

  it('stores an all-day event as dates; the end date defaults to the date', () => {
    const data = toEventData(
      calendarEventInputSchema.parse({
        title: 'День рождения',
        allDay: true,
        date: '2026-10-18',
        recurrence: 'YEARLY',
        participantUserIds: [],
      }),
      tz,
    );
    expect(data).toMatchObject({
      startsOn: new Date('2026-10-18T00:00:00.000Z'),
      endsOn: new Date('2026-10-18T00:00:00.000Z'),
      startsAt: null,
      endsAt: null,
    });
    expect(toRecurringEvent(data, tz)).toMatchObject({
      allDay: true,
      startDate: '2026-10-18',
      endDate: '2026-10-18',
      startTime: null,
      durationMinutes: 0,
    });
  });

  it('keeps the wall-clock duration across a spring-forward DST gap', () => {
    const data = toEventData(
      calendarEventInputSchema.parse({
        title: 'Переход на летнее время',
        allDay: false,
        date: '2026-03-08',
        startTime: '02:30',
        endTime: '03:00',
        recurrence: 'NONE',
        participantUserIds: [],
      }),
      'America/New_York',
    );
    expect(data.startsAt).toEqual(new Date('2026-03-08T07:30:00.000Z'));
    expect(data.endsAt).toEqual(new Date('2026-03-08T08:00:00.000Z'));
    expect(data.endsAt!.getTime()).toBeGreaterThanOrEqual(data.startsAt!.getTime());
    expect(data.endsAt!.getTime() - data.startsAt!.getTime()).toBeLessThanOrEqual(24 * 3_600_000);
  });

  it('keeps the wall-clock duration across a fall-back DST day', () => {
    const data = toEventData(
      calendarEventInputSchema.parse({
        title: 'Переход на зимнее время',
        allDay: false,
        date: '2026-11-01',
        startTime: '00:00',
        endTime: '23:59',
        recurrence: 'NONE',
        participantUserIds: [],
      }),
      'America/New_York',
    );
    expect(data.startsAt).toEqual(new Date('2026-11-01T04:00:00.000Z'));
    expect(data.endsAt).toEqual(new Date('2026-11-02T03:59:00.000Z'));
    expect(data.endsAt!.getTime()).toBeGreaterThanOrEqual(data.startsAt!.getTime());
    expect(data.endsAt!.getTime() - data.startsAt!.getTime()).toBeLessThanOrEqual(24 * 3_600_000);
  });

  it('normalizes interval, weekdays and repeatUntil for a non-repeating event', () => {
    const data = toEventData(
      calendarEventInputSchema.parse({
        title: 'Разовая встреча',
        allDay: false,
        date: '2026-11-03',
        startTime: '09:00',
        endTime: '10:00',
        recurrence: 'NONE',
        interval: 5,
        participantUserIds: [],
      }),
      tz,
    );
    expect(data).toMatchObject({ interval: 1, weekdays: [], repeatUntil: null });
  });
});
