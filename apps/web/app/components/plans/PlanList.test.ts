import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlanList from './PlanList.vue';
import type { PlanOccurrenceDto, RegularPlanDto } from '../../composables/useBudgetReferenceData.js';

const occurrence: PlanOccurrenceDto = {
  id: 'occurrence-id',
  planId: 'plan-id',
  planName: 'Ипотека',
  planType: 'EXPENSE',
  scheduledOn: '2026-09-26',
  status: 'DUE',
  amountMinor: '3600000',
  currency: 'RUB',
  scale: 2,
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  comment: null,
  transactionId: null,
  cancellationReason: null,
};

const plan: RegularPlanDto = {
  id: 'plan-id',
  budgetId: 'budget-id',
  name: 'Ипотека',
  planType: 'EXPENSE',
  amountMinor: '3600000',
  currency: 'RUB',
  scale: 2,
  anchorOn: '2026-09-26',
  startOn: '2026-09-26',
  endOn: null,
  recurrence: 'MONTHLY',
  intervalMonths: null,
  accountId: null,
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  comment: null,
  isActive: true,
  disabledAt: null,
  deletedAt: null,
};

describe('PlanList', () => {
  it('shows occurrences on the upcoming tab and plans on the all tab', async () => {
    const wrapper = mount(PlanList, {
      props: {
        activeTab: 'upcoming',
        upcomingOccurrences: [occurrence],
        allPlans: [plan],
        categoryIconById: {},
      },
    });

    expect(wrapper.text()).toContain('Ипотека');
    expect(wrapper.findComponent({ name: 'PlanRow' }).exists()).toBe(false);

    await wrapper.setProps({ activeTab: 'all' });
    expect(wrapper.findComponent({ name: 'PlanRow' }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'PlanOccurrenceRow' }).exists()).toBe(false);
  });

  it('emits update:activeTab when a tab button is clicked', async () => {
    const wrapper = mount(PlanList, {
      props: { activeTab: 'upcoming', upcomingOccurrences: [], allPlans: [], categoryIconById: {} },
    });

    await wrapper.get('[data-action="plans-tab-all"]').trigger('click');

    expect(wrapper.emitted('update:activeTab')?.[0]).toEqual(['all']);
  });

  it('shows an empty state when the active tab has nothing to show', () => {
    const wrapper = mount(PlanList, {
      props: { activeTab: 'upcoming', upcomingOccurrences: [], allPlans: [], categoryIconById: {} },
    });

    expect(wrapper.text()).toContain('Ближайших платежей пока нет');
  });

  it('forwards PlanOccurrenceRow events with the source occurrence, resolving its category icon', async () => {
    const wrapper = mount(PlanList, {
      props: {
        activeTab: 'upcoming',
        upcomingOccurrences: [occurrence],
        allPlans: [],
        categoryIconById: { 'category-id': 'house' },
      },
    });

    expect(wrapper.findComponent({ name: 'PlanOccurrenceRow' }).props('categoryIcon')).toBe('house');

    await wrapper.get('input[type="checkbox"]').setValue(true);

    expect(wrapper.emitted('complete-occurrence')?.[0]).toEqual([occurrence]);
  });
});
