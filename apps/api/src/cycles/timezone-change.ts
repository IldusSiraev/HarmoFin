import { localToUtc, utcToLocal } from '../calendar/zoned-time.js';

/** Instant with the same wall-clock date/time in `toZone` as `instant` has in `fromZone`. */
export function shiftWallClock(instant: Date, fromZone: string, toZone: string): Date {
  const local = utcToLocal(instant, fromZone);
  return localToUtc(local.date, local.time, toZone);
}
