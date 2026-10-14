import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import OperationForm from './OperationForm.vue';
import type { TransactionJournalV2Item } from '../../composables/useEnvelopePlanV2.js';

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

const expense: TransactionJournalV2Item = {
  id: 'transaction-id',
  budgetId: 'budget-id',
  accountingModelVersion: 2,
  transactionType: 'EXPENSE',
  status: 'CONFIRMED',
  amountMinor: '12345',
  currency: 'RUB',
  occurredOn: '2026-09-04',
  accountId: 'account-id',
  categoryId: 'expense-category',
  envelopeId: 'envelope-id',
  sourceDescription: null,
  merchantName: null,
  comment: null,
  planOccurrenceIds: [],
  confirmedAt: '2026-09-04T00:00:00.000Z',
  cancelledAt: null,
  deletedAt: null,
  createdAt: '2026-09-04T00:00:00.000Z',
};

const mountForm = (
  current: TransactionJournalV2Item = expense,
  props: Record<string, unknown> = {},
) =>
  mount(OperationForm, {
    props: {
      current,
      accounts: [{ value: 'account-id', label: 'Счёт' }],
      categories,
      envelopes: [{ value: 'envelope-id', label: 'Конверт' }],
      ...props,
    },
  });

describe('OperationForm (v2 edit)', () => {
  it('shows every editable field at once, preloaded, with no steps', () => {
    const wrapper = mountForm();

    expect(wrapper.text()).not.toContain('Шаг');
    expect(wrapper.text()).not.toContain('Далее');
    expect((wrapper.get('[name="amount"]').element as HTMLInputElement).value).toBe('123.45');
    expect(wrapper.findComponent({ name: 'UiDatePicker' }).props('modelValue')).toBe('2026-09-04');
    expect(wrapper.find('[name="accountId"]').exists()).toBe(true);
    expect(wrapper.find('[name="categoryId"]').exists()).toBe(true);
    expect(wrapper.find('[name="envelopeId"]').exists()).toBe(true);
    expect(wrapper.find('[name="comment"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Сохранить изменения');
  });

  it('does not let the type change and has no leftovers of the old model', () => {
    const wrapper = mountForm();

    expect(wrapper.find('[name="transactionType"]').exists()).toBe(false);
    expect(wrapper.find('[name="merchantName"]').exists()).toBe(false);
    expect(wrapper.find('[name="sourceDescription"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Запланированная');
  });

  it('hides the envelope for an income', () => {
    const wrapper = mountForm({
      ...expense,
      transactionType: 'INCOME',
      envelopeId: null,
      categoryId: 'income-category',
    });

    expect(wrapper.find('[name="envelopeId"]').exists()).toBe(false);
  });

  it('submits only what changed', async () => {
    const wrapper = mountForm();

    await wrapper.get('[name="comment"]').setValue('Заметка');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')).toEqual([[{ comment: 'Заметка' }]]);
  });

  it('says so instead of sending an empty edit', async () => {
    const wrapper = mountForm();

    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.get('[role="alert"]').text()).toContain('Нет изменений');
  });

  it('shows field-level errors and a form-level message', () => {
    const wrapper = mountForm(expense, {
      errors: { amount: 'Сумма должна быть больше нуля.' },
      formError: 'Проверьте введённые данные.',
    });

    expect(wrapper.text()).toContain('Сумма должна быть больше нуля.');
    expect(wrapper.get('[role="alert"]').text()).toContain('Проверьте введённые данные.');
  });

  it('blocks a second submit while saving', () => {
    const wrapper = mountForm(expense, { pending: true });

    expect(wrapper.get('[data-action="save-operation"]').attributes('disabled')).toBeDefined();
  });
});
