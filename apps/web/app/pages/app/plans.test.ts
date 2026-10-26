import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../composables/useApiClient.js';

const api = {
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
};
const v2 = {
  getPlansCalendar: vi.fn(),
  listTransactions: vi.fn(),
  payObligation: vi.fn(),
  skipObligationOccurrence: vi.fn(),
  recordIncomeOccurrence: vi.fn(),
  createTransaction: vi.fn(),
  createObligationPlan: vi.fn(),
  createIncomePlan: vi.fn(),
  listObligationPlans: vi.fn(),
  listIncomePlans: vi.fn(),
  updateObligationPlan: vi.fn(),
  updateIncomePlan: vi.fn(),
};
const funding = { offer: vi.fn(), dismiss: vi.fn() };
const budgetRow = {
  id: 'budget-id',
  name: 'Бюджет',
  primaryCurrency: 'RUB',
  planModelVersion: 2,
};
const auth = {
  currentData: { value: { workspaces: [{ role: 'OWNER', budgets: [budgetRow] }] } },
  loadMe: vi.fn(),
};
const { route } = vi.hoisted(() => ({ route: { query: {} } }));

vi.mock('#imports', () => ({
  definePageMeta: vi.fn(),
  useRoute: () => route,
}));
vi.mock('../../composables/useEnvelopePlanV2.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useEnvelopePlanV2: () => v2,
}));
vi.mock('../../composables/useFundingEntry.js', () => ({ useFundingEntry: () => funding }));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));
vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));

import PlansPage from './plans.vue';

const toCalendarItem = (
  item: {
    id: string;
    planId: string;
    name: string;
    scheduledOn: string;
    status: string;
    expectedMinor: string;
    categoryId: string | null;
  },
  kind: 'OBLIGATION' | 'INCOME_PLAN',
  extra: {
    paidMinor?: string;
    unpaidMinor?: string;
    overdue?: boolean;
    transactionId?: string | null;
  } = {},
) => ({
  kind,
  occurrenceId: item.id,
  planId: item.planId,
  name: item.name,
  scheduledOn: item.scheduledOn,
  status: item.status,
  expectedMinor: item.expectedMinor,
  paidMinor: extra.paidMinor ?? '0',
  unpaidMinor: extra.unpaidMinor ?? (kind === 'OBLIGATION' ? item.expectedMinor : '0'),
  categoryId: item.categoryId,
  overdue: extra.overdue ?? false,
  transactionId: extra.transactionId ?? null,
});

function calendarOf(
  items: ReturnType<typeof toCalendarItem>[],
  overdue: ReturnType<typeof toCalendarItem>[] = [],
  totals = {
    plannedIncomeMinor: '0',
    plannedExpenseMinor: '0',
    balanceMinor: '0',
    activePlanCount: items.length,
  },
  month = '2026-09',
) {
  return {
    month,
    today: '2026-09-24',
    days: [],
    items,
    overdue,
    overdueCount: overdue.length,
    totals,
  };
}

