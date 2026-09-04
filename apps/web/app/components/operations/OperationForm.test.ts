import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import OperationForm from './OperationForm.vue';

describe('OperationForm', () => {
  it('changes visible fields by operation type and keeps decimal input', async () => {
    const wrapper = mount(OperationForm, {
      props: {
        mode: 'create',
        model: {
          transactionType: 'EXPENSE',
          amount: '123.45',
          occurredOn: '2026-09-04',
          accountId: 'account-id',
          categoryId: 'expense-category',
          envelopeId: 'envelope-id',
          sourceDescription: '',
          merchantName: '',
          isPlanned: false,
        },
        accounts: [{ value: 'account-id', label: 'Счёт' }],
        categories: [
          {
            id: 'expense-category',
            budgetId: 'budget-id',
            templateKey: null,
            name: 'Продукты',
            categoryType: 'EXPENSE',
            parentId: null,
            displayOrder: 0,
            comment: null,
            archivedAt: null,
          },
          {
            id: 'income-category',
            budgetId: 'budget-id',
            templateKey: null,
            name: 'Зарплата',
            categoryType: 'INCOME',
            parentId: null,
            displayOrder: 1,
            comment: null,
            archivedAt: null,
          },
        ],
        envelopes: [{ value: 'envelope-id', label: 'Конверт' }],
      },
    });

    expect(wrapper.get('[name="amount"]').attributes('inputmode')).toBe('decimal');
    expect(wrapper.text()).toContain('Конверт');
    await wrapper.get('[name="transactionType"]').setValue('INCOME');
    expect(wrapper.text()).toContain('Источник дохода');
    expect(wrapper.text()).not.toContain('Получатель или магазин');
  });
});
