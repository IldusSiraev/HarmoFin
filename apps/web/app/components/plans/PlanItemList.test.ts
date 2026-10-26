import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { PlansCalendarItem } from '../../composables/useEnvelopePlanV2.js';
import PlanItemList from './PlanItemList.vue';

const base: PlansCalendarItem = {
  kind: 'OBLIGATION',
  occurrenceId: '',
  planId: 'plan',
  name: '',
  scheduledOn: '',
  status: 'PENDING',
  expectedMinor: '0',
  paidMinor: '0',
  unpaidMinor: '0',
  categoryId: null,
  overdue: false,
  transactionId: null,
  factOn: null,
  factMinor: null,
  factTransactionIds: [],
};
const daycare: PlansCalendarItem = {
  ...base,
  occurrenceId: 'occ-daycare',
  name: 'Детский сад',
  scheduledOn: '2026-09-10',
  status: 'DUE',
  expectedMinor: '300000',
  unpaidMinor: '300000',
  overdue: true,
};
const rent: PlansCalendarItem = {
  ...base,
  occurrenceId: 'occ-rent',
  name: 'Аренда',
  scheduledOn: '2026-09-30',
  expectedMinor: '4000000',
  unpaidMinor: '4000000',
};
const done: PlansCalendarItem = {
  ...base,
  occurrenceId: 'occ-done',
  name: 'Интернет',
  scheduledOn: '2026-09-12',
  status: 'COMPLETED',
  expectedMinor: '90000',
  paidMinor: '90000',
};
const salary: PlansCalendarItem = {
  ...base,
  kind: 'INCOME_PLAN',
  occurrenceId: 'inc-occ',
  name: 'Зарплата',
  scheduledOn: '2026-09-25',
  expectedMinor: '10000000',
};
const today = '2026-09-24';

function mountList(props: Record<string, unknown> = {}) {
  return mount(PlanItemList, {
    props: {
      items: [rent, salary, done],
      overdue: [daycare],
      today,
      mode: 'upcoming',
      hasAnyPlans: true,
      ...props,
    },
  });
}
function rowIds(wrapper: ReturnType<typeof mountList>) {
  return wrapper.findAll('li[data-testid]').map((row) => row.attributes('data-testid'));
}

