export type RecurringPlan = {
  anchorOn: string;
  startOn: string;
  endOn: string | null;
  recurrence: 'ONE_TIME' | 'MONTHLY' | 'EVERY_N_MONTHS' | 'YEARLY';
  intervalMonths: number | null;
};

export function datesForPlanInWindow(
  plan: RecurringPlan,
  window: { from: string; to: string },
): string[] {
  const from = parseDate(window.from);
  const to = parseDate(window.to);
  const startOn = parseDate(plan.startOn);
  const endOn = plan.endOn ? parseDate(plan.endOn) : null;
  if (to < from || (endOn && endOn < from)) return [];

  if (plan.recurrence === 'ONE_TIME') {
    return isInRange(startOn, from, to, endOn) ? [dateValue(startOn)] : [];
  }

  const anchor = parseDate(plan.anchorOn);
  const dates =
    plan.recurrence === 'YEARLY'
      ? yearlyDates(anchor, startOn, from, to, endOn)
      : monthlyDates(
          anchor,
          startOn,
          from,
          to,
          endOn,
          plan.recurrence === 'EVERY_N_MONTHS' ? (plan.intervalMonths ?? 0) : 1,
        );
  return dates.map(dateValue);
}

function monthlyDates(
  anchor: Date,
  startOn: Date,
  from: Date,
  to: Date,
  endOn: Date | null,
  intervalMonths: number,
): Date[] {
  if (intervalMonths < 1) return [];
  const dates: Date[] = [];
  const startMonth = startOn.getUTCFullYear() * 12 + startOn.getUTCMonth();
  const endMonth = to.getUTCFullYear() * 12 + to.getUTCMonth();
  for (let month = startMonth; month <= endMonth; month += intervalMonths) {
    const year = Math.floor(month / 12);
    const monthIndex = month % 12;
    const date = dateInMonth(year, monthIndex, anchor.getUTCDate());
    if (isInRange(date, from, to, endOn) && date >= startOn) dates.push(date);
  }
  return dates;
}

function yearlyDates(
  anchor: Date,
  startOn: Date,
  from: Date,
  to: Date,
  endOn: Date | null,
): Date[] {
  const dates: Date[] = [];
  for (let year = startOn.getUTCFullYear(); year <= to.getUTCFullYear(); year += 1) {
    const date = dateInMonth(year, anchor.getUTCMonth(), anchor.getUTCDate());
    if (isInRange(date, from, to, endOn) && date >= startOn) dates.push(date);
  }
  return dates;
}

function isInRange(date: Date, from: Date, to: Date, endOn: Date | null): boolean {
  return date >= from && date <= to && (!endOn || date <= endOn);
}

function dateInMonth(year: number, month: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}
