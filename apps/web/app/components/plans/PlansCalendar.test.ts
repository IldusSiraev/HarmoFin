import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import PlansCalendar from './PlansCalendar.vue';

const days = [
  { date: '2026-09-05', incomeMinor: '4300000', expenseMinor: '600000', dot: 'overdue' as const },
  { date: '2026-09-25', incomeMinor: '0', expenseMinor: '0', dot: 'upcoming' as const },
];

function mountCalendar(props: Record<string, unknown> = {}) {
  return mount(PlansCalendar, {
    props: {
      monthAnchor: '2026-09-01',
      selectedDate: '2026-09-24',
      today: '2026-09-24',
      days,
      ...props,
    },
    attachTo: document.body,
  });
}

describe('PlansCalendar', () => {
  it('shows the month label and 42 day cells with neighbours disabled', () => {
    const wrapper = mountCalendar();
    expect(wrapper.text()).toContain('сентябрь 2026');
    expect(wrapper.findAll('[data-testid^="calendar-day-"]')).toHaveLength(42);
    expect(
      wrapper.get('[data-testid="calendar-day-2026-08-31"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('[data-testid="calendar-day-2026-09-01"]').attributes('disabled'),
    ).toBeUndefined();
  });

  it('shows compact income and expense amounts and puts them in the aria-label', () => {
    const wrapper = mountCalendar();
    const cell = wrapper.get('[data-testid="calendar-day-2026-09-05"]');
    expect(cell.text()).toContain('+43к');
    expect(cell.text()).toContain('−6');
    const label = cell.attributes('aria-label') ?? '';
    expect(label).toContain('5 сентября 2026');
    expect(label).toContain('доход');
    expect(label).toContain('расход');
    expect(label).toContain('просроченный платёж');
  });

  it('marks today and the selected day for assistive tech', () => {
    const wrapper = mountCalendar({ selectedDate: '2026-09-25' });
    expect(
      wrapper.get('[data-testid="calendar-day-2026-09-24"]').attributes('aria-label'),
    ).toContain('сегодня');
    const selected = wrapper.get('[data-testid="calendar-day-2026-09-25"]');
    expect(selected.attributes('aria-pressed')).toBe('true');
    expect(selected.attributes('aria-label')).toContain('предстоящий платёж');
  });

  it('draws a shape marker per dot kind', () => {
    const wrapper = mountCalendar();
    expect(wrapper.get('[data-testid="calendar-dot-2026-09-05"]').attributes('data-dot')).toBe(
      'overdue',
    );
    expect(wrapper.get('[data-testid="calendar-dot-2026-09-25"]').attributes('data-dot')).toBe(
      'upcoming',
    );
    expect(wrapper.find('[data-testid="calendar-dot-2026-09-06"]').exists()).toBe(false);
  });

  it('emits select-day for an enabled cell only', async () => {
    const wrapper = mountCalendar();
    await wrapper.get('[data-testid="calendar-day-2026-09-10"]').trigger('click');
    expect(wrapper.emitted('select-day')).toEqual([['2026-09-10']]);
  });

  it('emits change-month and blocks navigation beyond today + 60 days', async () => {
    const wrapper = mountCalendar();
    await wrapper.get('[data-testid="calendar-prev-month"]').trigger('click');
    expect(wrapper.emitted('change-month')).toEqual([['2026-08-01']]);
    // today 2026-09-24 + 60 days = 2026-11-23: October starts earlier, December 1 is later.
    expect(
      wrapper.get('[data-testid="calendar-next-month"]').attributes('disabled'),
    ).toBeUndefined();
    await wrapper.setProps({ monthAnchor: '2026-11-01' });
    const next = wrapper.get('[data-testid="calendar-next-month"]');
    expect(next.attributes('disabled')).toBeDefined();
    expect(next.attributes('aria-label')).toContain('60 дней');
  });

  it('keeps exactly one day cell in the tab order', async () => {
    const wrapper = mountCalendar();
    const tabbable = () => wrapper.findAll('[data-testid^="calendar-day-"][tabindex="0"]');
    expect(tabbable()).toHaveLength(1);
    expect(tabbable()[0]?.attributes('data-testid')).toBe('calendar-day-2026-09-24');
    // Selected day outside the displayed month falls back to the first day of the month.
    await wrapper.setProps({ selectedDate: '2026-10-03' });
    expect(tabbable()).toHaveLength(1);
    expect(tabbable()[0]?.attributes('data-testid')).toBe('calendar-day-2026-09-01');
  });

  it('flags the grid busy while loading', () => {
    expect(
      mountCalendar({ loading: true }).get('[data-testid="calendar-grid"]').attributes('aria-busy'),
    ).toBe('true');
  });

  it('ArrowRight selects the next day, ArrowDown beyond the month does nothing', async () => {
    const wrapper = mountCalendar();
    const cell = wrapper.get('[data-testid="calendar-day-2026-09-24"]');
    await cell.trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('select-day')).toEqual([['2026-09-25']]);
    await nextTick();
    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="calendar-day-2026-09-25"]').element,
    );
    await wrapper
      .get('[data-testid="calendar-day-2026-09-28"]')
      .trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.emitted('select-day')).toEqual([['2026-09-25']]);
  });
});
