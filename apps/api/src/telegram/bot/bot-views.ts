import { isoWeekday } from '../../calendar/calendar-recurrence.js';
import { escapeHtml, formatDay, formatRub } from './bot-format.js';

const MAX_LINES = 15;
const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'] as const;

type Author = { displayName: string | null };

/** Only the journal fields the bot shows (JournalItem from the journal service fits). */
export type LastItem =
  | {
      kind: 'TRANSACTION';
      transactionType: 'INCOME' | 'EXPENSE';
      amountMinor: string;
      occurredOn: string;
      accountId: string;
      categoryId: string;
      createdBy: Author;
    }
  | {
      kind: 'TRANSFER';
      amountMinor: string;
      occurredOn: string;
      sourceAccountId: string;
      destinationAccountId: string;
      createdBy: Author;
    };

export type PlanLine = {
  occurrenceId: string;
  kind: 'OBLIGATION' | 'INCOME_PLAN';
  name: string;
  scheduledOn: string;
  /** For OBLIGATION the unpaid remainder, for INCOME_PLAN the expected amount. */
  amountMinor: string;
};

export type EventLine = {
  occurrenceDate: string;
  title: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
};

export type BalanceAccount = { name: string; currentBalanceMinor: string };

export type BalanceSummary = {
  cashMinor: string;
  spendable: { state: 'READY' | 'NEEDS_PERIOD_SETUP'; amountMinor: string | null };
  period: { end: string };
};

function capped(lines: string[]): string[] {
  if (lines.length <= MAX_LINES) return lines;
  return [...lines.slice(0, MAX_LINES), `… и ещё ${lines.length - MAX_LINES}`];
}

export function renderLast(
  items: LastItem[],
  names: { accounts: Map<string, string>; categories: Map<string, string> },
  today: string,
): string {
  const title = '<b>Последние операции</b>';
  if (items.length === 0) return `${title}\nОпераций пока нет.`;
  const account = (id: string) => escapeHtml(names.accounts.get(id) ?? 'счёт');
  const lines = items.map((item) => {
    const day = formatDay(item.occurredOn, today);
    const author = escapeHtml(item.createdBy.displayName ?? 'Участник');
    if (item.kind === 'TRANSFER') {
      return `${day} ${formatRub(item.amountMinor)} · Перевод · ${account(item.sourceAccountId)} → ${account(item.destinationAccountId)} · ${author}`;
    }
    const sign = item.transactionType === 'EXPENSE' ? '−' : '+';
    const category = escapeHtml(names.categories.get(item.categoryId) ?? 'без категории');
    return `${day} ${sign}${formatRub(item.amountMinor)} · ${category} · ${account(item.accountId)} · ${author}`;
  });
  return [title, ...lines].join('\n');
}

export function renderPlans(overdue: PlanLine[], upcoming: PlanLine[], today: string): string {
  const title = '<b>Плановые платежи</b>';
  if (overdue.length === 0 && upcoming.length === 0) {
    return `${title}\nНа 7 дней плановых платежей нет.`;
  }
  const line = (plan: PlanLine) =>
    `• ${formatDay(plan.scheduledOn, today)} ${escapeHtml(plan.name)} ${
      plan.kind === 'OBLIGATION' ? '−' : '+'
    }${formatRub(plan.amountMinor)}`;
  const parts = [title];
  if (overdue.length > 0) parts.push('', '<b>Просрочено</b>', ...capped(overdue.map(line)));
  if (upcoming.length > 0) {
    parts.push('', '<b>Ближайшие 7 дней</b>', ...capped(upcoming.map(line)));
  }
  return parts.join('\n');
}

export function renderEvents(items: EventLine[], today: string): string {
  const title = '<b>События на 7 дней</b>';
  if (items.length === 0) return `${title}\nЗа 7 дней событий нет.`;
  const parts = [title];
  let day: string | null = null;
  for (const item of items.slice(0, MAX_LINES * 2)) {
    if (item.occurrenceDate !== day) {
      day = item.occurrenceDate;
      parts.push('', `<b>${formatDay(day, today)}, ${WEEKDAYS[isoWeekday(day) - 1]}</b>`);
    }
    const time = item.allDay ? 'весь день' : `${item.startTime}–${item.endTime}`;
    parts.push(`• ${time} ${escapeHtml(item.title)}`);
  }
  return parts.join('\n');
}

export function renderBalance(
  accounts: BalanceAccount[],
  summary: BalanceSummary,
  today: string,
): string {
  const parts = ['<b>Остатки на счетах</b>'];
  if (accounts.length === 0) parts.push('Счетов пока нет.');
  parts.push(
    ...capped(
      accounts.map(
        (account) => `${escapeHtml(account.name)} — ${formatRub(account.currentBalanceMinor)}`,
      ),
    ),
  );
  parts.push('', `Всего на счетах: ${formatRub(summary.cashMinor)}`);
  parts.push(
    summary.spendable.state === 'READY' && summary.spendable.amountMinor !== null
      ? `Доступно до ${formatDay(summary.period.end, today)}: ${formatRub(summary.spendable.amountMinor)}`
      : 'Доступно: настройте период в приложении.',
  );
  return parts.join('\n');
}
