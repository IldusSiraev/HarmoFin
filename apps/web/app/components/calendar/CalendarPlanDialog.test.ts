import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import type { CalendarFeedPlanItem } from '../../composables/useFamilyCalendar.js';
import { formatMinorUnits } from '../finance/money-format.js';
import CalendarPlanDialog from './CalendarPlanDialog.vue';

const rent: CalendarFeedPlanItem = {
  kind: 'PLAN',
  occurrenceId: 'o-17',
  planId: 'p1',
  planKind: 'OBLIGATION',
  title: 'Аренда',
  amountMinor: '4500000',
  status: 'DUE',
  isOverdue: true,
  scheduledOn: '2026-10-28',
  owner: { userId: 'i', displayName: 'Ильдар', isActiveMember: true },
};

const wrappers: Array<{ unmount: () => void }> = [];
function mountDialog(item: CalendarFeedPlanItem | null = rent) {
  const wrapper = mount(CalendarPlanDialog, {
    props: { open: true, item },
    global: {
      stubs: {
        teleport: true,
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
      },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount();
});

describe('CalendarPlanDialog', () => {
  it('shows the payment amount, status and owner', () => {
    const wrapper = mountDialog();
    expect(wrapper.get('.modal__title').text()).toBe('Аренда');
    expect(wrapper.text()).toContain('Сумма');
    expect(wrapper.get('[data-testid="calendar-plan-amount"]').text()).toBe(
      formatMinorUnits('4500000', 'RUB', 2),
    );
    expect(wrapper.findComponent({ name: 'UiStatus' }).props()).toMatchObject({
      label: 'Просрочен',
      tone: 'warning',
    });
    expect(wrapper.get('[data-testid="calendar-plan-owner"]').text()).toBe('Владелец: Ильдар');
  });

  it('links to the occurrence in Plans', () => {
    const link = mountDialog().get('a');
    expect(link.attributes('href')).toBe('/app/plans?occurrence=o-17');
    expect(link.text()).toBe('Открыть в «Планах»');
    expect(link.find('svg').exists()).toBe(true);
  });

  it('closes on request and renders nothing without an item', async () => {
    const wrapper = mountDialog(null);
    expect(wrapper.find('[data-testid="calendar-plan-amount"]').exists()).toBe(false);
    await wrapper.get('[data-testid="modal-close"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
