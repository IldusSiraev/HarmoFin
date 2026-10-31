import { utcToLocal } from '../zoned-time.js';

const DAY_MS = 86_400_000;

/**
 * Local date of the digest slot, or null outside it. The slot is 08:00–11:59 local time (Monday only
 * for WEEKLY): a digest switched on in the afternoon waits for the next morning, and a worker outage
 * of up to four hours still sends it. A missed slot is not caught up.
 */
export function digestSlot(
  now: Date,
  timezone: string,
  frequency: 'DAILY' | 'WEEKLY',
): string | null {
  const local = utcToLocal(now, timezone);
  if (local.time < '08:00' || local.time >= '12:00') return null;
  if (frequency === 'WEEKLY' && new Date(`${local.date}T00:00:00.000Z`).getUTCDay() !== 1) {
    return null;
  }
  return local.date;
}

export function digestWindowStart(
  now: Date,
  frequency: 'DAILY' | 'WEEKLY',
  previousEnd: Date | null,
): Date {
  const floor = new Date(now.getTime() - (frequency === 'DAILY' ? DAY_MS : 7 * DAY_MS));
  return previousEnd && previousEnd > floor ? previousEnd : floor;
}

export function digestDedupeKey(frequency: 'DAILY' | 'WEEKLY', localDate: string): string {
  return `digest:${frequency}:${localDate}`;
}
