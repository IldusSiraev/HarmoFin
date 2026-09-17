import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EnvelopeDrawer from './EnvelopeDrawer.vue';
import type { EnvelopeDto } from '../../composables/useBudgetReferenceData.js';

const envelope: EnvelopeDto = {
  id: 'envelope-id',
  budgetId: 'budget-id',
  templateKey: null,
  name: 'Отпуск',
  envelopeType: 'SAVINGS_GOAL',
  periodSlot: null,
  currency: 'RUB',
  scale: 2,
  startingBalanceMinor: '0',
  currentBalanceMinor: '1000000',
  monthlyPlannedAmountMinor: '300000',
  targetAmountMinor: '5000000',
  targetDate: '2027-06-01',
  displayOrder: 10,
  comment: 'Копим на лето',
  archivedAt: null,
};

const mountDrawer = (overrides: Partial<EnvelopeDto> = {}) =>
  mount(EnvelopeDrawer, {
    props: { envelope: { ...envelope, ...overrides } },
    attachTo: document.body,
    global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  });

describe('EnvelopeDrawer', () => {
  it('shows the goal with its progress and date', () => {
    const wrapper = mountDrawer();

    expect(wrapper.text()).toContain('Цели накоплений');
    expect(wrapper.text()).toContain('2027-06-01');
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('20');
    wrapper.unmount();
  });

  it('shows the monthly plan as text without a bar', () => {
    const wrapper = mountDrawer({ targetAmountMinor: null, targetDate: null });

    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('План на месяц');
    wrapper.unmount();
  });

  it('hands editing and archiving back to the page', async () => {
    const wrapper = mountDrawer();

    await wrapper.get('[data-testid="envelope-drawer-edit"]').trigger('click');
    await wrapper.get('[data-testid="envelope-drawer-archive"]').trigger('click');

    expect(wrapper.emitted('edit')?.[0]?.[0]).toMatchObject({ id: 'envelope-id' });
    expect(wrapper.emitted('archive')?.[0]?.[0]).toMatchObject({ id: 'envelope-id' });
    wrapper.unmount();
  });

  it('links to the journal filtered by this envelope', () => {
    const wrapper = mountDrawer();

    expect(wrapper.get('[data-testid="envelope-drawer-operations"]').attributes('href')).toBe(
      '/app/operations?envelopeId=envelope-id',
    );
    wrapper.unmount();
  });
});
