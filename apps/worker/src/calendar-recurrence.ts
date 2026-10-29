// Copy of apps/api/src/calendar/calendar-recurrence.ts; both are checked against fixtures/calendar-recurrence/cases.json. Change them together.
import { localToUtc, utcToLocal } from './zoned-time.js';

export type CalendarRecurrence = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/** An event rule in the budget's local wall-clock terms. */
export interface RecurringEvent {
  allDay: boolean;
  startDate: string;
  /** All day: last day; timed: local date the first occurrence ends on. */
  endDate: string;
  startTime: string | null;
  durationMinutes: number;
  recurrence: CalendarRecurrence;
  interval: number;
  /** ISO weekdays 1 (Mon) … 7 (Sun); WEEKLY only. */
  weekdays: number[];
  repeatUntil: string | null;
}

export interface Occurrence {
  /** Local start date: the occurrence id within the series. */
  occurrenceDate: string;
  startDate: string;
  endDate: string;
  startsAt: string | null;
  endsAt: string | null;
  startTime: string | null;
  endTime: string | null;
}

const DAY_MS = 86_400_000;

function toUtcDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

function fromUtcDay(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromUtcDay(toUtcDay(date) + days * DAY_MS);
}

function daysBetween(from: string, to: string): number {
  return Math.round((toUtcDay(to) - toUtcDay(from)) / DAY_MS);
}

export function isoWeekday(date: string): number {
  const day = new Date(toUtcDay(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

function clampedDate(year: number, monthIndex: number, day: number): string {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return fromUtcDay(Date.UTC(year, monthIndex, Math.min(day, last)));
}

/** Local start dates of the series between `lo` and `hi` inclusive. */
function startDates(event: RecurringEvent, lo: string, hi: string): string[] {
  const start = event.startDate;
  const last = event.repeatUntil && event.repeatUntil < hi ? event.repeatUntil : hi;
  const from = lo > start ? lo : start;
  if (from > last) return [];
  if (event.recurrence === 'NONE') return start >= lo && start <= last ? [start] : [];

  const dates: string[] = [];
  if (event.recurrence === 'DAILY') {
    const skip = Math.ceil(daysBetween(start, from) / event.interval);
    for (let date = addDays(start, skip * event.interval); date <= last;) {
      dates.push(date);
      date = addDays(date, event.interval);
    }
    return dates;
  }
  if (event.recurrence === 'WEEKLY') {
    const startMonday = addDays(start, 1 - isoWeekday(start));
    for (let date = from; date <= last; date = addDays(date, 1)) {
      const monday = addDays(date, 1 - isoWeekday(date));
      const week = daysBetween(startMonday, monday) / 7;
      if (week % event.interval === 0 && event.weekdays.includes(isoWeekday(date))) {
        dates.push(date);
      }
    }
    return dates;
  }
  const [startYear, startMonth, startDay] = start.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const step = event.recurrence === 'MONTHLY' ? event.interval : event.interval * 12;
  const [fromYear, fromMonth] = from.split('-').map(Number) as [number, number];
  const monthsToFrom = (fromYear - startYear) * 12 + (fromMonth - startMonth);
  // One step back so a clamped date of the previous step is never missed.
  let index = Math.max(0, Math.floor(monthsToFrom / step) - 1);
  for (;;) {
    const total = startMonth - 1 + index * step;
    const date = clampedDate(startYear + Math.floor(total / 12), total % 12, startDay);
    if (date > last) break;
    if (date >= from) dates.push(date);
    index += 1;
  }
  return dates;
}

export function expandOccurrences(
  event: RecurringEvent,
  window: { from: string; to: string },
  timezone: string,
): Occurrence[] {
  const span = daysBetween(event.startDate, event.endDate);
  // An occurrence that started up to `span` days before the window still overlaps it.
  const candidates = startDates(event, addDays(window.from, -span), window.to);
  const result: Occurrence[] = [];
  for (const date of candidates) {
    if (event.allDay) {
      const endDate = addDays(date, span);
      if (endDate < window.from) continue;
      result.push({
        occurrenceDate: date,
        startDate: date,
        endDate,
        startsAt: null,
        endsAt: null,
        startTime: null,
        endTime: null,
      });
      continue;
    }
    const startsAt = localToUtc(date, event.startTime!, timezone);
    const endsAt = new Date(startsAt.getTime() + event.durationMinutes * 60_000);
    const start = utcToLocal(startsAt, timezone);
    const end = utcToLocal(endsAt, timezone);
    if (end.date < window.from) continue;
    result.push({
      occurrenceDate: date,
      startDate: date,
      endDate: end.date,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      startTime: start.time,
      endTime: end.time,
    });
  }
  return result;
}
