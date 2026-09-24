import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlanRow from './PlanRow.vue';
import type { RegularPlanDto } from '../../composables/useBudgetReferenceData.js';

function plan(overrides: Partial<RegularPlanDto> = {}): RegularPlanDto {
  return {
    id: 'plan-id',
    budgetId: 'budget-id',
    name: 'Подписки',
    planType: 'EXPENSE',
    amountMinor: '300000',
    currency: 'RUB',
    scale: 2,
    anchorOn: '2026-09-20',
    startOn: '2026-09-20',
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
    ...overrides,
  };
}

describe('PlanRow', () => {
  it('shows the recurrence label and emits edit/remove', async () => {
    const wrapper = mount(PlanRow, { props: { plan: plan(), categoryIcon: null } });

    expect(wrapper.text()).toContain('Ежемесячно');
    await wrapper.get('[data-action="edit-plan"]').trigger('click');
    await wrapper.get('[data-action="remove-plan"]').trigger('click');

    expect(wrapper.emitted('edit')).toHaveLength(1);
    expect(wrapper.emitted('remove')).toHaveLength(1);
  });

  it('shows an interval label for EVERY_N_MONTHS plans', () => {
    const wrapper = mount(PlanRow, {
      props: { plan: plan({ recurrence: 'EVERY_N_MONTHS', intervalMonths: 3 }), categoryIcon: null },
    });

    expect(wrapper.text()).toContain('Раз в 3 мес.');
  });

  it('marks a disabled plan', () => {
    const wrapper = mount(PlanRow, { props: { plan: plan({ isActive: false }), categoryIcon: null } });

    expect(wrapper.text()).toContain('Отключён');
  });
});
