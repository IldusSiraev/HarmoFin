import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type {
  PlansCalendarItem,
  TransactionJournalV2Item,
} from '../../composables/useEnvelopePlanV2.js';
import PlanDayPanel from './PlanDayPanel.vue';

const rent: PlansCalendarItem = {
  kind: 'OBLIGATION',
  occurrenceId: 'occ-rent',
  planId: 'plan-rent',
  name: 'Аренда',
  scheduledOn: '2026-09-24',
  status: 'PENDING',
  expectedMinor: '4000000',
  paidMinor: '0',
  unpaidMinor: '4000000',
  categoryId: 'cat-rent',
  overdue: false,
  transactionId: null,
  factOn: null,
  factMinor: null,
  factTransactionIds: [],
  owner: { userId: 'user-1', displayName: 'Алия', isActiveMember: true },
  canEdit: true,
};
const salary: PlansCalendarItem = {
  ...rent,
  kind: 'INCOME_PLAN',
  occurrenceId: 'occ-salary',
  planId: 'plan-salary',
  name: 'Зарплата',
  expectedMinor: '10000000',
  unpaidMinor: '10000000',
  categoryId: 'cat-salary',
};
const expenseFact: TransactionJournalV2Item = {
  id: 'tx-1',
  budgetId: 'b',
  accountingModelVersion: 2,
  transactionType: 'EXPENSE',
  status: 'CONFIRMED',
  amountMinor: '250000',
  currency: 'RUB',
  occurredOn: '2026-09-24',
  accountId: 'acc',
  categoryId: 'cat-food',
  envelopeId: null,
  sourceDescription: null,
  merchantName: 'Пятёрочка',
  comment: null,
  planOccurrenceIds: [],
  confirmedAt: null,
  cancelledAt: null,
  deletedAt: null,
  createdAt: '2026-09-24T10:00:00Z',
};
const incomeFact: TransactionJournalV2Item = {
  ...expenseFact,
  id: 'tx-2',
  transactionType: 'INCOME',
  amountMinor: '500000',
  categoryId: 'cat-salary',
  merchantName: null,
  sourceDescription: 'Работодатель',
};
const categoryNames = { 'cat-food': 'Продукты', 'cat-salary': 'Зарплата' };

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(PlanDayPanel, {
    props: { date: '2026-09-24', items: [], facts: [], categoryNames, ...props },
  });
}
const norm = (value: string) => value.replace(/\s/g, ' ');

