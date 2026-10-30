import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { CalendarFeedItem } from '../../composables/useFamilyCalendar.js';
import CalendarMonthGrid from './CalendarMonthGrid.vue';

const person = { userId: 'u', displayName: 'Алия', isActiveMember: true };
const event = (title: string, date: string, startTime: string | null): CalendarFeedItem => ({
  kind: 'EVENT',
  eventId: title,
  occurrenceDate: date,
  title,
  allDay: startTime === null,
  startDate: date,
  endDate: date,
  startTime,
  endTime: startTime,
  startsAt: null,
  endsAt: null,
  recurrence: 'NONE',
  participants: [],
  createdBy: person,
  canEdit: false,
});
const plan = (title: string, date: string, isOverdue = false): CalendarFeedItem => ({
  kind: 'PLAN',
  occurrenceId: title,
  planId: title,
  planKind: 'OBLIGATION',
  title,
  amountMinor: '4500000',
  status: 'PENDING',
  isOverdue,
  scheduledOn: date,
  owner: person,
});

function mountGrid(items: CalendarFeedItem[]) {
  return mount(CalendarMonthGrid, { props: { month: '2026-10', today: '2026-10-30', items } });
}

describe('CalendarMonthGrid', () => {
  it('is a grid with Monday-first weekday headers and labelled days', () => {
    const wrapper = mountGrid([
      event('Кружок', '2026-10-06', '17:00'),
      plan('Аренда', '2026-10-15'),
    ]);
    expect(wrapper.get('[role="grid"]').attributes('aria-label')).toBe('Октябрь 2026');
    expect(wrapper.findAll('[role="columnheader"]').map((cell) => cell.text())).toEqual([
      'Пн',
      'Вт',
      'Ср',
      'Чт',
      'Пт',
      'Сб',
      'Вс',
    ]);
    expect(wrapper.get('[data-date="2026-10-06"]').attributes('aria-label')).toBe(
      '6 октября, 1 событие',
    );
    expect(wrapper.get('[data-date="2026-10-15"]').attributes('aria-label')).toBe(
      '15 октября, 1 платёж',
    );
  });

  it('shows at most three lines and "+ ещё N"', () => {
    const items = ['08:00', '09:00', '10:00', '11:00', '12:00'].map((time, index) =>
      event(`Дело ${index}`, '2026-10-30', time),
    );
    const cell = mountGrid(items).get('[data-date="2026-10-30"]');
    expect(cell.findAll('[data-testid="calendar-line"]')).toHaveLength(3);
    expect(cell.text()).toContain('+ ещё 2');
    expect(cell.get('[data-testid="calendar-more-compact"]').text()).toBe('+2');
  });

  it('renders a phone marker for events and keeps the icon for payments', () => {
    const wrapper = mountGrid([
      event('Кружок', '2026-10-06', '17:00'),
      plan('Школа', '2026-10-06', true),
    ]);
    const [eventLine, planLine] = wrapper
      .get('[data-date="2026-10-06"]')
      .findAll('[data-testid="calendar-line"]');
    expect(eventLine?.find('.calendar-line__marker').exists()).toBe(true);
    expect(planLine?.find('.calendar-line__marker').exists()).toBe(false);
    expect(planLine?.find('svg.calendar-line__icon').exists()).toBe(true);
  });

  it('counts overdue payments in the day label', () => {
    const wrapper = mountGrid([
      plan('Школа', '2026-10-20', true),
      plan('Кружок', '2026-10-20', true),
      plan('Аренда', '2026-10-21', true),
    ]);
    expect(wrapper.get('[data-date="2026-10-20"]').attributes('aria-label')).toBe(
      '20 октября, 2 платежа, 2 просрочено',
    );
    expect(wrapper.get('[data-date="2026-10-21"]').attributes('aria-label')).toBe(
      '21 октября, 1 платёж, 1 просрочен',
    );
  });

  it('marks today with aria-current and overdue payments with text', () => {
    const wrapper = mountGrid([plan('Школа', '2026-10-30', true)]);
    expect(wrapper.get('[data-date="2026-10-30"]').attributes('aria-current')).toBe('date');
    expect(wrapper.get('[data-date="2026-10-30"]').text()).toContain('просрочен');
    expect(wrapper.get('[data-date="2026-10-30"]').text()).toMatch(/45\s000/);
  });

  it('opens a day by click and by Enter; arrows move focus', async () => {
    const wrapper = mountGrid([]);
    await wrapper.get('[data-date="2026-10-14"]').trigger('click');
    expect(wrapper.emitted('openDay')?.[0]).toEqual(['2026-10-14']);
    await wrapper.get('[data-date="2026-10-14"]').trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('openDay')?.[1]).toEqual(['2026-10-14']);
    await wrapper.get('[data-date="2026-10-14"]').trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.get('[data-date="2026-10-15"]').attributes('tabindex')).toBe('0');
    expect(wrapper.get('[data-date="2026-10-14"]').attributes('tabindex')).toBe('-1');
  });
});
