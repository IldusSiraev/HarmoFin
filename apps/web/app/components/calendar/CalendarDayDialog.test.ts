import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { CalendarFeedItem } from '../../composables/useFamilyCalendar.js';
import CalendarDayDialog from './CalendarDayDialog.vue';

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
  isOverdue: false,
  scheduledOn: '2026-10-30',
  owner: ildar,
};

function mountDialog(canCreate = true) {
  return mount(CalendarDayDialog, {
    props: {
      open: true,
      date: '2026-10-30',
      items: [breakfast, school],
      // A third member keeps the event from being labelled «Вся семья».
      activeMemberIds: new Set(['a', 'i', 'z']),
      canCreate,
    },
    global: { stubs: { teleport: true } },
  });
}

describe('CalendarDayDialog', () => {
  it('titles the dialog with the weekday and date', () => {
    expect(mountDialog().get('.modal__title').text()).toBe('Пятница, 30 октября');
  });

  it('shows event time, title, participants and author', () => {
    const row = mountDialog().get('[data-testid="day-item-e1"]');
    expect(row.text()).toContain('09:30');
    expect(row.text()).toContain('Семейный завтрак');
    expect(row.text()).toContain('Алия, Ильдар');
    expect(row.text()).toContain('Автор: Ильдар');
  });

  it('shows payment amount, status and owner', () => {
    const row = mountDialog().get('[data-testid="day-item-o1"]');
    expect(row.text()).toMatch(/12\s500/);
    expect(row.text()).toContain('Ожидается');
    expect(row.text()).toContain('Владелец: Ильдар');
  });

  it('opens items from their rows', async () => {
    const wrapper = mountDialog();
    await wrapper.get('[data-testid="day-item-e1"]').trigger('click');
    expect(wrapper.emitted('openEvent')?.[0]?.[0]).toMatchObject({ eventId: 'e1' });
    await wrapper.get('[data-testid="day-item-o1"]').trigger('click');
    expect(wrapper.emitted('openPlan')?.[0]?.[0]).toMatchObject({ occurrenceId: 'o1' });
  });

  it('creates an event on this day and closes', async () => {
    const wrapper = mountDialog();
    expect(wrapper.get('[data-testid="day-create"]').text()).toContain(
      'Новое событие на этот день',
    );
    await wrapper.get('[data-testid="day-create"]').trigger('click');
    expect(wrapper.emitted('create')?.[0]).toEqual(['2026-10-30']);
    expect(wrapper.get('[data-testid="day-close"]').text()).toBe('Закрыть');
    await wrapper.get('[data-testid="day-close"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('hides creation without the right to create', () => {
    const wrapper = mountDialog(false);
    expect(wrapper.find('[data-testid="day-create"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Новое событие на этот день');
  });
});
