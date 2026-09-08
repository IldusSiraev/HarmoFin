import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlanForm from './PlanForm.vue';

const categories = [
  {
    id: 'income-category',
    budgetId: 'budget-id',
    templateKey: null,
    name: 'Зарплата',
    categoryType: 'INCOME' as const,
    parentId: null,
    displayOrder: 0,
    comment: null,
    archivedAt: null,
  },
  {
    id: 'expense-category',
    budgetId: 'budget-id',
    templateKey: null,
    name: 'Ипотека',
    categoryType: 'EXPENSE' as const,
    parentId: null,
    displayOrder: 1,
    comment: null,
    archivedAt: null,
  },
];

describe('PlanForm', () => {
  it('shows interval only for every-N-month recurrence', async () => {
    const wrapper = mount(PlanForm, {
      props: {
        accounts: [],
        categories,
        envelopes: [],
      },
    });

    expect(wrapper.find('[name="intervalMonths"]').exists()).toBe(false);
    await wrapper.get('[name="recurrence"]').setValue('EVERY_N_MONTHS');
    expect(wrapper.find('[name="intervalMonths"]').exists()).toBe(true);
  });

  it('does not show an envelope for income plan', async () => {
    const wrapper = mount(PlanForm, {
      props: {
        accounts: [],
        categories,
        envelopes: [{ value: 'envelope-id', label: 'Обязательные' }],
      },
    });

    await wrapper.get('[name="planType"]').setValue('INCOME');
    expect(wrapper.find('[name="envelopeId"]').exists()).toBe(false);
    await wrapper.get('[name="planType"]').setValue('EXPENSE');
    expect(wrapper.find('[name="envelopeId"]').exists()).toBe(true);
  });
});
