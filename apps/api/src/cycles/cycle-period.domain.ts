export type CycleSettings = {
  cycleStartDay: number;
  periodBoundaryOffset: number;
  timezone: string;
};

export type CycleRange = {
  start: string;
  end: string;
};

export type PeriodRange = {
  id: 'FIRST' | 'SECOND';
  start: string;
  end: string;
};

export type CycleAndPeriod = {
  cycle: CycleRange;
  period: PeriodRange;
  daysUntilNextBoundary: number;
};

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

export function cycleAndPeriodFor(settings: CycleSettings, date: string): CycleAndPeriod {
  validateSettings(settings);
  const selected = parseDate(date);
  const cycleStart =
    selected.day >= settings.cycleStartDay
      ? calendarDate(selected.year, selected.month, settings.cycleStartDay)
      : calendarDate(selected.year, selected.month - 1, settings.cycleStartDay);
  const cycleEnd = addDays(addMonths(cycleStart, 1), -1);
  const secondPeriodStart = addDays(cycleStart, settings.periodBoundaryOffset);
  const firstPeriod = compare(selected, secondPeriodStart) < 0;
  const nextBoundary = firstPeriod ? secondPeriodStart : addMonths(cycleStart, 1);

  return {
    cycle: { start: formatDate(cycleStart), end: formatDate(cycleEnd) },
    period: firstPeriod
      ? {
          id: 'FIRST',
          start: formatDate(cycleStart),
          end: formatDate(addDays(secondPeriodStart, -1)),
        }
      : { id: 'SECOND', start: formatDate(secondPeriodStart), end: formatDate(cycleEnd) },
    daysUntilNextBoundary: daysBetween(selected, nextBoundary),
  };
}

export function todayInTimezone(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function validateSettings(settings: CycleSettings): void {
  if (
    !Number.isInteger(settings.cycleStartDay) ||
    settings.cycleStartDay < 1 ||
    settings.cycleStartDay > 28
  ) {
    throw new RangeError('cycleStartDay must be between 1 and 28.');
  }
  if (
    !Number.isInteger(settings.periodBoundaryOffset) ||
    settings.periodBoundaryOffset < 1 ||
    settings.periodBoundaryOffset > 27
  ) {
    throw new RangeError('periodBoundaryOffset must be between 1 and 27.');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: settings.timezone });
  } catch {
    throw new RangeError('timezone must be an IANA timezone.');
  }
}

function parseDate(value: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError('date must be an ISO calendar date.');
  const date = calendarDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (formatDate(date) !== value) throw new RangeError('date must be a valid calendar date.');
  return date;
}

function calendarDate(year: number, month: number, day: number): CalendarDate {
  const value = new Date(Date.UTC(year, month, day));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth(), day: value.getUTCDate() };
}

function addDays(date: CalendarDate, amount: number): CalendarDate {
  return calendarDate(date.year, date.month, date.day + amount);
}

function addMonths(date: CalendarDate, amount: number): CalendarDate {
  return calendarDate(date.year, date.month + amount, date.day);
}

function compare(left: CalendarDate, right: CalendarDate): number {
  return Date.UTC(left.year, left.month, left.day) - Date.UTC(right.year, right.month, right.day);
}

function daysBetween(start: CalendarDate, end: CalendarDate): number {
  return Math.trunc(compare(end, start) / 86_400_000);
}

function formatDate(date: CalendarDate): string {
  return `${date.year.toString().padStart(4, '0')}-${(date.month + 1).toString().padStart(2, '0')}-${date.day
    .toString()
    .padStart(2, '0')}`;
}
