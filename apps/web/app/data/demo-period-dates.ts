// Calendar math only (no money): the demo scenario lives in the first period of a cycle that
// starts on `start` October 2026. UTC dates avoid any timezone drift between SSR and browser.

export type DemoPeriodDates = {
  periodStart: string;
  periodEnd: string;
  secondPeriodStart: string;
  salaryOn: string;
  mortgageOn: string;
  shoppingFrom: string;
  shoppingTo: string;
  laterPaymentsOn: string;
  daysLeftAfterShopping: number;
};

const DAY_MS = 86_400_000;
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

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function demoPeriodDates(start: number, offset: number): DemoPeriodDates {
  const periodStartMs = Date.UTC(2026, 9, start);
  const secondStartMs = periodStartMs + offset * DAY_MS;
  const periodEndMs = secondStartMs - DAY_MS;
  // Event day N of the period (1-based), clamped to the period's last day.
  const day = (n: number) => Math.min(periodStartMs + (n - 1) * DAY_MS, periodEndMs);
  const shoppingToMs = day(12);
  return {
    periodStart: iso(periodStartMs),
    periodEnd: iso(periodEndMs),
    secondPeriodStart: iso(secondStartMs),
    salaryOn: iso(periodStartMs),
    mortgageOn: iso(day(5)),
    shoppingFrom: iso(day(6)),
    shoppingTo: iso(shoppingToMs),
    laterPaymentsOn: iso(secondStartMs),
    daysLeftAfterShopping: Math.max(0, Math.round((periodEndMs - shoppingToMs) / DAY_MS)),
  };
}

export function formatDemoDate(value: string): string {
  const [, month, day] = value.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ''}`.trim();
}
