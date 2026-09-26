import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlansCalendar from './PlansCalendar.vue';
import type { DayAggregate } from './day-aggregates.js';

function mountCalendar(
  aggregates: Record<string, DayAggregate> = {},
  overrides: Partial<{ monthAnchor: string; selectedDate: string; today: string }> = {},
) {
  return mount(PlansCalendar, {
    props: {
      monthAnchor: '2026-09-01',
      selectedDate: '2026-09-24',
      today: '2026-09-24',
      aggregates,
      ...overrides,
    },
  });
}

describe('PlansCalendar', () => {
  it('renders 42 day cells with the correct in-month count', () => {
    const wrapper = mountCalendar();

    expect(wrapper.findAll('[data-testid="calendar-cell"]')).toHaveLength(42);
    expect(wrapper.findAll('[data-testid="calendar-cell"][data-in-month="true"]')).toHaveLength(30);
  });

  it('shows a compact signed amount for a day with a net total', () => {
    const wrapper = mountCalendar({
      '2026-09-10': { incomeMinor: 10600000n, expenseMinor: 0n, netMinor: 10600000n, dot: 'none' },
    });

    const cell = wrapper.get('[data-date="2026-09-10"]');
    expect(cell.text()).toContain('+106к');
  });

  it('shows both an income and an expense amount on a day with both', () => {
    const wrapper = mountCalendar({
      '2026-09-24': {
        incomeMinor: 60000000n,
        expenseMinor: 3500000n,
        netMinor: 56500000n,
        dot: 'none',
      },
    });

    const cell = wrapper.get('[data-date="2026-09-24"]');
    expect(cell.text()).toContain('+600к');
    expect(cell.text()).toContain('−35к');
  });

  it('shows an overdue dot for a past DUE day and an upcoming dot for a future one', () => {
    const wrapper = mountCalendar({
      '2026-09-10': { incomeMinor: 0n, expenseMinor: 0n, netMinor: 0n, dot: 'overdue' },
      '2026-09-26': { incomeMinor: 0n, expenseMinor: 0n, netMinor: 0n, dot: 'upcoming' },
    });

    expect(
      wrapper.get('[data-date="2026-09-10"]').find('.plans-calendar__dot--overdue').exists(),
    ).toBe(true);
    expect(
      wrapper.get('[data-date="2026-09-26"]').find('.plans-calendar__dot--upcoming').exists(),
    ).toBe(true);
  });

  it('emits select-day when a cell is clicked and marks the selected/today cells', () => {
    const wrapper = mountCalendar();

    expect(wrapper.get('[data-date="2026-09-24"]').classes()).toContain(
      'plans-calendar__cell--today',
    );
    expect(wrapper.get('[data-date="2026-09-24"]').classes()).toContain(
      'plans-calendar__cell--selected',
    );

    wrapper.get('[data-date="2026-09-10"]').trigger('click');
    expect(wrapper.emitted('select-day')?.[0]).toEqual(['2026-09-10']);
  });

  it('emits change-month with the first day of the neighboring month', async () => {
    const wrapper = mountCalendar();

    await wrapper.get('[data-action="calendar-next-month"]').trigger('click');
    expect(wrapper.emitted('change-month')?.[0]).toEqual(['2026-10-01']);

    await wrapper.get('[data-action="calendar-prev-month"]').trigger('click');
    expect(wrapper.emitted('change-month')?.[1]).toEqual(['2026-08-01']);
  });

  it('builds an aria-label with full date context, tone, and plan status for each cell', () => {
    const wrapper = mountCalendar({
      '2026-09-10': { incomeMinor: 0n, expenseMinor: 0n, netMinor: 0n, dot: 'overdue' },
      '2026-09-24': {
        incomeMinor: 10600000n,
        expenseMinor: 0n,
        netMinor: 10600000n,
        dot: 'none',
      },
    });

    const overdueLabel = wrapper.get('[data-date="2026-09-10"]').attributes('aria-label');
    expect(overdueLabel).toContain('10 сентября 2026');
    expect(overdueLabel).toContain('четверг');
    expect(overdueLabel).toContain('просроченный платёж');

    const todayLabel = wrapper.get('[data-date="2026-09-24"]').attributes('aria-label');
    expect(todayLabel).toContain('24 сентября 2026');
    expect(todayLabel).toContain('четверг');
    expect(todayLabel).toContain('сегодня');
    expect(todayLabel).toContain('выбрано');
    // The aria-label overrides the visible "+106к" text, so it must carry the
    // exact amount, not just the direction. ru-RU groups with U+00A0 and
    // separates the ₽ sign with U+00A0 as well.
    expect(todayLabel).toContain('доход 106 000,00 ₽');
  });

  it('spells out a negative day total as an expense amount in the aria-label', () => {
    const wrapper = mountCalendar({
      '2026-09-13': { incomeMinor: 0n, expenseMinor: 85000n, netMinor: -85000n, dot: 'none' },
    });

    const label = wrapper.get('[data-date="2026-09-13"]').attributes('aria-label');
    expect(label).toContain('расход');
    expect(label).toContain('850,00 ₽');
  });

  it('disables next-month navigation beyond the 60-day occurrence horizon', () => {
    const wrapper = mountCalendar({}, { monthAnchor: '2026-12-01', selectedDate: '2026-12-01' });

    const next = wrapper.get('[data-action="calendar-next-month"]');
    expect(next.attributes('disabled')).toBeDefined();
    expect(next.attributes('aria-label')).toContain('недоступен');
    expect(
      wrapper.get('[data-action="calendar-prev-month"]').attributes('disabled'),
    ).toBeUndefined();
  });

  it('keeps next-month navigation enabled inside the horizon', () => {
    const wrapper = mountCalendar();

    expect(
      wrapper.get('[data-action="calendar-next-month"]').attributes('disabled'),
    ).toBeUndefined();
    expect(wrapper.get('[data-action="calendar-next-month"]').attributes('aria-label')).toBe(
      'Следующий месяц',
    );
  });

  it('marks the grid busy while the range reloads', async () => {
    const wrapper = mountCalendar();

    expect(wrapper.get('.plans-calendar__grid').attributes('aria-busy')).toBe('false');
    await wrapper.setProps({ loading: true });
    expect(wrapper.get('.plans-calendar__grid').attributes('aria-busy')).toBe('true');
  });
});
