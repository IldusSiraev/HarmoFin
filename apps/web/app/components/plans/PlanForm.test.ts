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
    icon: null,
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
    icon: null,
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

  it('normalizes Russian decimal amount before submission', async () => {
    const wrapper = mount(PlanForm, {
      props: {
        accounts: [{ value: 'account-id', label: 'Счёт' }],
        categories,
        envelopes: [{ value: 'envelope-id', label: 'Обязательные' }],
      },
    });

    await wrapper.get('[name="name"]').setValue('Ипотека');
    await wrapper.get('[name="amount"]').setValue('36 000,00');
    await wrapper.get('[name="accountId"]').setValue('account-id');
    await wrapper.get('[name="categoryId"]').setValue('expense-category');
    await wrapper.get('[name="envelopeId"]').setValue('envelope-id');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({ amount: '36000.00' });
  });
});
