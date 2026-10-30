import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { CalendarFeedItem } from '../../composables/useFamilyCalendar.js';
import CalendarAgenda from './CalendarAgenda.vue';

const alia = { userId: 'a', displayName: 'Алия', isActiveMember: true };
const ildar = { userId: 'i', displayName: 'Ильдар', isActiveMember: true };
const breakfast: CalendarFeedItem = {
  kind: 'EVENT',
  eventId: 'e1',
  occurrenceDate: '2026-10-30',
  title: 'Семейный завтрак',
  allDay: false,
  startDate: '2026-10-30',
  endDate: '2026-10-30',
  startTime: '09:30',
  endTime: '10:30',
  startsAt: null,
  endsAt: null,
  recurrence: 'NONE',
  participants: [alia, ildar],
  createdBy: ildar,
  canEdit: true,
};
const school: CalendarFeedItem = {
  kind: 'PLAN',
  occurrenceId: 'o1',
  planId: 'p1',
  planKind: 'OBLIGATION',
  title: 'Школа',
  amountMinor: '1250000',
  status: 'DUE',
  isOverdue: true,
  scheduledOn: '2026-10-30',
  owner: ildar,
};
const trip: CalendarFeedItem = {
  ...breakfast,
  eventId: 'e2',
  title: 'Поездка за город',
  occurrenceDate: '2026-10-31',
  startDate: '2026-10-31',
  endDate: '2026-10-31',
  allDay: true,
  startTime: null,
  endTime: null,
};

function mountAgenda(items: CalendarFeedItem[]) {
  return mount(CalendarAgenda, {
    props: { today: '2026-10-30', items, activeMemberIds: new Set(['a', 'i']), loadingMore: false },
  });
}

describe('CalendarAgenda', () => {
  it('groups by day with headings and skips empty days', () => {
    const wrapper = mountAgenda([school, breakfast, trip]);
    expect(
      wrapper.findAll('[data-testid="agenda-day-heading"]').map((item) => item.text()),
    ).toEqual(['Сегодня, пт 30 октября', 'Завтра, сб 31 октября']);
  });

  it('shows the status of a payment once, as a pill, and people for an event', () => {
    const wrapper = mountAgenda([school, breakfast]);
    const payment = wrapper.get('[data-testid="agenda-item-o1"]');
    expect(payment.text()).toMatch(/12\s500/);
    expect(payment.text().match(/Просрочен/g)).toHaveLength(1);
    expect(wrapper.get('[data-testid="agenda-item-e1"]').text()).toContain('09:30 · Вся семья');
  });

  it('gives each row an accessible name with its details', () => {
    const wrapper = mountAgenda([school, breakfast]);
    expect(wrapper.get('[data-testid="agenda-item-e1"] button').attributes('aria-label')).toBe(
      'Семейный завтрак, 09:30 · Вся семья',
    );
    expect(wrapper.get('[data-testid="agenda-item-o1"] button').attributes('aria-label')).toMatch(
      /^Школа, 12\s500,00\s₽, Просрочен$/,
    );
  });

  it('opens items and asks for more', async () => {
    const wrapper = mountAgenda([school, breakfast]);
    await wrapper.get('[data-testid="agenda-item-e1"] button').trigger('click');
    expect(wrapper.emitted('openEvent')?.[0]?.[0]).toMatchObject({ eventId: 'e1' });
    await wrapper.get('[data-testid="agenda-item-o1"] button').trigger('click');
    expect(wrapper.emitted('openPlan')?.[0]?.[0]).toMatchObject({ occurrenceId: 'o1' });
    await wrapper.get('[data-testid="agenda-more"]').trigger('click');
    expect(wrapper.emitted('more')).toHaveLength(1);
  });

  it('shows an empty state', () => {
    expect(mountAgenda([]).text()).toContain('На эти дни ничего не запланировано');
  });
});
