import {
  ArrowLeftRight,
  CalendarClock,
  CalendarDays,
  PiggyBank,
  Receipt,
  Users,
} from '@lucide/vue';
import { describe, expect, it } from 'vitest';

import type { ActivityItem } from '../../composables/useActivityFeed.js';
import {
  activityAction,
  activityDayKey,
  activityDayLabel,
  activityHeadline,
  activityHref,
  activityIcon,
  activitySubtitle,
  activityTime,
  activityTone,
  isStruck,
  unseenLabel,
  unseenShort,
} from './activity-phrases.js';

const alia = { userId: 'alia', displayName: 'Алия', isActiveMember: true };
const now = new Date(2026, 9, 30, 18, 0);
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).toISOString();

const item = (overrides: Partial<ActivityItem>): ActivityItem => ({
  id: 'audit-1',
  occurredAt: at(30, 14, 20),
  kind: 'TRANSACTION_CREATED',
  isNew: true,
  actor: alia,
  amountMinor: '120000',
  currency: 'RUB',
  transactionType: 'EXPENSE',
  title: 'Продукты',
  details: ['Карта'],
  target: null,
  link: { type: 'TRANSACTION', id: 'tx-1', date: null },
  ...overrides,
});

describe('activity phrases', () => {
  it('names the action by kind and operation type, gender-neutral', () => {
    expect(activityAction(item({}))).toBe('добавлен расход');
    expect(activityAction(item({ transactionType: 'INCOME' }))).toBe('получен доход');
    expect(activityAction(item({ kind: 'TRANSACTION_DELETED' }))).toBe('удалён расход');
    expect(activityAction(item({ kind: 'PLAN_PAID', transactionType: null }))).toBe(
      'оплачен платёж',
    );
    expect(activityAction(item({ kind: 'MEMBER_LEFT' }))).toBe('больше не в семье');
  });

  it('puts the author first, a former member with the fixed suffix, the removed person last', () => {
    expect(activityHeadline(item({}))).toBe('Алия · добавлен расход');
    expect(activityHeadline(item({ actor: { ...alia, isActiveMember: false } }))).toBe(
      'Алия (не в семье) · добавлен расход',
    );
    expect(
      activityHeadline(
        item({
          kind: 'MEMBER_REMOVED',
          target: { userId: 'u', displayName: 'Игорь', isActiveMember: false },
        }),
      ),
    ).toBe('Алия · исключён участник «Игорь»');
    expect(activityHeadline(item({ kind: 'MEMBER_REMOVED', target: null }))).toBe(
      'Алия · исключён участник',
    );
  });

  it('builds the subtitle from title, details and time; transfers use an arrow', () => {
    expect(activitySubtitle(item({}), now)).toBe('Продукты · Карта · 14:20');
    expect(
      activitySubtitle(
        item({ kind: 'TRANSFER_CREATED', title: null, details: ['Карта', 'Наличные'] }),
        now,
      ),
    ).toBe('Карта → Наличные · 14:20');
    expect(
      activitySubtitle(
        item({ kind: 'ENVELOPE_MOVED', title: null, details: ['Продукты', 'Отпуск'] }),
        now,
      ),
    ).toBe('Продукты → Отпуск · 14:20');
    expect(activitySubtitle(item({ kind: 'MEMBER_JOINED', title: null, details: [] }), now)).toBe(
      '14:20',
    );
  });

  it('formats time as today, yesterday or a short date', () => {
    expect(activityTime(at(30, 9, 5), now)).toBe('09:05');
    expect(activityTime(at(29, 23, 40), now)).toBe('вчера, 23:40');
    expect(activityTime(at(28, 14, 20), now)).toBe('28 окт, 14:20');
  });

  it('groups by local day', () => {
    expect(activityDayKey(at(28, 23, 59))).toBe('2026-10-28');
    expect(activityDayLabel('2026-10-30', now)).toBe('Сегодня');
    expect(activityDayLabel('2026-10-29', now)).toBe('Вчера');
    expect(activityDayLabel('2026-10-28', now)).toBe('28 октября');
  });

  it('chooses a tone only for operations and transfers', () => {
    expect(activityTone(item({}))).toBe('expense');
    expect(activityTone(item({ transactionType: 'INCOME' }))).toBe('income');
    expect(activityTone(item({ kind: 'TRANSFER_CREATED', transactionType: null }))).toBe(
      'transfer',
    );
    expect(activityTone(item({ kind: 'PLAN_PAID', transactionType: null }))).toBeUndefined();
  });

  it('links to the object, or nowhere once it is gone', () => {
    expect(activityHref(item({}))).toBe('/app/operations?operationId=tx-1');
    expect(activityHref(item({ link: { type: 'TRANSFER', id: 't', date: null } }))).toBe(
      '/app/operations',
    );
    expect(activityHref(item({ link: { type: 'ENVELOPE', id: 'e', date: null } }))).toBe(
      '/app/envelopes',
    );
    expect(activityHref(item({ link: { type: 'PLAN_OCCURRENCE', id: 'o', date: null } }))).toBe(
      '/app/plans?occurrence=o',
    );
    expect(activityHref(item({ link: { type: 'PLAN', id: 'p', date: null } }))).toBe('/app/plans');
    expect(
      activityHref(item({ link: { type: 'CALENDAR_EVENT', id: 'c', date: '2026-11-05' } })),
    ).toBe('/app/calendar?view=agenda&date=2026-11-05');
    expect(activityHref(item({ link: null }))).toBeNull();
  });

  it('strikes deleted money rows only', () => {
    expect(isStruck(item({ kind: 'TRANSACTION_DELETED' }))).toBe(true);
    expect(isStruck(item({ kind: 'TRANSFER_DELETED' }))).toBe(true);
    expect(isStruck(item({ kind: 'CALENDAR_EVENT_DELETED' }))).toBe(false);
  });

  it.each([
    ['TRANSACTION_CREATED', 'EXPENSE', 'добавлен расход'],
    ['TRANSACTION_CREATED', 'INCOME', 'получен доход'],
    ['TRANSACTION_UPDATED', 'EXPENSE', 'изменён расход'],
    ['TRANSACTION_UPDATED', 'INCOME', 'изменён доход'],
    ['TRANSACTION_DELETED', 'EXPENSE', 'удалён расход'],
    ['TRANSACTION_DELETED', 'INCOME', 'удалён доход'],
    ['TRANSACTION_RESTORED', 'EXPENSE', 'восстановлена операция'],
    ['TRANSFER_CREATED', null, 'перевод'],
    ['TRANSFER_DELETED', null, 'удалён перевод'],
    ['ENVELOPE_FUNDED', null, 'пополнен конверт'],
    ['ENVELOPE_MOVED', null, 'перемещение между конвертами'],
    ['PLAN_PAID', null, 'оплачен платёж'],
    ['PLAN_CREATED', null, 'новый план'],
    ['CALENDAR_EVENT_CREATED', null, 'новое событие'],
    ['CALENDAR_EVENT_UPDATED', null, 'изменено событие'],
    ['CALENDAR_EVENT_DELETED', null, 'удалено событие'],
    ['MEMBER_JOINED', null, 'в семье'],
    ['MEMBER_LEFT', null, 'больше не в семье'],
    ['MEMBER_REMOVED', null, 'исключён участник'],
  ] as const)('phrase for %s (%s)', (kind, transactionType, phrase) => {
    expect(activityAction(item({ kind, transactionType }))).toBe(phrase);
  });

  it.each([
    ['TRANSACTION_CREATED', Receipt],
    ['TRANSACTION_UPDATED', Receipt],
    ['TRANSACTION_DELETED', Receipt],
    ['TRANSACTION_RESTORED', Receipt],
    ['TRANSFER_CREATED', ArrowLeftRight],
    ['TRANSFER_DELETED', ArrowLeftRight],
    ['ENVELOPE_FUNDED', PiggyBank],
    ['ENVELOPE_MOVED', PiggyBank],
    ['PLAN_PAID', CalendarClock],
    ['PLAN_CREATED', CalendarClock],
    ['CALENDAR_EVENT_CREATED', CalendarDays],
    ['CALENDAR_EVENT_UPDATED', CalendarDays],
    ['CALENDAR_EVENT_DELETED', CalendarDays],
    ['MEMBER_JOINED', Users],
    ['MEMBER_LEFT', Users],
    ['MEMBER_REMOVED', Users],
  ] as const)('icon for %s', (kind, icon) => {
    expect(activityIcon(item({ kind }))).toBe(icon);
  });

  it('declines the unseen count', () => {
    expect(unseenShort(1)).toBe('1 новое');
    expect(unseenShort(3)).toBe('3 новых');
    expect(unseenShort(11)).toBe('11 новых');
    expect(unseenShort(21)).toBe('21 новое');
    expect(unseenLabel(1)).toBe('1 новое событие');
    expect(unseenLabel(3)).toBe('3 новых события');
    expect(unseenLabel(5)).toBe('5 новых событий');
    expect(unseenLabel(12)).toBe('12 новых событий');
    expect(unseenLabel(22)).toBe('22 новых события');
  });
});
