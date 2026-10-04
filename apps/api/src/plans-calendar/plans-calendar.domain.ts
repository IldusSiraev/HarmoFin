export type CalendarItemKind = 'OBLIGATION' | 'INCOME_PLAN';
export type CalendarDot = 'upcoming' | 'overdue';

export interface MonthWindow {
  from: string;
  to: string;
}

export interface PlannedItem {
  kind: CalendarItemKind;
  status: string;
  scheduledOn: string;
  expectedMinor: bigint;
}

export interface FactRow {
  date: string;
  type: 'INCOME' | 'EXPENSE';
  amountMinor: bigint;
}

export interface CalendarDay {
  date: string;
  incomeMinor: bigint;
  expenseMinor: bigint;
  dot: CalendarDot | null;
}

/** First and last day of a `YYYY-MM` month, inclusive. */
export function monthWindow(month: string): MonthWindow {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

export function previousDay(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function isOpenStatus(status: string): boolean {
  return status === 'PENDING' || status === 'DUE';
}

/** Only an open obligation scheduled before today is overdue; income plans are forecasts. */
export function isOverdue(
  kind: CalendarItemKind,
  status: string,
  scheduledOn: string,
  today: string,
): boolean {
  return kind === 'OBLIGATION' && isOpenStatus(status) && scheduledOn < today;
}

/** Plan totals follow spec §6: cancelled and skipped drop out, completed stay. */
export function plannedTotals(items: readonly PlannedItem[]): {
  plannedIncomeMinor: bigint;
  plannedExpenseMinor: bigint;
  balanceMinor: bigint;
} {
  let income = 0n;
  let expense = 0n;
  for (const item of items) {
    if (item.status === 'CANCELLED' || item.status === 'SKIPPED') continue;
    if (item.kind === 'INCOME_PLAN') income += item.expectedMinor;
    else expense += item.expectedMinor;
  }
  return {
    plannedIncomeMinor: income,
    plannedExpenseMinor: expense,
    balanceMinor: income - expense,
  };
}

/** One entry per day that has facts or an open item, ordered by date. */
export function buildDays(
  facts: readonly FactRow[],
  items: ReadonlyArray<Pick<PlannedItem, 'kind' | 'status' | 'scheduledOn'>>,
  today: string,
): CalendarDay[] {
  const days = new Map<string, CalendarDay>();
  const dayOf = (date: string): CalendarDay => {
    let day = days.get(date);
    if (!day) {
      day = { date, incomeMinor: 0n, expenseMinor: 0n, dot: null };
      days.set(date, day);
    }
    return day;
  };
  for (const fact of facts) {
    const day = dayOf(fact.date);
    if (fact.type === 'INCOME') day.incomeMinor += fact.amountMinor;
    else day.expenseMinor += fact.amountMinor;
  }
  for (const item of items) {
    if (!isOpenStatus(item.status)) continue;
    const day = dayOf(item.scheduledOn);
    if (isOverdue(item.kind, item.status, item.scheduledOn, today)) day.dot = 'overdue';
    else if (day.dot === null) day.dot = 'upcoming';
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
