import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlansCalendar from './PlansCalendar.vue';
import type { DayAggregate } from './day-aggregates.js';

function mountCalendar(aggregates: Record<string, DayAggregate> = {}) {
  return mount(PlansCalendar, {
    props: {
      monthAnchor: '2026-09-01',
      selectedDate: '2026-09-24',
      today: '2026-09-24',
      aggregates,
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
    const wrapper = mountCalendar({ '2026-09-10': { netMinor: 10600000n, dot: 'none' } });

    const cell = wrapper.get('[data-date="2026-09-10"]');
    expect(cell.text()).toContain('+106к');
  });

  it('shows an overdue dot for a past DUE day and an upcoming dot for a future one', () => {
    const wrapper = mountCalendar({
      '2026-09-10': { netMinor: 0n, dot: 'overdue' },
      '2026-09-26': { netMinor: 0n, dot: 'upcoming' },
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
      '2026-09-10': { netMinor: 0n, dot: 'overdue' },
      '2026-09-24': { netMinor: 10600000n, dot: 'none' },
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
    expect(todayLabel).toContain('доход');
  });
});
