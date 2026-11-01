import { localToUtc, utcToLocal } from '../calendar/zoned-time.js';

/** Instant with the same wall-clock date/time in `toZone` as `instant` has in `fromZone`. */
export function shiftWallClock(instant: Date, fromZone: string, toZone: string): Date {
  const local = utcToLocal(instant, fromZone);
  return localToUtc(local.date, local.time, toZone);
}

/**
 * Wall-clock shift of a timed event. Only the start is shifted; the end keeps the stored duration
 * so a DST gap in the target zone cannot break the calendar_events duration CHECK.
 */
export function shiftTimedEvent(
  startsAt: Date,
  endsAt: Date,
  fromZone: string,
  toZone: string,
): { startsAt: Date; endsAt: Date } {
  const newStart = shiftWallClock(startsAt, fromZone, toZone);
  const duration = endsAt.getTime() - startsAt.getTime();
  return { startsAt: newStart, endsAt: new Date(newStart.getTime() + duration) };
}
