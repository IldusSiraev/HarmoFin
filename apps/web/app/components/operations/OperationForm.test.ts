import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import OperationForm from './OperationForm.vue';

const categories = [
  {
    id: 'expense-category',
    budgetId: 'budget-id',
    templateKey: null,
    name: 'Продукты',
    categoryType: 'EXPENSE' as const,
    parentId: null,
    displayOrder: 0,
    comment: null,
    icon: null,
    archivedAt: null,
  },
  {
    id: 'income-category',
    budgetId: 'budget-id',
    templateKey: null,
    name: 'Зарплата',
    categoryType: 'INCOME' as const,
    parentId: null,
    displayOrder: 1,
    comment: null,
    icon: null,
    archivedAt: null,
  },
];

function mountCreateForm() {
  return mount(OperationForm, {
    props: {
      mode: 'create',
      model: {
        transactionType: 'EXPENSE',
        amount: '',
        occurredOn: '2026-09-04',
        accountId: '',
        categoryId: '',
        envelopeId: '',
        sourceDescription: '',
        merchantName: '',
        isPlanned: false,
      },
      accounts: [{ value: 'account-id', label: 'Счёт' }],
      categories,
      envelopes: [{ value: 'envelope-id', label: 'Конверт' }],
    },
  });
}

describe('OperationForm — create mode (stepped)', () => {
  it('asks one decision at a time instead of showing every field at once', () => {
    const wrapper = mountCreateForm();

    expect(wrapper.text()).toContain('Шаг 1 из 4');
    expect(wrapper.get('[name="amount"]').attributes('inputmode')).toBe('decimal');
    expect(wrapper.find('[name="accountId"]').exists()).toBe(false);
    expect(wrapper.find('[name="categoryId"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Конверт');
  });

  it('walks through account, category, then the type-specific details step', async () => {
    const wrapper = mountCreateForm();

    async function next() {
      const button = wrapper.findAll('button').find((candidate) => candidate.text() === 'Далее');
      await button!.trigger('click');
    }

    await wrapper.get('[name="amount"]').setValue('123.45');
    await next();
    expect(wrapper.text()).toContain('Шаг 2 из 4');
    expect(wrapper.find('[name="accountId"]').exists()).toBe(true);

    await wrapper.get('[name="accountId"]').setValue('account-id');
    await next();
    expect(wrapper.text()).toContain('Шаг 3 из 4');
    expect(wrapper.find('[name="categoryId"]').exists()).toBe(true);

    await wrapper.get('[name="categoryId"]').setValue('expense-category');
    await next();
    expect(wrapper.text()).toContain('Шаг 4 из 4');
    expect(wrapper.text()).toContain('Конверт');
    expect(wrapper.text()).toContain('Подтвердить операцию');

    const back = wrapper.findAll('button').find((candidate) => candidate.text() === 'Назад');
    await back!.trigger('click');
    expect(wrapper.text()).toContain('Шаг 3 из 4');
  });

  it('switches the details step by transaction type', async () => {
    const wrapper = mountCreateForm();

    async function next() {
      const button = wrapper.findAll('button').find((candidate) => candidate.text() === 'Далее');
      await button!.trigger('click');
    }

    await wrapper.get('[name="transactionType"]').setValue('INCOME');
    await wrapper.get('[name="amount"]').setValue('123.45');
    await next();
    await wrapper.get('[name="accountId"]').setValue('account-id');
    await next();
    await wrapper.get('[name="categoryId"]').setValue('income-category');
    await next();

    expect(wrapper.text()).toContain('Источник дохода');
    expect(wrapper.text()).not.toContain('Получатель или магазин');
  });
});

describe('OperationForm — edit mode (single screen)', () => {
  it('shows every field at once with no step navigation', () => {
    const wrapper = mount(OperationForm, {
      props: {
        mode: 'edit',
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
        categories,
        envelopes: [{ value: 'envelope-id', label: 'Конверт' }],
      },
    });

    expect(wrapper.text()).not.toContain('Шаг');
    expect(wrapper.find('button').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Далее');
    expect(wrapper.find('[name="accountId"]').exists()).toBe(true);
    expect(wrapper.find('[name="categoryId"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Конверт');
    expect(wrapper.text()).toContain('Сохранить изменения');
  });
});
