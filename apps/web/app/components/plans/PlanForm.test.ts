import { mount } from '@vue/test-utils';
import { VueDatePicker } from '@vuepic/vue-datepicker';
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
  it('shows the envelope field for expense', () => {
    const wrapper = mount(PlanForm, {
      props: {
        planType: 'EXPENSE',
        accounts: [],
        categories,
        envelopes: [{ value: 'envelope-id', label: 'Обязательные' }],
      },
    });

    expect(wrapper.find('[name="envelopeId"]').exists()).toBe(true);
  });

  it('hides the envelope field for income and shows it again for savings', async () => {
    const wrapper = mount(PlanForm, {
      props: {
        planType: 'EXPENSE',
        accounts: [],
        categories,
        envelopes: [{ value: 'envelope-id', label: 'Обязательные' }],
      },
    });

    await wrapper.setProps({ planType: 'INCOME' });
    expect(wrapper.find('[name="envelopeId"]').exists()).toBe(false);

    await wrapper.setProps({ planType: 'SAVINGS' });
    expect(wrapper.find('[name="envelopeId"]').exists()).toBe(true);
  });

  it('shows the interval field only for every-N-months recurrence', async () => {
    const wrapper = mount(PlanForm, {
      props: { planType: 'EXPENSE', accounts: [], categories, envelopes: [] },
    });

    expect(wrapper.find('[name="intervalMonths"]').exists()).toBe(false);
    await wrapper.get('[name="recurrence"]').setValue('EVERY_N_MONTHS');
    expect(wrapper.find('[name="intervalMonths"]').exists()).toBe(true);
  });

  it('writes the single date field into both anchorOn and startOn on submit', async () => {
    const wrapper = mount(PlanForm, {
      props: {
        planType: 'EXPENSE',
        accounts: [{ value: 'account-id', label: 'Счёт' }],
        categories,
        envelopes: [{ value: 'envelope-id', label: 'Обязательные' }],
      },
    });

    await wrapper.get('[name="name"]').setValue('Ипотека');
    await wrapper.get('[name="amount"]').setValue('36 000,00');
    // UiDatePicker wraps VueDatePicker, which masks its native input as
    // dd.MM.yyyy — the codebase's own convention (DatePicker.test.ts, "emits
    // the ISO date string a calendar selection resolves to") is to drive it
    // through the library's own update:modelValue emit, not .setValue().
    await wrapper.findComponent(VueDatePicker).vm.$emit('update:modelValue', '2026-09-26');
    await wrapper.get('[name="categoryId"]').setValue('expense-category');
    await wrapper.get('[name="envelopeId"]').setValue('envelope-id');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      amount: '36000.00',
      anchorOn: '2026-09-26',
      startOn: '2026-09-26',
    });
  });

  it('pre-fills the date field from defaultDate when creating', async () => {
    const wrapper = mount(PlanForm, {
      props: {
        planType: 'EXPENSE',
        accounts: [],
        categories,
        envelopes: [{ value: 'envelope-id', label: 'Обязательные' }],
        defaultDate: '2026-09-18',
      },
    });

    await wrapper.get('[name="categoryId"]').setValue('expense-category');
    await wrapper.get('[name="envelopeId"]').setValue('envelope-id');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      anchorOn: '2026-09-18',
      startOn: '2026-09-18',
    });
  });

  it('preserves a periodic plan anchorOn that differs from startOn when editing', async () => {
    const wrapper = mount(PlanForm, {
      props: {
        planType: 'EXPENSE',
        accounts: [],
        categories,
        envelopes: [{ value: 'envelope-id', label: 'Обязательные' }],
        plan: {
          id: 'plan-id',
          budgetId: 'budget-id',
          name: 'Ипотека',
          planType: 'EXPENSE',
          amountMinor: '3600000',
          currency: 'RUB',
          scale: 2,
          // The worker derives every future occurrence's day from anchorOn —
          // editing the amount must not silently move it onto startOn.
          anchorOn: '2026-08-26',
          startOn: '2026-09-01',
          endOn: null,
          recurrence: 'MONTHLY',
          intervalMonths: null,
          accountId: null,
          categoryId: 'expense-category',
          envelopeId: 'envelope-id',
          comment: null,
          isActive: true,
          disabledAt: null,
          deletedAt: null,
        },
      },
    });

    expect(wrapper.find('[name="anchorDate"]').exists()).toBe(true);

    await wrapper.get('[name="amount"]').setValue('37 000,00');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      amount: '37000.00',
      anchorOn: '2026-08-26',
      startOn: '2026-09-01',
    });
  });

  it('hides the anchor date for one-time plans and when creating', async () => {
    const created = mount(PlanForm, {
      props: { planType: 'EXPENSE', accounts: [], categories, envelopes: [] },
    });
    expect(created.find('[name="anchorDate"]').exists()).toBe(false);

    const editing = mount(PlanForm, {
      props: {
        planType: 'EXPENSE',
        accounts: [],
        categories,
        envelopes: [],
        plan: {
          id: 'plan-id',
          budgetId: 'budget-id',
          name: 'Разовый платёж',
          planType: 'EXPENSE',
          amountMinor: '100000',
          currency: 'RUB',
          scale: 2,
          anchorOn: '2026-09-26',
          startOn: '2026-09-26',
          endOn: null,
          recurrence: 'ONE_TIME',
          intervalMonths: null,
          accountId: null,
          categoryId: 'expense-category',
          envelopeId: null,
          comment: null,
          isActive: true,
          disabledAt: null,
          deletedAt: null,
        },
      },
    });

    expect(editing.find('[name="anchorDate"]').exists()).toBe(false);
  });

  it('shows delete and the active toggle only in edit mode, and emits remove', async () => {
    const created = mount(PlanForm, {
      props: { planType: 'EXPENSE', accounts: [], categories, envelopes: [] },
    });
    expect(created.find('[data-action="delete-plan"]').exists()).toBe(false);

    const editing = mount(PlanForm, {
      props: {
        planType: 'EXPENSE',
        accounts: [],
        categories,
        envelopes: [{ value: 'envelope-id', label: 'Обязательные' }],
        plan: {
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
          categoryId: 'expense-category',
          envelopeId: 'envelope-id',
          comment: null,
          isActive: true,
          disabledAt: null,
          deletedAt: null,
        },
      },
    });

    expect(editing.find('[data-action="delete-plan"]').exists()).toBe(true);
    expect(editing.find('[name="isActive"]').exists()).toBe(true);
    await editing.get('[data-action="delete-plan"]').trigger('click');
    expect(editing.emitted('remove')).toHaveLength(1);
  });
});
