import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EnvelopeDrawer from './EnvelopeDrawer.vue';
import type {
  EnvelopeBalanceSummaryDto,
  EnvelopeDto,
} from '../../composables/useBudgetReferenceData.js';

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

const balanceSummary: EnvelopeBalanceSummaryDto = {
  envelope,
  currency: 'RUB',
  scale: 2,
  startingBalanceMinor: '1000',
  incomeAllocatedMinor: '20000',
  expensesMinor: '5000',
  envelopeTransfersNetMinor: '0',
  reallocationsNetMinor: '1500',
  currentBalanceMinor: '20500',
  reallocations: [
    {
      reallocationId: 'reallocation-id',
      direction: 'IN',
      otherEnvelopeId: 'other-id',
      otherEnvelopeName: 'Первая половина',
      amountMinor: '1500',
      occurredOn: '2026-09-01',
      comment: null,
    },
  ],
};

const mountDrawer = (overrides: Partial<EnvelopeDto> = {}, extra: Record<string, unknown> = {}) =>
  mount(EnvelopeDrawer, {
    props: { envelope: { ...envelope, ...overrides }, ...extra },
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

  it('explains where the balance comes from with additive terms', () => {
    const wrapper = mountDrawer({}, { balanceSummary });

    expect(wrapper.text()).toContain('Откуда остаток');
    expect(wrapper.text()).toContain('Добавили доходы');
    expect(wrapper.text()).toContain('Потратили на расходы');
    expect(wrapper.text()).toContain('Движения между конвертами');
    expect(wrapper.text()).toContain('Текущий остаток');
    wrapper.unmount();
  });

  it('lists reallocation movements with direction and counterparty', () => {
    const wrapper = mountDrawer({}, { balanceSummary });

    const amounts = wrapper
      .findAll('[data-testid="reallocation-amount"]')
      .map((node) => node.text());
    expect(amounts).toHaveLength(1);
    expect(wrapper.text()).toContain('из «Первая половина»');
    wrapper.unmount();
  });

  it('shows a loading skeleton and an error line when the summary is unavailable', () => {
    const loading = mountDrawer({}, { balanceSummaryLoading: true });

    expect(loading.find('[data-testid="envelope-drawer-breakdown"]').exists()).toBe(false);
    loading.unmount();

    const errored = mountDrawer({}, { balanceSummaryError: 'Не удалось загрузить.' });

    expect(errored.get('[data-testid="envelope-drawer-summary-error"]').text()).toContain(
      'Не удалось загрузить.',
    );
    errored.unmount();
  });
});
