import { format } from 'date-fns';
import type { Component } from 'vue';
import {
  ArrowLeftRight,
  CalendarClock,
  CalendarDays,
  PiggyBank,
  Receipt,
  Users,
} from '@lucide/vue';

import type { ActivityItem, ActivityKind } from '../../composables/useActivityFeed.js';
import { shortMonth } from '../calendar/calendar-dates.js';
import { formatDayMonth } from '../envelopes/envelope-plan-kind.js';
import { authorLabel } from '../operations/author-label.js';

// Impersonal phrases: the reader's gender toward a co-author is unknown (see author-label.ts).
const ACTIONS: Record<ActivityKind, string | { INCOME: string; EXPENSE: string }> = {
  TRANSACTION_CREATED: { EXPENSE: 'добавлен расход', INCOME: 'получен доход' },
  TRANSACTION_UPDATED: { EXPENSE: 'изменён расход', INCOME: 'изменён доход' },
  TRANSACTION_DELETED: { EXPENSE: 'удалён расход', INCOME: 'удалён доход' },
  TRANSACTION_RESTORED: 'восстановлена операция',
  TRANSFER_CREATED: 'перевод',
  TRANSFER_DELETED: 'удалён перевод',
  ENVELOPE_FUNDED: 'пополнен конверт',
  ENVELOPE_MOVED: 'перемещение между конвертами',
  PLAN_PAID: 'оплачен платёж',
  PLAN_CREATED: 'новый план',
  CALENDAR_EVENT_CREATED: 'новое событие',
  CALENDAR_EVENT_UPDATED: 'изменено событие',
  CALENDAR_EVENT_DELETED: 'удалено событие',
  MEMBER_JOINED: 'в семье',
  MEMBER_LEFT: 'больше не в семье',
  MEMBER_REMOVED: 'исключён участник',
};

const ARROW_KINDS: ReadonlySet<ActivityKind> = new Set([
  'TRANSFER_CREATED',
  'TRANSFER_DELETED',
  'ENVELOPE_MOVED',
]);

export function activityAction(item: ActivityItem): string {
  const action = ACTIONS[item.kind];
  return typeof action === 'string' ? action : action[item.transactionType ?? 'EXPENSE'];
}

export function activityHeadline(item: ActivityItem): string {
  const target =
    item.kind === 'MEMBER_REMOVED' && item.target
      ? ` «${item.target.displayName ?? 'Участник'}»`
      : '';
  return `${authorLabel(item.actor)} · ${activityAction(item)}${target}`;
}

export function activityDayKey(iso: string): string {
  return format(new Date(iso), 'yyyy-MM-dd');
}

function previousDayKey(now: Date): string {
  return format(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12), 'yyyy-MM-dd');
}

export function activityTime(iso: string, now: Date): string {
  const time = format(new Date(iso), 'HH:mm');
  const day = activityDayKey(iso);
  if (day === format(now, 'yyyy-MM-dd')) return time;
  if (day === previousDayKey(now)) return `вчера, ${time}`;
  return `${shortMonth(day)}, ${time}`;
}

export function activityDayLabel(dayKey: string, now: Date): string {
  if (dayKey === format(now, 'yyyy-MM-dd')) return 'Сегодня';
  if (dayKey === previousDayKey(now)) return 'Вчера';
  return formatDayMonth(dayKey);
}

export function activitySubtitle(item: ActivityItem, now: Date): string {
  const parts = ARROW_KINDS.has(item.kind)
    ? [item.details.join(' → ')]
    : [...(item.title ? [item.title] : []), ...item.details];
  return [...parts.filter((part) => part.length > 0), activityTime(item.occurredAt, now)].join(
    ' · ',
  );
}

export function activityTone(item: ActivityItem): 'income' | 'expense' | 'transfer' | undefined {
  if (item.kind.startsWith('TRANSFER_')) return 'transfer';
  if (item.kind.startsWith('TRANSACTION_') && item.transactionType) {
    return item.transactionType === 'INCOME' ? 'income' : 'expense';
  }
  return undefined;
}

// Same icons as the matching navigation sections.
export function activityIcon(item: ActivityItem): Component {
  if (item.kind.startsWith('TRANSACTION_')) return Receipt;
  if (item.kind.startsWith('TRANSFER_')) return ArrowLeftRight;
  if (item.kind.startsWith('ENVELOPE_')) return PiggyBank;
  if (item.kind.startsWith('PLAN_')) return CalendarClock;
  if (item.kind.startsWith('CALENDAR_')) return CalendarDays;
  return Users;
}

export function activityHref(item: ActivityItem): string | null {
  const link = item.link;
  if (!link) return null;
  const id = encodeURIComponent(link.id);
  switch (link.type) {
    case 'TRANSACTION':
      return `/app/operations?operationId=${id}`;
    case 'TRANSFER':
      return '/app/operations';
    case 'ENVELOPE':
      return '/app/envelopes';
    case 'PLAN_OCCURRENCE':
      return `/app/plans?occurrence=${id}`;
    case 'PLAN':
      return '/app/plans';
    case 'CALENDAR_EVENT':
      return link.date ? `/app/calendar?view=agenda&date=${link.date}` : '/app/calendar';
  }
}

export function isStruck(item: ActivityItem): boolean {
  return item.kind === 'TRANSACTION_DELETED' || item.kind === 'TRANSFER_DELETED';
}

function isSingular(count: number): boolean {
  return count % 10 === 1 && count % 100 !== 11;
}

function isFew(count: number): boolean {
  return count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14);
}

/** Pill text: «1 новое», «3 новых». */
export function unseenShort(count: number): string {
  return `${count} ${isSingular(count) ? 'новое' : 'новых'}`;
}

/** Accessible name of the badge: «1 новое событие», «3 новых события», «5 новых событий». */
export function unseenLabel(count: number): string {
  if (isSingular(count)) return `${count} новое событие`;
  return `${count} новых ${isFew(count) ? 'события' : 'событий'}`;
}