describe('PlanDayPanel', () => {
  it('titles the card with the day date', () => {
    const wrapper = mountPanel();
    expect(wrapper.find('[data-testid="day-panel"]').exists()).toBe(true);
    expect(wrapper.get('h2').text()).toContain('24 сентября');
  });

  it('keeps the header fixed and scrolls the lists in their own container', () => {
    const wrapper = mountPanel({ items: [rent], facts: [expenseFact] });
    const scroll = wrapper.get('[data-testid="day-panel-scroll"]');
    expect(scroll.find('[data-testid="day-item-occ-rent"]').exists()).toBe(true);
    expect(scroll.find('[data-testid="day-fact-tx-1"]').exists()).toBe(true);
    expect(scroll.find('[data-testid="plan-add-for-day"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="plan-add-for-day"]').exists()).toBe(true);
  });

  it('puts the actions of a plan item in its own row next to the status line', () => {
    const wrapper = mountPanel({ items: [rent] });
    const row = wrapper.get('[data-testid="day-item-occ-rent"]');
    const actions = row.get('[data-testid="day-actions-occ-rent"]');
    expect(actions.find('[data-testid="day-edit-occ-rent"]').exists()).toBe(true);
    expect(actions.find('[data-testid="day-pay-occ-rent"]').exists()).toBe(true);
    expect(row.get('[data-testid="day-meta-occ-rent"]').text()).toContain('Ожидается');
  });

  it('shows an empty day and emits add-plan with the date', async () => {
    const wrapper = mountPanel();
    expect(wrapper.get('[data-testid="day-empty"]').text()).toContain(
      'На этот день пока ничего нет',
    );
    await wrapper.get('[data-testid="plan-add-for-day"]').trigger('click');
    expect(wrapper.emitted('add-plan')).toEqual([['2026-09-24']]);
  });

  it('lists plan items with actions that emit the item', async () => {
    const wrapper = mountPanel({ items: [rent, salary] });
    expect(wrapper.find('[data-testid="day-empty"]').exists()).toBe(false);
    const rentRow = wrapper.get('[data-testid="day-item-occ-rent"]');
    expect(rentRow.text()).toContain('Аренда');
    expect(norm(rentRow.text())).toContain('40 000,00');
    expect(wrapper.get('[data-testid="day-pay-occ-rent"]').attributes('aria-label')).toBe(
      'Оплатить Аренда',
    );
    expect(wrapper.get('[data-testid="day-skip-occ-rent"]').attributes('aria-label')).toBe(
      'Пропустить Аренда',
    );
    expect(wrapper.get('[data-testid="day-record-occ-salary"]').attributes('aria-label')).toBe(
      'Записать доход Зарплата',
    );
    await wrapper.get('[data-testid="day-pay-occ-rent"]').trigger('click');
    await wrapper.get('[data-testid="day-skip-occ-rent"]').trigger('click');
    await wrapper.get('[data-testid="day-record-occ-salary"]').trigger('click');
    expect(wrapper.emitted('pay')).toEqual([[rent]]);
    expect(wrapper.emitted('skip')).toEqual([[rent]]);
    expect(wrapper.emitted('record-income')).toEqual([[salary]]);
  });

  it('labels an overdue item as overdue', () => {
    const overdue = { ...rent, status: 'DUE', overdue: true };
    const wrapper = mountPanel({ items: [overdue, salary] });
    expect(wrapper.get('[data-testid="day-overdue-occ-rent"]').text()).toContain('Просрочено');
    expect(wrapper.find('[data-testid="day-overdue-occ-salary"]').exists()).toBe(false);
  });

  it('shows the remainder for a partially paid item only', () => {
    const partial = { ...rent, paidMinor: '1000000', unpaidMinor: '3000000' };
    const wrapper = mountPanel({ items: [partial, salary] });
    const text = norm(wrapper.get('[data-testid="day-item-occ-rent"]').text());
    expect(text).toContain('Остаток');
    expect(text).toContain('30 000,00');
    expect(wrapper.get('[data-testid="day-item-occ-salary"]').text()).not.toContain('Остаток');
  });

  it('shows no actions for closed items and no skip when partially paid', () => {
    const closed = { ...rent, status: 'COMPLETED', paidMinor: '4000000', unpaidMinor: '0' };
    const partial = { ...rent, occurrenceId: 'occ-part', paidMinor: '100', unpaidMinor: '3999900' };
    const wrapper = mountPanel({ items: [closed, partial] });
    expect(wrapper.find('[data-testid="day-pay-occ-rent"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="day-pay-occ-part"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="day-skip-occ-part"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="day-item-occ-rent"]').text()).toContain('Выполнено');
  });

  it('shows a plan settled on this day once: no separate row for its operation', () => {
    const settled = {
      ...rent,
      status: 'COMPLETED',
      scheduledOn: '2026-09-25',
      paidMinor: '250000',
      unpaidMinor: '0',
      factOn: '2026-09-24',
      factMinor: '250000',
      factTransactionIds: ['tx-1'],
    };
    const wrapper = mountPanel({ items: [settled], facts: [expenseFact, incomeFact] });
    const row = wrapper.get('[data-testid="day-item-occ-rent"]');
    expect(row.text()).toContain('Выполнено');
    expect(row.text()).toContain('по плану 25 сентября');
    expect(norm(row.text())).toContain('2 500,00');
    expect(wrapper.find('[data-testid="day-fact-tx-1"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="day-fact-tx-2"]').exists()).toBe(true);
  });

  it('keeps an operation listed when its plan is shown on another day', () => {
    const settled = {
      ...rent,
      status: 'COMPLETED',
      factOn: '2026-09-25',
      factMinor: '250000',
      factTransactionIds: ['tx-1'],
    };
    const wrapper = mountPanel({ items: [settled], facts: [expenseFact] });
    expect(wrapper.find('[data-testid="day-fact-tx-1"]').exists()).toBe(true);
  });

  it('shows facts with words, category, caption and amount', () => {
    const wrapper = mountPanel({ facts: [expenseFact, incomeFact] });
    const expense = wrapper.get('[data-testid="day-fact-tx-1"]');
    expect(expense.text()).toContain('Расход');
    expect(expense.text()).toContain('Продукты');
    expect(expense.text()).toContain('Пятёрочка');
    expect(norm(expense.text())).toContain('2 500,00');
    const income = wrapper.get('[data-testid="day-fact-tx-2"]');
    expect(income.text()).toContain('Доход');
    expect(income.text()).toContain('Зарплата');
    expect(income.text()).toContain('Работодатель');
    expect(norm(income.text())).toContain('5 000,00');
    expect(wrapper.find('[data-testid="day-empty"]').exists()).toBe(false);
  });

  it('shows a loading note for facts', () => {
    expect(mountPanel({ factsLoading: true }).text()).toContain('Загрузка операций…');
  });

  it('shows a retryable alert when facts fail', async () => {
    const wrapper = mountPanel({ factsError: true });
    expect(wrapper.get('[role="alert"]').text()).toContain('Не удалось загрузить операции дня.');
    const retry = wrapper.findAll('button').find((button) => button.text() === 'Повторить');
    expect(retry).toBeDefined();
    await retry!.trigger('click');
    expect(wrapper.emitted('retry-facts')).toHaveLength(1);
  });

  it('shows an edit button on every item regardless of status and emits edit-plan', async () => {
    const closed = { ...rent, occurrenceId: 'occ-closed', status: 'COMPLETED' };
    const wrapper = mountPanel({ items: [rent, salary, closed] });
    for (const [id, name] of [
      ['day-edit-occ-rent', 'Аренда'],
      ['day-edit-occ-salary', 'Зарплата'],
      ['day-edit-occ-closed', 'Аренда'],
    ] as const) {
      expect(wrapper.get(`[data-testid="${id}"]`).attributes('aria-label')).toBe(
        `Изменить план ${name}`,
      );
    }
    expect(wrapper.find('[data-testid="day-pay-occ-closed"]').exists()).toBe(false);
    await wrapper.get('[data-testid="day-edit-occ-closed"]').trigger('click');
    await wrapper.get('[data-testid="day-edit-occ-salary"]').trigger('click');
    expect(wrapper.emitted('edit-plan')).toEqual([[closed], [salary]]);
  });

  it('shows an edit button for skipped and cancelled items and emits edit-plan', async () => {
    const skipped = { ...rent, occurrenceId: 'occ-skipped', status: 'SKIPPED' };
    const cancelled = { ...salary, occurrenceId: 'occ-cancelled', status: 'CANCELLED' };
    const wrapper = mountPanel({ items: [skipped, cancelled] });
    await wrapper.get('[data-testid="day-edit-occ-skipped"]').trigger('click');
    await wrapper.get('[data-testid="day-edit-occ-cancelled"]').trigger('click');
    expect(wrapper.emitted('edit-plan')).toEqual([[skipped], [cancelled]]);
  });

  it('disables the edit buttons while busy', () => {
    const wrapper = mountPanel({ items: [rent, salary], busy: true });
    for (const id of ['day-edit-occ-rent', 'day-edit-occ-salary']) {
      expect(wrapper.get(`[data-testid="${id}"]`).attributes('disabled')).toBeDefined();
    }
  });

  it('disables plan actions while busy', () => {
    const wrapper = mountPanel({ items: [rent, salary], busy: true });
    for (const id of ['day-pay-occ-rent', 'day-skip-occ-rent', 'day-record-occ-salary']) {
      expect(wrapper.get(`[data-testid="${id}"]`).attributes('disabled')).toBeDefined();
    }
  });

  it('hides "Добавить план" when canCreate is false', () => {
    const wrapper = mountPanel({ items: [rent, salary], canCreate: false });

    expect(wrapper.find('[data-testid="plan-add-for-day"]').exists()).toBe(false);
  });

  it('hides pay, skip, record-income and edit on items the server marked canEdit false', () => {
    const foreignRent = { ...rent, canEdit: false };
    const foreignSalary = { ...salary, canEdit: false };
    const wrapper = mountPanel({ items: [foreignRent, foreignSalary] });

    expect(wrapper.find('[data-testid="day-edit-occ-rent"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="day-pay-occ-rent"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="day-skip-occ-rent"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="day-record-occ-salary"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="day-edit-occ-salary"]').exists()).toBe(false);
  });

  it('keeps "Добавить план" for an editor and actions on own items', () => {
    const wrapper = mountPanel({ items: [rent, salary], canCreate: true });

    expect(wrapper.find('[data-testid="plan-add-for-day"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="day-pay-occ-rent"]').exists()).toBe(true);
  });

  it('shows owner captions only when the family has several members', () => {
    const foreignSalary = {
      ...salary,
      owner: { userId: 'user-2', displayName: 'Борис', isActiveMember: true },
    };
    const wrapper = mountPanel({
      items: [rent, foreignSalary],
      showOwner: true,
      userId: 'user-1',
    });
    expect(wrapper.get('[data-testid="day-meta-occ-rent"]').text()).toContain('Владелец: Мой');
    expect(wrapper.get('[data-testid="day-meta-occ-salary"]').text()).toContain('Владелец: Борис');
    const plain = mountPanel({ items: [rent, foreignSalary] });
    expect(plain.text()).not.toContain('Владелец:');
  });
});
