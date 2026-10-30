import type { CalendarRecurrence } from '@prisma/client';

import type { RecurringEvent } from './calendar-recurrence.js';
import type { CalendarEventInput } from './calendar.schemas.js';
import { localToUtc, utcToLocal } from './zoned-time.js';

export interface CalendarEventData {
  title: string;
  description: string | null;
  allDay: boolean;
  startsOn: Date | null;
  endsOn: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  recurrence: CalendarRecurrence;
  interval: number;
  weekdays: number[];
  repeatUntil: Date | null;
  reminderMinutes: number | null;
}

export interface CalendarEventRow extends CalendarEventData {
  id: string;
  budgetId: string;
  createdByUserId: string;
  deletedAt: Date | null;
  participantUserIds: string[];
}

const asDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

function minutesOfDay(time: string): number {
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return hour * 60 + minute;
}

export function toEventData(input: CalendarEventInput, timezone: string): CalendarEventData {
  const repeating = input.recurrence !== 'NONE';
  const common = {
    title: input.title,
    description: input.description,
    allDay: input.allDay,
    recurrence: input.recurrence,
    interval: repeating ? input.interval : 1,
    weekdays: input.recurrence === 'WEEKLY' ? input.weekdays : [],
    repeatUntil: repeating && input.repeatUntil ? asDate(input.repeatUntil) : null,
    reminderMinutes: input.reminderMinutes,
  };
  if (input.allDay) {
    return {
      ...common,
      startsOn: asDate(input.date),
      endsOn: asDate(input.endDate ?? input.date),
      startsAt: null,
      endsAt: null,
    };
  }
  const startsAt = localToUtc(input.date, input.startTime!, timezone);
  // Wall-clock duration in minutes, not a second `localToUtc` lookup: a DST transition between
  // the start and end local times would otherwise shift the end instant backward or by an extra
  // hour relative to the start instant, violating the day-or-time DB check.
  const durationMinutes = minutesOfDay(input.endTime!) - minutesOfDay(input.startTime!);
  return {
    ...common,
    startsOn: null,
    endsOn: null,
    startsAt,
    endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000),
  };
}

export function toLocalFields(
  row: CalendarEventData,
  timezone: string,
): { date: string; endDate: string; startTime: string | null; endTime: string | null } {
  if (row.allDay) {
    return {
      date: isoDate(row.startsOn!),
      endDate: isoDate(row.endsOn!),
      startTime: null,
      endTime: null,
    };
  }
  const start = utcToLocal(row.startsAt!, timezone);
  const end = utcToLocal(row.endsAt!, timezone);
  return { date: start.date, endDate: end.date, startTime: start.time, endTime: end.time };
}

export function toRecurringEvent(row: CalendarEventData, timezone: string): RecurringEvent {
  const local = toLocalFields(row, timezone);
  return {
    allDay: row.allDay,
    startDate: local.date,
    endDate: local.endDate,
    startTime: local.startTime,
    durationMinutes: row.allDay
      ? 0
      : Math.round((row.endsAt!.getTime() - row.startsAt!.getTime()) / 60_000),
    recurrence: row.recurrence,
    interval: row.interval,
    weekdays: row.weekdays,
    repeatUntil: row.repeatUntil ? isoDate(row.repeatUntil) : null,
  };
}