describe('plans page', () => {
  let wrapper: ReturnType<typeof mountV2> | null = null;

  const daycare = {
    id: 'occ-daycare',
    planId: 'plan-daycare',
    name: 'Детский сад',
    scheduledOn: '2026-09-10',
    status: 'DUE' as const,
    expectedMinor: '300000',
    paidMinor: '0',
    unpaidMinor: '300000',
    categoryId: 'category-id',
    envelopeId: 'mandatory-envelope',
  };
  const rent = {
    ...daycare,
    id: 'occ-rent',
    planId: 'plan-rent',
    name: 'Аренда',
    scheduledOn: '2026-09-30',
    status: 'PENDING' as const,
    expectedMinor: '4000000',
    unpaidMinor: '4000000',
  };
  // Tomorrow relative to the pinned clock (2026-09-24).
  const salary = {
    id: 'inc-occ',
    planId: 'inc-plan',
    name: 'Зарплата',
    scheduledOn: '2026-09-25',
    status: 'PENDING',
    expectedMinor: '10000000',
    categoryId: 'income-cat',
    transactionId: null,
  };
  // The page hosts the skip confirm and PlanEditDialog hosts the stop confirm; tell them apart by title.
  const confirmStub = {
    UiConfirmDialog: {
      props: ['open', 'title'],
      emits: ['confirm', 'cancel'],
      template:
        "<div v-if=\"open\"><button :data-testid=\"title.startsWith('Остановить') ? 'confirm-stop' : 'confirm-yes'\" @click=\"$emit('confirm')\">Да</button></div>",
    },
  };
  const rentPlan = {
    id: 'plan-rent',
    planType: 'EXPENSE',
    name: 'Аренда',
    amountMinor: '4000000',
    recurrence: 'MONTHLY' as const,
    intervalMonths: null,
    scheduledOn: '2026-09-30',
    endOn: null,
    categoryId: 'category-id',
    comment: null,
    status: 'ACTIVE',
    envelopeId: 'mandatory-envelope',
  };
  const salaryPlan = {
    ...rentPlan,
    id: 'inc-plan',
    planType: 'INCOME',
    name: 'Зарплата',
    amountMinor: '10000000',
    categoryId: 'income-cat',
    envelopeId: null,
  };

  const overdueDaycare = () => toCalendarItem(daycare, 'OBLIGATION', { overdue: true });
  const defaultCalendar = () =>
    calendarOf(
      [toCalendarItem(rent, 'OBLIGATION'), toCalendarItem(salary, 'INCOME_PLAN')],
      [overdueDaycare()],
    );
  // Totals count active plans, never occurrences; two plans here.
  const withPlans = (
    items: ReturnType<typeof toCalendarItem>[],
    overdue: ReturnType<typeof toCalendarItem>[] = [],
  ) =>
    calendarOf(items, overdue, {
      plannedIncomeMinor: '0',
      plannedExpenseMinor: '0',
      balanceMinor: '0',
      activePlanCount: 2,
    });
  const emptyCalendar = () =>
    calendarOf([], [], {
      plannedIncomeMinor: '0',
      plannedExpenseMinor: '0',
      balanceMinor: '0',
      activePlanCount: 0,
    });

  function mountV2() {
    return mount(PlansPage, {
      attachTo: document.body,
      global: {
        stubs: {
          teleport: true,
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          ...confirmStub,
        },
      },
    });
  }

  async function openPay(id: string) {
    await wrapper!.get(`[data-testid="obligation-pay-${id}"]`).trigger('click');
    await flushPromises();
  }
  async function fillAndSubmit(amount: string, willPayMore = false) {
    await wrapper!.get('[data-testid="pay-amount"]').setValue(amount);
    await wrapper!.get('[data-testid="pill-accountId-account-id"]').trigger('click');
    if (willPayMore) await wrapper!.get('[data-testid="pay-will-pay-more"]').setValue(true);
    await wrapper!.get('[data-testid="pay-submit"]').trigger('click');
    await flushPromises();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
    route.query = {};
    v2.getPlansCalendar.mockResolvedValue(defaultCalendar());
    v2.listTransactions.mockResolvedValue({ items: [], nextCursor: null });
    v2.payObligation.mockResolvedValue({ transaction: null, occurrence: daycare, warnings: [] });
    v2.skipObligationOccurrence.mockResolvedValue({ transaction: null, occurrence: daycare });
    v2.createObligationPlan.mockResolvedValue({ id: 'plan-new' });
    v2.createIncomePlan.mockResolvedValue({ id: 'plan-new' });
    v2.listObligationPlans.mockResolvedValue({ items: [rentPlan] });
    v2.listIncomePlans.mockResolvedValue({ items: [salaryPlan] });
    v2.updateObligationPlan.mockResolvedValue({
      ...rentPlan,
      updatedOccurrences: 3,
      cancelledOccurrences: 2,
    });
    v2.updateIncomePlan.mockResolvedValue({
      ...salaryPlan,
      updatedOccurrences: 1,
      cancelledOccurrences: 1,
    });
    v2.recordIncomeOccurrence.mockResolvedValue({
      occurrence: { id: 'inc-occ', status: 'COMPLETED', transactionId: 'income-tx' },
      transaction: { id: 'income-tx', amountMinor: '8700000' },
    });
    api.listAccounts.mockResolvedValue([{ id: 'account-id', name: 'Карта' }]);
    api.listCategories.mockResolvedValue([
      { id: 'category-id', name: 'Детский сад', categoryType: 'EXPENSE', icon: null },
      { id: 'income-cat', name: 'Зарплата', categoryType: 'INCOME', icon: null },
    ]);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('lists open obligations with an overdue marker before payment and loads no legacy plan calendar', async () => {
    wrapper = mountV2();
    await flushPromises();

    expect(v2.getPlansCalendar).toHaveBeenCalledWith('budget-id', '2026-09');
    expect(wrapper.find('.plans-page__main').exists()).toBe(false);
    expect(wrapper.find('[data-action="create-plan"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="obligation-row-occ-daycare"]').text()).toContain(
      'Просрочено',
    );
    expect(wrapper.get('[data-testid="obligation-row-occ-rent"]').text()).not.toContain(
      'Просрочено',
    );
  });

  it('highlights and scrolls to the obligation named by ?occurrence= without any action', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    route.query = { occurrence: 'occ-rent' };
    wrapper = mountV2();
    await flushPromises();

    const row = wrapper.get('[data-testid="obligation-row-occ-rent"]');
    expect(row.attributes('aria-current')).toBe('true');
    expect(row.classes()).toContain('obligation-row--linked');
    expect(
      wrapper.get('[data-testid="obligation-row-occ-daycare"]').attributes('aria-current'),
    ).toBe(undefined);
    expect(row.get('[data-testid="obligation-linked"]').text()).toContain('Из уведомления');
    expect(wrapper.findAll('[data-testid="obligation-linked"]')).toHaveLength(1);
    expect(scroll).toHaveBeenCalled();
    expect(v2.payObligation).not.toHaveBeenCalled();
    expect(v2.skipObligationOccurrence).not.toHaveBeenCalled();
  });

  it('highlights an overdue obligation named by ?occurrence=', async () => {
    route.query = { occurrence: 'occ-daycare' };
    wrapper = mountV2();
    await flushPromises();

    expect(
      wrapper.get('[data-testid="obligation-row-occ-daycare"]').attributes('aria-current'),
    ).toBe('true');
    expect(wrapper.findAll('[data-testid="obligation-linked"]')).toHaveLength(1);
  });

  it('loads the calendar for the current month and renders the grid and four tiles', async () => {
    wrapper = mountV2();
    await flushPromises();

    expect(v2.getPlansCalendar).toHaveBeenCalledTimes(1);
    expect(v2.getPlansCalendar).toHaveBeenCalledWith('budget-id', '2026-09');
    expect(wrapper.find('[data-testid="calendar-day-2026-09-24"]').exists()).toBe(true);
    for (const tile of ['planned-income', 'planned-expense', 'balance', 'total-plans']) {
      expect(wrapper.find(`[data-testid="kpi-${tile}"]`).exists()).toBe(true);
    }
  });

  it('shows an overdue banner whose button switches the list to upcoming and focuses it', async () => {
    wrapper = mountV2();
    await flushPromises();

    const banner = wrapper.get('[data-testid="overdue-banner"]');
    expect(banner.text()).toContain('Просрочено: 1');
    await wrapper.get('[data-testid="list-mode-all"]').trigger('click');
    expect(wrapper.get('[data-testid="list-mode-all"]').attributes('aria-selected')).toBe('true');

    const show = banner.findAll('button').find((button) => button.text() === 'Показать');
    await show!.trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="list-mode-upcoming"]').attributes('aria-selected')).toBe(
      'true',
    );
    expect(document.activeElement).toBe(wrapper.get('[data-testid="plans-list"]').element);
  });

  it('shows no overdue banner when nothing is overdue', async () => {
    v2.getPlansCalendar.mockResolvedValue(withPlans([toCalendarItem(rent, 'OBLIGATION')]));
    wrapper = mountV2();
    await flushPromises();

    expect(wrapper.find('[data-testid="overdue-banner"]').exists()).toBe(false);
  });

  it('reads the confirmed facts of the clicked day and shows them in the panel', async () => {
    wrapper = mountV2();
    await flushPromises();
    v2.listTransactions.mockResolvedValue({
      items: [
        {
          id: 'tx-fact',
          budgetId: 'budget-id',
          accountingModelVersion: 2,
          transactionType: 'EXPENSE',
          status: 'CONFIRMED',
          amountMinor: '150000',
          currency: 'RUB',
          occurredOn: '2026-09-10',
          accountId: 'account-id',
          categoryId: 'category-id',
          envelopeId: null,
          sourceDescription: null,
          merchantName: 'Садик',
          comment: null,
          planOccurrenceIds: [],
          confirmedAt: null,
          cancelledAt: null,
          deletedAt: null,
          createdAt: '2026-09-10T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    });

    await wrapper.get('[data-testid="calendar-day-2026-09-10"]').trigger('click');
    await flushPromises();

    expect(v2.listTransactions).toHaveBeenLastCalledWith('budget-id', {
      from: '2026-09-10',
      to: '2026-09-10',
      status: 'CONFIRMED',
      limit: 50,
    });
    expect(wrapper.get('[data-testid="day-fact-tx-fact"]').text()).toContain('Садик');
  });

  it('opens the plan dialog with the date of the selected day', async () => {
    wrapper = mountV2();
    await flushPromises();
    await wrapper.get('[data-testid="calendar-day-2026-09-10"]').trigger('click');
    await flushPromises();

    await wrapper.get('[data-testid="plan-add-for-day"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="plan-tab-obligation"]').attributes('aria-selected')).toBe(
      'true',
    );
    const field = wrapper
      .get('[data-testid="plan-submit"]')
      .element.closest('form, [role="dialog"]');
    expect(field?.textContent).toContain('Ближайший платёж');
    const values = Array.from(document.querySelectorAll('input')).map((input) => input.value);
    expect(values).toContain('10.09.2026');
  });

  it('loads another month on navigation', async () => {
    wrapper = mountV2();
    await flushPromises();
    v2.getPlansCalendar.mockResolvedValue({
      ...calendarOf([], [], undefined, '2026-10'),
      totals: {
        plannedIncomeMinor: '0',
        plannedExpenseMinor: '0',
        balanceMinor: '0',
        activePlanCount: 2,
      },
    });

    await wrapper.get('[data-testid="calendar-next-month"]').trigger('click');
    await flushPromises();

    expect(v2.getPlansCalendar).toHaveBeenLastCalledWith('budget-id', '2026-10');
    expect(wrapper.find('[data-testid="calendar-day-2026-10-01"]').exists()).toBe(true);
  });

  it('drops a stale month response after a quick double click', async () => {
    wrapper = mountV2();
    await flushPromises();
    const totalsOf = (count: number) => ({
      plannedIncomeMinor: '0',
      plannedExpenseMinor: '0',
      balanceMinor: '0',
      activePlanCount: count,
    });
    let resolveStale: (value: unknown) => void = () => undefined;
    v2.getPlansCalendar
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockResolvedValueOnce(calendarOf([], [], totalsOf(222), '2026-11'));

    await wrapper.get('[data-testid="calendar-next-month"]').trigger('click');
    await wrapper.get('[data-testid="calendar-next-month"]').trigger('click');
    await flushPromises();
    resolveStale(calendarOf([], [], totalsOf(111), '2026-10'));
    await flushPromises();

    expect(v2.getPlansCalendar).toHaveBeenLastCalledWith('budget-id', '2026-11');
    const tile = wrapper.get('[data-testid="kpi-total-plans"]').text();
    expect(tile).toContain('222');
    expect(tile).not.toContain('111');
  });

  it('shows a calendar read error with a retry that rereads', async () => {
    v2.getPlansCalendar.mockRejectedValueOnce(new Error('boom'));
    wrapper = mountV2();
    await flushPromises();

    const alert = wrapper
      .findAll('[role="alert"]')
      .find((node) => node.text().includes('Не удалось загрузить календарь.'));
    expect(alert).toBeDefined();
    expect(v2.getPlansCalendar).toHaveBeenCalledTimes(1);

    await wrapper.get('[data-testid="calendar-retry"]').trigger('click');
    await flushPromises();

    expect(v2.getPlansCalendar).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).not.toContain('Не удалось загрузить календарь.');
  });

  it('restores the whole page when retry succeeds after a failed first read', async () => {
    route.query = { occurrence: 'occ-rent' };
    v2.getPlansCalendar.mockRejectedValueOnce(new Error('boom'));
    wrapper = mountV2();
    await flushPromises();

    // Only the calendar alert is shown, not the generic one.
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(1);
    expect(wrapper.text()).not.toContain('Не удалось загрузить планы');
    const factsCalls = v2.listTransactions.mock.calls.length;

    await wrapper.get('[data-testid="calendar-retry"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(v2.listTransactions.mock.calls.length).toBeGreaterThan(factsCalls);
    expect(v2.listTransactions).toHaveBeenLastCalledWith('budget-id', {
      from: '2026-09-24',
      to: '2026-09-24',
      status: 'CONFIRMED',
      limit: 50,
    });
    expect(wrapper.get('[data-testid="obligation-row-occ-rent"]').attributes('aria-current')).toBe(
      'true',
    );
    await openPay('occ-rent');
    expect(wrapper.find('[data-testid="pill-accountId-account-id"]').exists()).toBe(true);
  });

  it('moves focus to the list after a confirmed skip', async () => {
    wrapper = mountV2();
    await flushPromises();
    await wrapper.get('[data-testid="obligation-skip-occ-daycare"]').trigger('click');
    await wrapper.get('[data-testid="confirm-yes"]').trigger('click');
    await flushPromises();

    expect(document.activeElement).toBe(wrapper.get('[data-testid="plans-list"]').element);
  });

  it('shows the facts of the last selected day when an older response arrives late', async () => {
    wrapper = mountV2();
    await flushPromises();
    const fact = (id: string, merchantName: string) => ({
      id,
      budgetId: 'budget-id',
      accountingModelVersion: 2,
      transactionType: 'EXPENSE',
      status: 'CONFIRMED',
      amountMinor: '100',
      currency: 'RUB',
      occurredOn: '2026-09-10',
      accountId: 'account-id',
      categoryId: 'category-id',
      envelopeId: null,
      sourceDescription: null,
      merchantName,
      comment: null,
      planOccurrenceIds: [],
      confirmedAt: null,
      cancelledAt: null,
      deletedAt: null,
      createdAt: '2026-09-10T00:00:00.000Z',
    });
    let resolveA: (value: unknown) => void = () => undefined;
    v2.listTransactions
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve;
          }),
      )
      .mockResolvedValueOnce({ items: [fact('tx-b', 'Б')], nextCursor: null });

    await wrapper.get('[data-testid="calendar-day-2026-09-10"]').trigger('click');
    await wrapper.get('[data-testid="calendar-day-2026-09-11"]').trigger('click');
    await flushPromises();
    resolveA({ items: [fact('tx-a', 'А')], nextCursor: null });
    await flushPromises();

    expect(wrapper.find('[data-testid="day-fact-tx-b"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="day-fact-tx-a"]').exists()).toBe(false);
  });

  it('pays from the day panel through the same sheet, then rereads calendar and facts', async () => {
    wrapper = mountV2();
    await flushPromises();
    await wrapper.get('[data-testid="calendar-day-2026-09-30"]').trigger('click');
    await flushPromises();

    await wrapper.get('[data-testid="day-pay-occ-rent"]').trigger('click');
    await flushPromises();
    const factsCallsBeforePay = v2.listTransactions.mock.calls.length;
    await fillAndSubmit('40000.00');
    expect(v2.listTransactions.mock.calls.length).toBeGreaterThan(factsCallsBeforePay);

    expect(v2.payObligation).toHaveBeenCalledTimes(1);
    expect(v2.payObligation).toHaveBeenCalledWith(
      'budget-id',
      'occ-rent',
      expect.objectContaining({ amount: '40000.00' }),
      expect.any(String),
    );
    expect(v2.getPlansCalendar).toHaveBeenCalledTimes(2);
    expect(v2.listTransactions).toHaveBeenLastCalledWith('budget-id', {
      from: '2026-09-30',
      to: '2026-09-30',
      status: 'CONFIRMED',
      limit: 50,
    });
  });

  it('ignores an unknown ?occurrence= id', async () => {
    route.query = { occurrence: 'no-such-id' };
    wrapper = mountV2();
    await flushPromises();

    expect(wrapper.find('[aria-current="true"]').exists()).toBe(false);
  });

  it('pays the actual amount once, then rereads the server state', async () => {
    wrapper = mountV2();
    await flushPromises();
    v2.getPlansCalendar.mockResolvedValue(
      withPlans(
        [toCalendarItem(rent, 'OBLIGATION')],
        [
          toCalendarItem({ ...daycare, status: 'COMPLETED' }, 'OBLIGATION', {
            paidMinor: '200000',
            unpaidMinor: '100000',
            overdue: true,
          }),
        ],
      ),
    );

    await openPay('occ-daycare');
    await fillAndSubmit('2000.00');

    expect(v2.payObligation).toHaveBeenCalledTimes(1);
    expect(v2.payObligation).toHaveBeenCalledWith(
      'budget-id',
      'occ-daycare',
      expect.objectContaining({
        amount: '2000.00',
        willPayMore: false,
        accountId: 'account-id',
        categoryId: 'category-id',
      }),
      expect.any(String),
    );
    expect(v2.getPlansCalendar).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-testid="modal"]').exists()).toBe(false);
    expect(
      wrapper.get('[data-testid="obligation-row-occ-daycare"]').text().replace(/\s/g, ' '),
    ).toContain('1 000,00');
  });

  it('records a partial payment with willPayMore and leaves the occurrence open from the server', async () => {
    wrapper = mountV2();
    await flushPromises();
    v2.getPlansCalendar.mockResolvedValue(
      withPlans(
        [toCalendarItem(rent, 'OBLIGATION', { paidMinor: '3500000', unpaidMinor: '500000' })],
        [overdueDaycare()],
      ),
    );

    await openPay('occ-rent');
    await fillAndSubmit('35000.00', true);

    expect(v2.payObligation).toHaveBeenCalledTimes(1);
    expect(v2.payObligation).toHaveBeenCalledWith(
      'budget-id',
      'occ-rent',
      expect.objectContaining({ amount: '35000.00', willPayMore: true }),
      expect.any(String),
    );
    const row = wrapper.get('[data-testid="obligation-row-occ-rent"]');
    expect(row.find('[data-testid="obligation-pay-occ-rent"]').exists()).toBe(true);
    expect(row.text().replace(/\s/g, ' ')).toContain('5 000,00');
  });

  it('skips through the server action without creating a payment', async () => {
    wrapper = mountV2();
    await flushPromises();

    await wrapper.get('[data-testid="obligation-skip-occ-daycare"]').trigger('click');
    await wrapper.get('[data-testid="confirm-yes"]').trigger('click');
    await flushPromises();

    expect(v2.skipObligationOccurrence).toHaveBeenCalledWith(
      'budget-id',
      'occ-daycare',
      expect.any(String),
    );
    expect(v2.payObligation).not.toHaveBeenCalled();
  });

  it('protects against a double submit', async () => {
    v2.payObligation.mockReturnValue(new Promise(() => undefined));
    wrapper = mountV2();
    await flushPromises();

    await openPay('occ-daycare');
    await wrapper.get('[data-testid="pill-accountId-account-id"]').trigger('click');
    const submit = wrapper.get('[data-testid="pay-submit"]');
    await submit.trigger('click');
    await submit.trigger('click');

    expect(v2.payObligation).toHaveBeenCalledTimes(1);
  });

  it('reuses the key on retry of an unchanged attempt and shows a Russian server error', async () => {
    v2.payObligation
      .mockRejectedValueOnce(
        new ApiRequestError(409, { code: 'OCCURRENCE_NOT_OPEN', detail: 'raw english detail' }),
      )
      .mockResolvedValueOnce({ transaction: null, occurrence: daycare, warnings: [] });
    wrapper = mountV2();
    await flushPromises();

    await openPay('occ-daycare');
    await wrapper.get('[data-testid="pill-accountId-account-id"]').trigger('click');
    await wrapper.get('[data-testid="pay-submit"]').trigger('click');
    await flushPromises();

    const errorText = wrapper.get('[data-testid="pay-error"]').text();
    expect(errorText).toContain('уже закрыт');
    expect(errorText).not.toContain('raw english detail');

    await wrapper.get('[data-testid="pay-submit"]').trigger('click');
    await flushPromises();

    expect(v2.payObligation).toHaveBeenCalledTimes(2);
    expect(v2.payObligation.mock.calls[1]?.[3]).toBe(v2.payObligation.mock.calls[0]?.[3]);
  });

  it('labels icon-only row actions with the obligation name and shows Russian dates', async () => {
    wrapper = mountV2();
    await flushPromises();

    const pay = wrapper.get('[data-testid="obligation-pay-occ-daycare"]');
    expect(pay.attributes('aria-label')).toBe('Оплатить Детский сад');
    expect(pay.text()).toBe('');
    expect(
      wrapper.get('[data-testid="obligation-skip-occ-daycare"]').attributes('aria-label'),
    ).toBe('Пропустить Детский сад');
    const rowText = wrapper.get('[data-testid="obligation-row-occ-daycare"]').text();
    expect(rowText).toContain('10 сен');
    expect(rowText).not.toContain('2026-09-10');
  });

  it('focuses the amount field on open and returns focus to the row button on cancel and Escape', async () => {
    wrapper = mountV2();
    await flushPromises();
    const pay = wrapper.get('[data-testid="obligation-pay-occ-daycare"]');

    (pay.element as HTMLElement).focus();
    await pay.trigger('click');
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(document.activeElement?.id).toBe('obligation-pay-amount');

    await wrapper.get('[data-testid="pay-cancel"]').trigger('click');
    await flushPromises();
    expect(document.activeElement).toBe(pay.element);

    await pay.trigger('click');
    await flushPromises();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.find('[data-testid="modal"]').exists()).toBe(false);
    expect(document.activeElement).toBe(pay.element);
  });

  it('moves focus to the list after a successful payment', async () => {
    wrapper = mountV2();
    await flushPromises();
    await openPay('occ-daycare');
    await fillAndSubmit('3000.00');

    expect(document.activeElement).toBe(wrapper.get('[data-testid="plans-list"]').element);
  });

  it('sends one payment with a stable key and the date on a double submit', async () => {
    v2.payObligation.mockReturnValue(new Promise(() => undefined));
    wrapper = mountV2();
    await flushPromises();

    await openPay('occ-daycare');
    await wrapper.get('[data-testid="pill-accountId-account-id"]').trigger('click');
    const submit = wrapper.get('[data-testid="pay-submit"]');
    await submit.trigger('click');
    await submit.trigger('click');

    expect(v2.payObligation).toHaveBeenCalledTimes(1);
    expect(v2.payObligation.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ occurredOn: expect.stringMatching(/^2026-09-2[34]$/) }),
    );
    expect(v2.payObligation.mock.calls[0]?.[3]).toEqual(expect.any(String));
  });

  it('rereads obligations after a skip and explains a 409 in Russian', async () => {
    wrapper = mountV2();
    await flushPromises();
    await wrapper.get('[data-testid="obligation-skip-occ-daycare"]').trigger('click');
    await wrapper.get('[data-testid="confirm-yes"]').trigger('click');
    await flushPromises();
    expect(v2.getPlansCalendar).toHaveBeenCalledTimes(2);

    v2.skipObligationOccurrence.mockRejectedValueOnce(
      new ApiRequestError(409, { code: 'OCCURRENCE_HAS_PAYMENTS', detail: 'raw english detail' }),
    );
    await wrapper.get('[data-testid="obligation-skip-occ-rent"]').trigger('click');
    await wrapper.get('[data-testid="confirm-yes"]').trigger('click');
    await flushPromises();
    const alertText = wrapper.get('.plans-page__error').text();
    expect(alertText).toContain('уже есть оплаты');
    expect(alertText).not.toContain('raw english detail');
  });

  describe('expected income', () => {
    async function openRecord() {
      await wrapper!.get('[data-testid="income-record-inc-occ"]').trigger('click');
      await flushPromises();
    }

    it('shows tomorrow income as a forecast and creates nothing on load', async () => {
      wrapper = mountV2();
      await flushPromises();

      const row = wrapper.get('[data-testid="income-row-inc-occ"]');
      expect(row.text().replace(/\s/g, ' ')).toContain('100 000,00');
      expect(row.text()).toContain('Прогноз — не входит в «На счетах»');
      expect(wrapper.get('[data-testid="list-forecast"]').text()).toContain(
        'Это прогноз: пока деньги не пришли',
      );
      expect(v2.getPlansCalendar).toHaveBeenCalledTimes(1);
      expect(v2.recordIncomeOccurrence).not.toHaveBeenCalled();
      expect(v2.createTransaction).not.toHaveBeenCalled();
      expect(funding.offer).not.toHaveBeenCalled();
    });

    it('records the actual amount once, then offers funding for that income', async () => {
      wrapper = mountV2();
      await flushPromises();
      v2.getPlansCalendar.mockResolvedValue(
        withPlans([
          toCalendarItem({ ...salary, status: 'COMPLETED' }, 'INCOME_PLAN', {
            transactionId: 'income-tx',
          }),
        ]),
      );

      await openRecord();
      await wrapper.get('[data-testid="income-amount"]').setValue('87000.00');
      await wrapper.get('[data-testid="pill-accountId-account-id"]').trigger('click');
      await wrapper.get('[data-testid="income-submit"]').trigger('click');
      await flushPromises();

      expect(v2.recordIncomeOccurrence).toHaveBeenCalledTimes(1);
      expect(v2.recordIncomeOccurrence).toHaveBeenCalledWith(
        'budget-id',
        'inc-occ',
        expect.objectContaining({
          amount: '87000.00',
          accountId: 'account-id',
          categoryId: 'income-cat',
        }),
        expect.any(String),
      );
      expect(funding.offer).toHaveBeenCalledTimes(1);
      expect(funding.offer).toHaveBeenCalledWith({
        sourceKind: 'INCOME',
        incomeTransactionId: 'income-tx',
      });
      // No automatic assignment and no deletion: dismissing the offer leaves the income.
      expect(v2.createTransaction).not.toHaveBeenCalled();
      expect(wrapper.find('[data-testid="modal"]').exists()).toBe(false);
    });

    it('leaves the recorded income untouched when the funding offer is dismissed', async () => {
      wrapper = mountV2();
      await flushPromises();
      await openRecord();
      await wrapper.get('[data-testid="pill-accountId-account-id"]').trigger('click');
      await wrapper.get('[data-testid="income-submit"]').trigger('click');
      await flushPromises();

      funding.dismiss(); // «Позже»
      await flushPromises();

      const destructive = Object.keys(v2).filter((name) => /delete|cancel|revert/i.test(name));
      expect(destructive).toEqual([]);
      expect(v2.createTransaction).not.toHaveBeenCalled();
      expect(v2.payObligation).not.toHaveBeenCalled();
      expect(v2.skipObligationOccurrence).not.toHaveBeenCalled();
      expect(v2.recordIncomeOccurrence).toHaveBeenCalledTimes(1);
    });

    it('disables recording for a completed occurrence', async () => {
      v2.getPlansCalendar.mockResolvedValue(
        withPlans([
          toCalendarItem({ ...salary, status: 'COMPLETED' }, 'INCOME_PLAN', {
            transactionId: 'income-tx',
          }),
        ]),
      );
      wrapper = mountV2();
      await flushPromises();
      await wrapper.get('[data-testid="list-mode-all"]').trigger('click');

      const row = wrapper.get('[data-testid="income-row-inc-occ"]');
      expect(row.text()).toContain('Записан');
      expect(row.text()).not.toContain('Прогноз');
      const button = row.find('[data-testid="income-record-inc-occ"]');
      expect(!button.exists() || button.attributes('disabled') !== undefined).toBe(true);
    });

    it('sends one record call on a double submit', async () => {
      v2.recordIncomeOccurrence.mockReturnValue(new Promise(() => undefined));
      wrapper = mountV2();
      await flushPromises();

      await openRecord();
      await wrapper.get('[data-testid="pill-accountId-account-id"]').trigger('click');
      const submit = wrapper.get('[data-testid="income-submit"]');
      await submit.trigger('click');
      await submit.trigger('click');

      expect(v2.recordIncomeOccurrence).toHaveBeenCalledTimes(1);
      expect(v2.recordIncomeOccurrence.mock.calls[0]?.[2]).toEqual(
        expect.objectContaining({ amount: '100000.00' }),
      );
    });

    it('reuses the key on retry, changes it after an edit and shows Russian errors', async () => {
      v2.recordIncomeOccurrence
        .mockRejectedValueOnce(
          new ApiRequestError(409, { code: 'OCCURRENCE_NOT_OPEN', detail: 'raw english' }),
        )
        .mockRejectedValueOnce(
          new ApiRequestError(409, { code: 'OCCURRENCE_NOT_OPEN', detail: 'raw english' }),
        )
        .mockResolvedValue({
          occurrence: { id: 'inc-occ', status: 'COMPLETED', transactionId: 'income-tx' },
          transaction: { id: 'income-tx' },
        });
      wrapper = mountV2();
      await flushPromises();

      await openRecord();
      await wrapper.get('[data-testid="pill-accountId-account-id"]').trigger('click');
      await wrapper.get('[data-testid="income-submit"]').trigger('click');
      await flushPromises();
      expect(wrapper.get('[data-testid="income-error"]').text()).toContain('уже записан');
      expect(wrapper.get('[data-testid="income-error"]').text()).not.toContain('raw english');

      await wrapper.get('[data-testid="income-submit"]').trigger('click');
      await flushPromises();
      const calls = v2.recordIncomeOccurrence.mock.calls;
      expect(calls[1]?.[3]).toBe(calls[0]?.[3]);

      await wrapper.get('[data-testid="income-amount"]').setValue('90000.00');
      await wrapper.get('[data-testid="income-submit"]').trigger('click');
      await flushPromises();
      expect(v2.recordIncomeOccurrence.mock.calls[2]?.[3]).not.toBe(calls[0]?.[3]);
    });

    it('focuses the amount on open and returns focus to the row button on cancel', async () => {
      wrapper = mountV2();
      await flushPromises();
      const button = wrapper.get('[data-testid="income-record-inc-occ"]');

      (button.element as HTMLElement).focus();
      await button.trigger('click');
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(document.activeElement?.id).toBe('income-record-amount');

      await wrapper.get('[data-testid="income-cancel"]').trigger('click');
      await flushPromises();
      expect(document.activeElement).toBe(button.element);
    });
  });

  describe('plan creation', () => {
    async function openDialog(testId: string) {
      await wrapper!.get(`[data-testid="${testId}"]`).trigger('click');
      await flushPromises();
    }
    async function fillPlan(name: string, amount: string, pill: string) {
      await wrapper!.get('#operation-amount-input').setValue(amount);
      await wrapper!.get('#planName-input').setValue(name);
      await wrapper!.get(`[data-testid="pill-planCategory-${pill}"]`).trigger('click');
    }
    async function submitPlan() {
      await wrapper!.get('[data-testid="plan-submit"]').trigger('click');
      await flushPromises();
    }

    it('opens the dialog on the payment tab from the header button', async () => {
      wrapper = mountV2();
      await flushPromises();
      expect(wrapper.find('[data-testid="plan-submit"]').exists()).toBe(false);

      await openDialog('plan-add-obligation');
      expect(wrapper.get('[data-testid="plan-tab-obligation"]').attributes('aria-selected')).toBe(
        'true',
      );
    });

    it('shows the empty payments state with an add button', async () => {
      v2.getPlansCalendar.mockResolvedValue(emptyCalendar());
      wrapper = mountV2();
      await flushPromises();

      const list = wrapper.get('[data-testid="plans-list"]');
      expect(list.text()).toContain('Обязательных платежей пока нет.');
      expect(list.text()).toContain('«Можно потратить» учтёт их заранее');
      await openDialog('plan-add-obligation-empty');
      expect(wrapper.find('[data-testid="plan-submit"]').exists()).toBe(true);
    });

    it('shows the empty income state and opens the income tab', async () => {
      v2.getPlansCalendar.mockResolvedValue(emptyCalendar());
      wrapper = mountV2();
      await flushPromises();

      const income = wrapper.get('[data-testid="plans-list"]');
      expect(income.text()).toContain('Здесь будут ожидаемые поступления.');
      expect(income.text()).not.toContain('Это прогноз');
      await openDialog('plan-add-income-empty');
      expect(wrapper.get('[data-testid="plan-tab-income"]').attributes('aria-selected')).toBe(
        'true',
      );
    });

    it('shows the forecast line when planned income exists, never the old wording', async () => {
      wrapper = mountV2();
      await flushPromises();

      expect(wrapper.get('[data-testid="list-forecast"]').text()).toContain(
        'Это прогноз: пока деньги не пришли и вы не записали их как доход, они не входят в «На счетах» и не увеличивают «Можно потратить»',
      );
      expect(wrapper.text()).not.toContain('не защищает текущие обязательства');
    });

    it('creates an obligation plan, rereads lists, announces it and focuses the list', async () => {
      wrapper = mountV2();
      await flushPromises();
      await openDialog('plan-add-obligation');
      await fillPlan('Аренда', '45000,5', 'category-id');
      v2.getPlansCalendar.mockClear();
      await submitPlan();

      expect(v2.createObligationPlan).toHaveBeenCalledTimes(1);
      const [budgetId, request, key] = v2.createObligationPlan.mock.calls[0]!;
      expect(budgetId).toBe('budget-id');
      expect(request).toMatchObject({
        name: 'Аренда',
        amount: '45000.5',
        categoryId: 'category-id',
        recurrence: 'MONTHLY',
      });
      expect(typeof key).toBe('string');
      expect(v2.createIncomePlan).not.toHaveBeenCalled();
      expect(v2.getPlansCalendar).toHaveBeenCalledTimes(1);
      expect(v2.getPlansCalendar).toHaveBeenCalledWith('budget-id', '2026-09');
      expect(wrapper.find('[data-testid="plan-submit"]').exists()).toBe(false);
      expect(wrapper.get('[role="status"]').text()).toBe('Платёж «Аренда» добавлен.');
      expect(document.activeElement).toBe(wrapper.get('[data-testid="plans-list"]').element);
    });

    it('creates an income plan through createIncomePlan', async () => {
      v2.getPlansCalendar.mockResolvedValue(emptyCalendar());
      wrapper = mountV2();
      await flushPromises();
      await openDialog('plan-add-income-empty');
      await fillPlan('Зарплата', '100000', 'income-cat');
      await submitPlan();

      expect(v2.createIncomePlan).toHaveBeenCalledTimes(1);
      expect(v2.createObligationPlan).not.toHaveBeenCalled();
      expect(v2.createIncomePlan.mock.calls[0]?.[1]).toMatchObject({
        name: 'Зарплата',
        amount: '100000',
        categoryId: 'income-cat',
      });
      expect(wrapper.get('[role="status"]').text()).toBe('Доход «Зарплата» добавлен.');
      expect(document.activeElement).toBe(wrapper.get('[data-testid="plans-list"]').element);
    });

    it('reuses the key for an unchanged retry and issues a new one after an edit', async () => {
      v2.createObligationPlan.mockRejectedValue(
        new ApiRequestError(500, { code: 'INTERNAL', detail: 'x' }),
      );
      wrapper = mountV2();
      await flushPromises();
      await openDialog('plan-add-obligation');
      await fillPlan('Аренда', '100', 'category-id');
      await submitPlan();
      await submitPlan();
      const calls = v2.createObligationPlan.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[1]?.[2]).toBe(calls[0]?.[2]);

      await wrapper.get('#operation-amount-input').setValue('200');
      await submitPlan();
      expect(v2.createObligationPlan.mock.calls[2]?.[2]).not.toBe(calls[0]?.[2]);
    });

    it('keeps the dialog open with input and shows server errors', async () => {
      v2.createObligationPlan.mockRejectedValueOnce(
        new ApiRequestError(422, {
          code: 'VALIDATION_FAILED',
          detail: 'bad',
          fieldErrors: [{ field: 'name', message: 'Название занято', code: 'x' }],
        }),
      );
      wrapper = mountV2();
      await flushPromises();
      await openDialog('plan-add-obligation');
      await fillPlan('Аренда', '100', 'category-id');
      await submitPlan();

      expect(wrapper.find('[data-testid="plan-submit"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('Название занято');
      expect((wrapper.get('#planName-input').element as HTMLInputElement).value).toBe('Аренда');

      v2.createObligationPlan.mockRejectedValueOnce(
        new ApiRequestError(500, { code: 'INTERNAL', detail: 'raw english' }),
      );
      await submitPlan();
      expect(wrapper.text()).toContain('Не удалось сохранить план. Попробуйте ещё раз.');
      expect(wrapper.text()).not.toContain('raw english');
    });
  });

  describe('plan edit', () => {
    const input = (selector: string) => wrapper!.get(selector).element as HTMLInputElement;
    async function openEdit(testId: string) {
      await wrapper!.get(`[data-testid="${testId}"]`).trigger('click');
      await flushPromises();
    }
    async function mountReady() {
      wrapper = mountV2();
      await flushPromises();
    }
    async function save() {
      await wrapper!.get('[data-testid="plan-edit-submit"]').trigger('click');
      await flushPromises();
    }

    it('reads both plan lists on load and shows the catalog count', async () => {
      await mountReady();

      expect(v2.listObligationPlans).toHaveBeenCalledWith('budget-id', 'all');
      expect(v2.listIncomePlans).toHaveBeenCalledWith('budget-id', 'all');
      expect(wrapper!.get('[data-testid="plan-catalog"]').text()).toContain('Все планы (2)');
    });

    it('opens the dialog from the list rows and the day panel', async () => {
      await mountReady();

      await openEdit('obligation-edit-occ-rent');
      expect(input('#planEditName-input').value).toBe('Аренда');
      expect(input('#operation-amount-input').value).toBe('40000.00');

      await mountReadyAgain();
      await openEdit('income-edit-inc-occ');
      expect(input('#planEditName-input').value).toBe('Зарплата');

      await mountReadyAgain();
      await wrapper!.get('[data-testid="calendar-day-2026-09-30"]').trigger('click');
      await flushPromises();
      await openEdit('day-edit-occ-rent');
      expect(input('#planEditName-input').value).toBe('Аренда');
    });

    async function mountReadyAgain() {
      wrapper!.unmount();
      document.body.innerHTML = '';
      await mountReady();
    }

    it('shows an alert and no dialog when the plan is missing from the lists', async () => {
      v2.listObligationPlans.mockResolvedValue({ items: [] });
      await mountReady();
      await openEdit('obligation-edit-occ-rent');

      const alert = wrapper!
        .findAll('[role="alert"]')
        .find((node) => node.text() === 'План не найден. Обновите страницу.');
      expect(alert).toBeDefined();
      expect(wrapper!.find('[data-testid="plan-edit-submit"]').exists()).toBe(false);

      await openEdit('income-edit-inc-occ');
      expect(wrapper!.find('[data-testid="plan-edit-submit"]').exists()).toBe(true);
      expect(wrapper!.text()).not.toContain('План не найден. Обновите страницу.');
    });

    it('saves a new amount with the current-open flag for an obligation and an income', async () => {
      await mountReady();
      await openEdit('obligation-edit-occ-rent');
      await wrapper!.get('#operation-amount-input').setValue('50000');
      await wrapper!.get('[data-testid="plan-edit-apply-current"]').setValue(true);
      await save();

      expect(v2.updateObligationPlan).toHaveBeenCalledWith(
        'budget-id',
        'plan-rent',
        { amount: '50000.00', applyToCurrentOpen: true },
        expect.any(String),
      );

      await openEdit('income-edit-inc-occ');
      await wrapper!.get('#operation-amount-input').setValue('120000');
      await save();
      expect(v2.updateIncomePlan).toHaveBeenCalledWith(
        'budget-id',
        'inc-plan',
        { amount: '120000.00' },
        expect.any(String),
      );
    });

    it('closes, rereads lists, announces the count and focuses the list on success', async () => {
      await mountReady();
      await openEdit('obligation-edit-occ-rent');
      await wrapper!.get('#operation-amount-input').setValue('50000');
      const before = {
        calendar: v2.getPlansCalendar.mock.calls.length,
        obligations: v2.listObligationPlans.mock.calls.length,
        incomes: v2.listIncomePlans.mock.calls.length,
        facts: v2.listTransactions.mock.calls.length,
      };
      await save();

      expect(wrapper!.find('[data-testid="plan-edit-submit"]').exists()).toBe(false);
      expect(v2.getPlansCalendar.mock.calls.length).toBeGreaterThan(before.calendar);
      expect(v2.listObligationPlans.mock.calls.length).toBeGreaterThan(before.obligations);
      expect(v2.listIncomePlans.mock.calls.length).toBeGreaterThan(before.incomes);
      expect(v2.listTransactions.mock.calls.length).toBeGreaterThan(before.facts);
      expect(wrapper!.get('[role="status"]').text()).toBe(
        'План «Аренда» обновлён. Изменено платежей: 3.',
      );
      expect(document.activeElement).toBe(wrapper!.get('[data-testid="plans-list"]').element);
    });

    it('announces a name-only edit without a counter', async () => {
      await mountReady();
      await openEdit('obligation-edit-occ-rent');
      await wrapper!.get('#planEditName-input').setValue('Квартира');
      await save();

      expect(v2.updateObligationPlan.mock.calls[0]?.[2]).toEqual({ name: 'Квартира' });
      expect(wrapper!.get('[role="status"]').text()).toBe('План «Квартира» обновлён.');
    });

    it('reuses the key for an unchanged retry and issues a new one after an edit', async () => {
      v2.updateObligationPlan.mockRejectedValue(
        new ApiRequestError(500, { code: 'INTERNAL', detail: 'x' }),
      );
      await mountReady();
      await openEdit('obligation-edit-occ-rent');
      await wrapper!.get('#operation-amount-input').setValue('50000');
      await save();
      await save();
      const calls = v2.updateObligationPlan.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[1]?.[3]).toBe(calls[0]?.[3]);

      await wrapper!.get('#operation-amount-input').setValue('60000');
      await save();
      expect(v2.updateObligationPlan.mock.calls[2]?.[3]).not.toBe(calls[0]?.[3]);
    });

    it('keeps the dialog open with field errors and a Russian general error', async () => {
      v2.updateObligationPlan.mockRejectedValueOnce(
        new ApiRequestError(400, {
          code: 'VALIDATION_FAILED',
          detail: 'bad',
          fieldErrors: [{ field: 'name', message: 'Название занято', code: 'x' }],
        }),
      );
      await mountReady();
      await openEdit('obligation-edit-occ-rent');
      await wrapper!.get('#planEditName-input').setValue('Квартира');
      await save();

      expect(wrapper!.find('[data-testid="plan-edit-submit"]').exists()).toBe(true);
      expect(wrapper!.text()).toContain('Название занято');
      expect(input('#planEditName-input').value).toBe('Квартира');

      v2.updateObligationPlan.mockRejectedValueOnce(
        new ApiRequestError(500, { code: 'INTERNAL', detail: 'raw english' }),
      );
      await save();
      expect(wrapper!.text()).toContain('Не удалось сохранить план. Попробуйте ещё раз.');
      expect(wrapper!.text()).not.toContain('raw english');
    });

    it('stops a plan after confirmation and reports cancelled payments', async () => {
      await mountReady();
      await openEdit('obligation-edit-occ-rent');
      await openEdit('plan-edit-stop');
      expect(v2.updateObligationPlan).not.toHaveBeenCalled();
      await openEdit('confirm-stop');

      expect(v2.updateObligationPlan).toHaveBeenCalledWith(
        'budget-id',
        'plan-rent',
        { status: 'ARCHIVED' },
        expect.any(String),
      );
      expect(wrapper!.get('[role="status"]').text()).toBe(
        'План «Аренда» остановлен. Отменено платежей: 2.',
      );
    });

    it('resumes a stopped plan from the catalog and shows a resume error on the page', async () => {
      v2.listObligationPlans.mockResolvedValue({
        items: [{ ...rentPlan, status: 'ARCHIVED' }],
      });
      v2.updateObligationPlan.mockRejectedValueOnce(
        new ApiRequestError(500, { code: 'INTERNAL', detail: 'raw english' }),
      );
      await mountReady();

      await openEdit('catalog-resume-plan-rent');
      const alert = wrapper!.get('.plans-page__error');
      expect(alert.text()).toBe('Не удалось сохранить план. Попробуйте ещё раз.');
      expect(wrapper!.get('[data-testid="plan-catalog"]').text()).not.toContain('raw english');

      await openEdit('catalog-resume-plan-rent');
      expect(v2.updateObligationPlan).toHaveBeenLastCalledWith(
        'budget-id',
        'plan-rent',
        { status: 'ACTIVE' },
        expect.any(String),
      );
      expect(wrapper!.get('[role="status"]').text()).toBe('План «Аренда» возобновлён.');
      expect(wrapper!.find('.plans-page__error').exists()).toBe(false);
    });

    it('keeps the page usable when the plan lists fail to load', async () => {
      v2.listObligationPlans.mockRejectedValue(new Error('boom'));
      await mountReady();

      expect(wrapper!.find('[data-testid="obligation-row-occ-rent"]').exists()).toBe(true);
      expect(wrapper!.find('[data-testid="calendar-day-2026-09-24"]').exists()).toBe(true);
      expect(wrapper!.find('[data-testid="catalog-error"]').exists()).toBe(true);
      expect(wrapper!.find('.plans-page__error').exists()).toBe(false);
    });
  });

  describe('permissions by role', () => {
    function setRole(role: 'OWNER' | 'EDITOR' | 'VIEWER') {
      (auth.currentData.value.workspaces[0] as { role: string }).role = role;
    }

    it('viewer: no plan creation, editing or catalog management', async () => {
      setRole('VIEWER');
      wrapper = mountV2();
      await flushPromises();

      expect(wrapper.find('[data-testid="plan-add-obligation"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="obligation-edit-occ-rent"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="catalog-edit-plan-rent"]').exists()).toBe(false);
    });

    it('viewer: no pay, skip or record-income on open obligations/income', async () => {
      setRole('VIEWER');
      wrapper = mountV2();
      await flushPromises();

      expect(wrapper.find('[data-testid="obligation-pay-occ-rent"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="obligation-skip-occ-rent"]').exists()).toBe(false);
    });

    it('editor: plan management stays hidden, but recording stays available', async () => {
      setRole('EDITOR');
      wrapper = mountV2();
      await flushPromises();

      expect(wrapper.find('[data-testid="plan-add-obligation"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="obligation-edit-occ-rent"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="obligation-pay-occ-rent"]').exists()).toBe(true);
    });
  });
});
