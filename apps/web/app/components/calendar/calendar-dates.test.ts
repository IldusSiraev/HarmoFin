import { describe, expect, it } from 'vitest';

import type {
  CalendarFeedItem,
  CalendarFeedPlanItem,
} from '../../composables/useFamilyCalendar.js';
import {
  agendaRange,
  agendaTitle,
  dayDialogTitle,
  dayHeading,
  groupByDay,
  monthGrid,
  monthRange,
  monthTitle,
  planStatusLabel,
  shiftMonth,
} from './calendar-dates.js';

describe('calendar dates', () => {
  it('builds a Monday-first grid that covers the month', () => {
    const grid = monthGrid('2026-10');
    expect(grid).toHaveLength(5);
    expect(grid[0]).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(grid.at(-1)?.at(-1)).toBe('2026-11-01');
    expect(monthRange('2026-10')).toEqual({ from: '2026-09-28', to: '2026-11-01' });
  });

  it('a six-week month gets six rows', () => {
    expect(monthGrid('2026-08')).toHaveLength(6);
  });

  it('moves between months and titles them', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthTitle('2026-10')).toBe('Октябрь 2026');
  });

  it('builds the agenda range and its title', () => {
    expect(agendaRange('2026-10-30')).toEqual({ from: '2026-10-30', to: '2026-11-12' });
    expect(agendaTitle({ from: '2026-10-30', to: '2026-11-12' })).toBe('30 окт – 12 ноя');
  });

  it('writes day headings', () => {
    expect(dayHeading('2026-10-30', '2026-10-30')).toBe('Сегодня, пт 30 октября');
    expect(dayHeading('2026-10-31', '2026-10-30')).toBe('Завтра, сб 31 октября');
    expect(dayHeading('2026-11-03', '2026-10-30')).toBe('Вт 3 ноября');
    expect(dayDialogTitle('2026-10-30')).toBe('Пятница, 30 октября');
  });

  it('puts a multi-day event into each of its days', () => {
    const trip = {
      kind: 'EVENT',
      eventId: 'e',
      occurrenceDate: '2026-10-31',
      startDate: '2026-10-31',
      endDate: '2026-11-02',
      title: 'Поездка',
      allDay: true,
    } as CalendarFeedItem;
    expect([...groupByDay([trip]).keys()]).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
  });
});

describe('planStatusLabel', () => {
  const plan = (overrides: Partial<CalendarFeedPlanItem>): CalendarFeedPlanItem => ({
    kind: 'PLAN',
    occurrenceId: 'o',
    planId: 'p',
    planKind: 'OBLIGATION',
    title: 'Школа',
    amountMinor: '100',
    status: 'PENDING',
    isOverdue: false,
    scheduledOn: '2026-10-30',
    owner: { userId: 'u', displayName: 'Алия', isActiveMember: true },
    ...overrides,
  });

  it('labels overdue, completed and pending payments', () => {
    expect(planStatusLabel(plan({ isOverdue: true }))).toEqual({
      label: 'Просрочен',
      tone: 'warning',
    });
    expect(planStatusLabel(plan({ status: 'COMPLETED' }))).toEqual({
      label: 'Оплачен',
      tone: 'success',
    });
    expect(planStatusLabel(plan({ status: 'COMPLETED', planKind: 'INCOME_PLAN' }))).toEqual({
      label: 'Получен',
      tone: 'success',
    });
    expect(planStatusLabel(plan({}))).toEqual({ label: 'Ожидается', tone: 'neutral' });
  });
});
