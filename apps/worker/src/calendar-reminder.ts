import { addDays, type Occurrence } from './calendar-recurrence.js';
import { localToUtc, utcToLocal } from './zoned-time.js';

export const REMINDER_LOOKBACK_MS = 1_800_000;
export const ALL_DAY_REMINDER_TIME = '09:00';

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

export function reminderWindow(
  now: Date,
  reminderMinutes: number,
  timezone: string,
): { from: string; to: string } {
  const from = utcToLocal(new Date(now.getTime() - REMINDER_LOOKBACK_MS), timezone).date;
  const to = utcToLocal(new Date(now.getTime() + reminderMinutes * 60_000), timezone).date;
  return { from: addDays(from, -1), to: addDays(to, 1) };
}

export function reminderMoment(
  occurrence: Occurrence,
  reminderMinutes: number,
  timezone: string,
): Date {
  const start = occurrence.startsAt
    ? new Date(occurrence.startsAt)
    : localToUtc(occurrence.startDate, ALL_DAY_REMINDER_TIME, timezone);
  return new Date(start.getTime() - reminderMinutes * 60_000);
}

export function isReminderDue(moment: Date, now: Date): boolean {
  return (
    moment.getTime() <= now.getTime() && moment.getTime() > now.getTime() - REMINDER_LOOKBACK_MS
  );
}

export function reminderBody(occurrence: Occurrence, now: Date, timezone: string): string {
  const today = utcToLocal(now, timezone).date;
  const date = occurrence.startDate;
  const day =
    date === today
      ? 'Сегодня'
      : date === addDays(today, 1)
        ? 'Завтра'
        : `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
  return occurrence.startTime ? `${day} в ${occurrence.startTime}` : `${day}, весь день`;
}

export function reminderKey(
  eventId: string,
  occurrenceDate: string,
  reminderMinutes: number,
): string {
  return `calendar:${eventId}:${occurrenceDate}:${reminderMinutes}`;
}
