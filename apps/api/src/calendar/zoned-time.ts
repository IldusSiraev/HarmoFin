// Local wall-clock date/time of an IANA zone <-> UTC instants, with Intl only (no tz library).

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let value = formatters.get(timezone);
  if (!value) {
    value = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, value);
  }
  return value;
}

function wallClock(instant: Date, timezone: string): Record<string, number> {
  const parts: Record<string, number> = {};
  for (const part of formatter(timezone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts;
}

/** Zone offset at `instant`, minutes east of UTC. */
function offsetMinutes(instant: Date, timezone: string): number {
  const p = wallClock(instant, timezone);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

export function localToUtc(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  // Two candidate offsets around the local time; the earlier valid one wins (ambiguous autumn
  // time takes the summer instant). A spring gap matches neither and moves forward.
  const before = offsetMinutes(new Date(naive - 12 * 3_600_000), timezone);
  const after = offsetMinutes(new Date(naive + 12 * 3_600_000), timezone);
  for (const offset of [Math.max(before, after), Math.min(before, after)]) {
    const candidate = new Date(naive - offset * 60_000);
    if (offsetMinutes(candidate, timezone) === offset) return candidate;
  }
  return new Date(naive - Math.min(before, after) * 60_000);
}

export function utcToLocal(instant: Date, timezone: string): { date: string; time: string } {
  const p = wallClock(instant, timezone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${p.year}-${pad(p.month!)}-${pad(p.day!)}`,
    time: `${pad(p.hour!)}:${pad(p.minute!)}`,
  };
}