describe('PlanItemList', () => {
  it('upcoming: overdue first, then open items, closed items hidden', () => {
    const wrapper = mountList();
    expect(rowIds(wrapper)).toEqual([
      'obligation-row-occ-daycare',
      'obligation-row-occ-rent',
      'income-row-inc-occ',
    ]);
    expect(wrapper.find('[data-testid="obligation-row-occ-done"]').exists()).toBe(false);
  });

  it('upcoming: an id present in both overdue and items is shown once', () => {
    const wrapper = mountList({ items: [daycare, rent], overdue: [daycare] });
    expect(rowIds(wrapper)).toEqual(['obligation-row-occ-daycare', 'obligation-row-occ-rent']);
  });

  it('upcoming excludes an unflagged open past-dated obligation, all keeps it', () => {
    const stale = { ...rent, occurrenceId: 'occ-stale', scheduledOn: '2026-09-01', overdue: false };
    const upcoming = mountList({ items: [stale, rent], overdue: [] });
    expect(rowIds(upcoming)).toEqual(['obligation-row-occ-rent']);
    const all = mountList({ mode: 'all', items: [stale, rent], overdue: [] });
    expect(rowIds(all)).toEqual(['obligation-row-occ-stale', 'obligation-row-occ-rent']);
  });

  it('all: shows every item with open ones first', () => {
    const wrapper = mountList({ mode: 'all', items: [daycare, rent, done, salary], overdue: [] });
    expect(rowIds(wrapper)).toEqual([
      'obligation-row-occ-daycare',
      'obligation-row-occ-rent',
      'income-row-inc-occ',
      'obligation-row-occ-done',
    ]);
    expect(wrapper.get('[data-testid="obligation-row-occ-done"]').text()).toContain('Выполнено');
  });

  it('marks overdue and linked rows', () => {
    const wrapper = mountList({ linkedId: 'occ-rent' });
    expect(
      wrapper
        .find('[data-testid="obligation-row-occ-daycare"] [data-testid="obligation-overdue"]')
        .text(),
    ).toContain('Просрочено');
    expect(
      wrapper
        .find('[data-testid="obligation-row-occ-rent"] [data-testid="obligation-overdue"]')
        .exists(),
    ).toBe(false);
    const rentRow = wrapper.get('[data-testid="obligation-row-occ-rent"]');
    expect(rentRow.attributes('aria-current')).toBe('true');
    expect(rentRow.attributes('id')).toBe('obligation-occ-rent');
    expect(wrapper.get('[data-testid="obligation-linked"]').text()).toContain('Из уведомления');
    expect(
      wrapper.get('[data-testid="obligation-row-occ-daycare"]').attributes('aria-current'),
    ).toBeUndefined();
  });

  it('emits pay, skip and record-income with the original item', async () => {
    const wrapper = mountList();
    await wrapper.get('[data-testid="obligation-pay-occ-rent"]').trigger('click');
    expect(wrapper.emitted('pay')).toEqual([[rent]]);
    await wrapper.get('[data-testid="obligation-skip-occ-rent"]').trigger('click');
    expect(wrapper.emitted('skip')).toEqual([[rent]]);
    await wrapper.get('[data-testid="income-record-inc-occ"]').trigger('click');
    expect(wrapper.emitted('record-income')).toEqual([[salary]]);
  });

  it('hides skip for a partially paid obligation but keeps pay', () => {
    const partial = { ...rent, paidMinor: '100000', unpaidMinor: '3900000' };
    const wrapper = mountList({ items: [partial, salary], overdue: [] });
    expect(wrapper.find('[data-testid="obligation-skip-occ-rent"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="obligation-pay-occ-rent"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="obligation-row-occ-rent"]').text()).toContain('Остаток');
  });

  it('shows the forecast line only with an open income', () => {
    const forecast =
      'Это прогноз: пока деньги не пришли и вы не записали их как доход, они не входят в «На счетах» и не увеличивают «Можно потратить».';
    const withIncome = mountList();
    expect(withIncome.get('[data-testid="list-forecast"]').text().replace(/\s+/g, ' ')).toContain(
      forecast,
    );
    expect(withIncome.get('[data-testid="income-row-inc-occ"]').text()).toContain(
      'Прогноз — не входит в «На счетах»',
    );
    expect(withIncome.text()).not.toContain('не защищает текущие обязательства');
    const without = mountList({ items: [rent, done] });
    expect(without.find('[data-testid="list-forecast"]').exists()).toBe(false);
    const recorded = mountList({
      mode: 'all',
      items: [{ ...salary, status: 'COMPLETED' }],
      overdue: [],
    });
    expect(recorded.find('[data-testid="list-forecast"]').exists()).toBe(false);
    expect(recorded.get('[data-testid="income-row-inc-occ"]').text()).toContain('Записан');
  });

  it('shows onboarding empty state without any plans', async () => {
    const wrapper = mountList({ items: [], overdue: [], hasAnyPlans: false });
    const text = wrapper.text();
    expect(text).toContain('Обязательных платежей пока нет.');
    expect(text).toContain(
      'Добавьте аренду, коммунальные платежи, кредиты — «Можно потратить» учтёт их заранее.',
    );
    expect(text).toContain('Здесь будут ожидаемые поступления.');
    await wrapper.get('[data-testid="plan-add-obligation-empty"]').trigger('click');
    await wrapper.get('[data-testid="plan-add-income-empty"]').trigger('click');
    expect(wrapper.emitted('add-plan')).toEqual([['obligation'], ['income']]);
  });

  it('shows mode-specific empty text when plans exist', () => {
    const upcoming = mountList({ items: [done], overdue: [], hasAnyPlans: true });
    expect(upcoming.text()).toContain('Ближайших планов нет.');
    expect(upcoming.find('[data-testid="plan-add-obligation-empty"]').exists()).toBe(true);
    expect(upcoming.find('[data-testid="plan-add-income-empty"]').exists()).toBe(true);
    const all = mountList({ items: [], overdue: [], mode: 'all', hasAnyPlans: true });
    expect(all.text()).toContain('На этот месяц планов нет.');
    expect(all.find('[data-testid="plan-add-income-empty"]').exists()).toBe(true);
  });

  it('switches modes through an accessible tablist', async () => {
    const wrapper = mountList();
    const tablist = wrapper.get('[role="tablist"]');
    expect(tablist.attributes('aria-label')).toBe('Показать планы');
    expect(wrapper.get('[data-testid="list-mode-upcoming"]').attributes('aria-selected')).toBe(
      'true',
    );
    expect(wrapper.get('[data-testid="list-mode-all"]').attributes('aria-selected')).toBe('false');
    expect(wrapper.get('[data-testid="list-mode-upcoming"]').attributes('role')).toBe('tab');
    expect(wrapper.get('[data-testid="list-mode-upcoming"]').text()).toBe('Ближайшие');
    expect(wrapper.get('[data-testid="list-mode-all"]').text()).toBe('За месяц');
    await wrapper.get('[data-testid="list-mode-all"]').trigger('click');
    expect(wrapper.emitted('update:mode')).toEqual([['all']]);
    await wrapper.setProps({ mode: 'all' });
    expect(wrapper.get('[data-testid="list-mode-all"]').attributes('aria-selected')).toBe('true');
    expect(wrapper.get('[data-testid="list-mode-upcoming"]').attributes('aria-selected')).toBe(
      'false',
    );
  });

  it('is a focusable labelled section', () => {
    const root = mountList().get('[data-testid="plans-list"]');
    expect(root.element.tagName).toBe('SECTION');
    expect(root.attributes('tabindex')).toBe('-1');
    expect(root.attributes('aria-label')).toBe('Планы');
  });

  it('shows an edit button for every row regardless of status and emits edit-plan', async () => {
    const recorded = { ...salary, occurrenceId: 'inc-done', status: 'COMPLETED' };
    const wrapper = mountList({
      mode: 'all',
      items: [rent, salary, done, recorded],
      overdue: [],
    });
    for (const [id, name] of [
      ['obligation-edit-occ-rent', 'Аренда'],
      ['obligation-edit-occ-done', 'Интернет'],
      ['income-edit-inc-occ', 'Зарплата'],
      ['income-edit-inc-done', 'Зарплата'],
    ] as const) {
      expect(wrapper.get(`[data-testid="${id}"]`).attributes('aria-label')).toBe(
        `Изменить план ${name}`,
      );
    }
    expect(wrapper.find('[data-testid="obligation-pay-occ-done"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="income-record-inc-done"]').exists()).toBe(false);
    await wrapper.get('[data-testid="obligation-edit-occ-done"]').trigger('click');
    await wrapper.get('[data-testid="income-edit-inc-occ"]').trigger('click');
    expect(wrapper.emitted('edit-plan')).toEqual([[done], [salary]]);
  });

  it('shows an edit button for skipped and cancelled items and emits edit-plan', async () => {
    const skipped = { ...rent, occurrenceId: 'occ-skipped', status: 'SKIPPED' };
    const cancelled = { ...salary, occurrenceId: 'inc-cancelled', status: 'CANCELLED' };
    const wrapper = mountList({ mode: 'all', items: [skipped, cancelled], overdue: [] });
    await wrapper.get('[data-testid="obligation-edit-occ-skipped"]').trigger('click');
    await wrapper.get('[data-testid="income-edit-inc-cancelled"]').trigger('click');
    expect(wrapper.emitted('edit-plan')).toEqual([[skipped], [cancelled]]);
  });

  it('disables the edit buttons while busy', () => {
    const wrapper = mountList({ busy: true });
    for (const id of ['obligation-edit-occ-rent', 'income-edit-inc-occ']) {
      expect(wrapper.get(`[data-testid="${id}"]`).attributes('disabled')).toBeDefined();
    }
  });

  it('disables action buttons while busy', () => {
    const wrapper = mountList({ busy: true });
    for (const id of [
      'obligation-pay-occ-rent',
      'obligation-skip-occ-rent',
      'income-record-inc-occ',
    ]) {
      expect(wrapper.get(`[data-testid="${id}"]`).attributes('disabled')).toBeDefined();
    }
  });

  it('hides edit when canManage is false', () => {
    const wrapper = mountList({ canManage: false });

    expect(wrapper.find('[data-testid="obligation-edit-occ-rent"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="income-edit-inc-occ"]').exists()).toBe(false);
  });

  it('hides pay, skip and record-income when canWrite is false', () => {
    const wrapper = mountList({ canWrite: false });

    expect(wrapper.find('[data-testid="obligation-pay-occ-rent"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="obligation-skip-occ-rent"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="income-record-inc-occ"]').exists()).toBe(false);
  });
});
