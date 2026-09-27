import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The page watches shared dialog state; a wrapper left mounted would keep
// reacting to it from the next test.
enableAutoUnmount(afterEach);

const api = {
  getDashboardSummary: vi.fn(),
  listTransactions: vi.fn(),
  getAccountsSummary: vi.fn(),
  getEnvelopesSummary: vi.fn(),
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listEnvelopes: vi.fn(),
  initializeTemplate: vi.fn(),
  createEnvelopeReallocation: vi.fn(),
};
const auth = {
  currentData: {
    value: {
      user: { email: 'owner@example.test' },
      workspaces: [
        { name: 'Семья', budgets: [{ id: 'budget-id', name: 'Бюджет', primaryCurrency: 'RUB' }] },
      ],
    },
  },
  loadMe: vi.fn(),
  logout: vi.fn(),
};

vi.mock('#imports', () => ({ definePageMeta: vi.fn(), navigateTo: vi.fn() }));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));
vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));

import DashboardPage from './index.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';

function normalize(text: string): string {
  return text.replaceAll(' ', ' ');
}

const summary = {
  cycle: { start: '2026-08-10', end: '2026-09-09' },
  period: { id: 'FIRST', start: '2026-08-10', end: '2026-08-24' },
  totalAccountMoneyMinor: '100000',
  accounts: [{ id: 'account-id', name: 'Наличные', balanceMinor: '100000' }],
  envelopes: [{ id: 'envelope-id', name: 'Текущие', balanceMinor: '7500' }],
  unallocatedIncomeMinor: '0',
  unassignedStartingBalanceMinor: '0',
  periodLimit: {
    state: 'available',
    envelopeId: 'envelope-id',
    limitMinor: '10000',
    spentMinor: '2500',
    remainingMinor: '7500',
    daysUntilBoundary: 7,
    averageRemainingDailyLimitMinor: '1071',
  },
  warnings: [],
  previousPeriodLeftover: null,
  onboarding: {
    categoriesSeeded: false,
    cycleConfigured: false,
    hasAccounts: false,
    hasEnvelopeStartingBalances: false,
    hasAllocatedIncome: false,
  },
  upcomingObligations: [
    {
      occurrenceId: 'occurrence-id',
      planName: 'Ипотека',
      scheduledOn: '2026-09-10',
      amountMinor: '3600000',
      currency: 'RUB',
      scale: 2,
      status: 'DUE',
      envelopeId: 'envelope-id',
      actionPath: '/app/plans?occurrence=occurrence-id',
    },
  ],
};

const recentTransaction = {
  id: 'transaction-id',
  budgetId: 'budget-id',
  transactionType: 'EXPENSE',
  status: 'CONFIRMED',
  amountMinor: '150000',
  currency: 'RUB',
  scale: 2,
  occurredOn: '2026-09-14',
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: null,
  sourceDescription: null,
  merchantName: 'Супермаркет',
  isPlanned: false,
  comment: null,
  confirmedAt: null,
  cancelledAt: null,
  deletedAt: null,
  accountCurrentBalanceMinor: '0',
  envelopeCurrentBalanceMinor: null,
  unallocatedMinor: '0',
  allocationProposal: null,
};

describe('dashboard page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOperationReferenceData().invalidate();
    api.getDashboardSummary.mockResolvedValue(summary);
    api.listTransactions.mockResolvedValue({ items: [recentTransaction], nextCursor: null });
    api.getAccountsSummary.mockResolvedValue({
      currency: 'RUB',
      scale: 2,
      totalMinor: '100000',
      count: 1,
    });
    api.getEnvelopesSummary.mockResolvedValue({
      currency: 'RUB',
      scale: 2,
      totalMinor: '7500',
      count: 1,
      byType: [],
    });
    api.listAccounts.mockResolvedValue([
      {
        id: 'account-id',
        budgetId: 'budget-id',
        name: 'Наличные',
        accountType: 'BANK_CARD',
        bankName: null,
        lastFourDigits: '4801',
        currency: 'RUB',
        scale: 2,
        startingBalanceMinor: '0',
        currentBalanceMinor: '100000',
        accountingStartDate: '2026-01-01',
        comment: null,
        archivedAt: null,
      },
    ]);
    api.listCategories.mockResolvedValue([
      { id: 'category-id', name: 'Продукты', templateKey: 'expense-groceries' },
    ]);
    api.listEnvelopes.mockResolvedValue([
      {
        id: 'envelope-id',
        budgetId: 'budget-id',
        name: 'Текущие',
        envelopeType: 'MANDATORY_EXPENSES',
        periodSlot: 'FIRST',
        currency: 'RUB',
        scale: 2,
        startingBalanceMinor: '0',
        currentBalanceMinor: '7500',
        monthlyPlannedAmountMinor: null,
        targetAmountMinor: null,
        targetDate: null,
        displayOrder: 0,
        comment: null,
        archivedAt: null,
      },
    ]);
    api.initializeTemplate.mockResolvedValue({
      categoriesCreated: 0,
      envelopesCreated: 0,
      cycleConfigured: false,
    });
    useOperationDialogs().close();
  });

  it('renders server summary values and obligation navigation', async () => {
    const wrapper = mount(DashboardPage, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    await flushPromises();

    const text = wrapper.text().replaceAll(' ', ' ');
    expect(text).toContain('Можно потратить');
    expect(text).toContain('75,00 ₽');
    expect(text).toContain('Наличные');
    expect(text).toContain('Ипотека');
    expect(wrapper.get('a[href="/app/plans?occurrence=occurrence-id"]')).toBeTruthy();
  });

  it('shows account and envelope type details next to each balance row', async () => {
    const wrapper = mount(DashboardPage, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    await flushPromises();

    const text = normalize(wrapper.text());
    expect(text).toContain('Банковская карта · 4801');
    expect(text).toContain('Обязательные расходы · Первая половина');
  });

  it('shows retry after summary request error', async () => {
    api.getDashboardSummary.mockRejectedValueOnce(new Error('network'));
    const wrapper = mount(DashboardPage);
    await flushPromises();

    expect(wrapper.text()).toContain('Не удалось загрузить сводку бюджета.');
    await wrapper.get('[data-action="retry-summary"]').trigger('click');
    expect(api.getDashboardSummary).toHaveBeenCalledTimes(2);
  });

  it('orders the dashboard around the available amount', async () => {
    const wrapper = mount(DashboardPage, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    await flushPromises();

    const headings = wrapper.findAll('h2').map((heading) => heading.text());
    // First heading is the onboarding checklist (shown because not all steps are done)
    expect(headings[0]).toBe('Начало работы: 0/5');
    expect(headings.slice(1, 5)).toEqual(['Можно потратить', 'Обязательства', 'Счета', 'Конверты']);
    expect(headings[5]).toBe('Последние операции');
  });

  it('shows skeletons while the summary is loading', async () => {
    let resolveSummary: (value: typeof summary) => void = () => {};
    api.getDashboardSummary.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSummary = resolve;
      }),
    );

    const wrapper = mount(DashboardPage);
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="dashboard-loading"]').attributes('aria-busy')).toBe('true');
    expect(wrapper.findAll('[data-testid="skeleton-item"]').length).toBeGreaterThan(0);

    resolveSummary(summary);
    await flushPromises();

    expect(wrapper.find('[data-testid="dashboard-loading"]').exists()).toBe(false);
  });

  it('reloads the summary after a dialog closes', async () => {
    const wrapper = mount(DashboardPage, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    await flushPromises();
    expect(api.getDashboardSummary).toHaveBeenCalledTimes(1);

    const dialogs = useOperationDialogs();
    dialogs.openOperation();
    await wrapper.vm.$nextTick();
    dialogs.close();
    await flushPromises();

    expect(api.getDashboardSummary).toHaveBeenCalledTimes(2);
  });

  it('shows the latest operations and the balance totals', async () => {
    const wrapper = mount(DashboardPage, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    await flushPromises();

    expect(api.listTransactions).toHaveBeenCalledWith('budget-id', {
      limit: 5,
      sortBy: 'occurredOn',
      sortDirection: 'desc',
    });
    expect(wrapper.text()).toContain('Последние операции');
    expect(normalize(wrapper.text())).toContain('1 000,00 ₽');
    expect(normalize(wrapper.text())).toContain('75,00 ₽');
  });

  it('keeps the balance lists usable when a total fails to load', async () => {
    api.getAccountsSummary.mockRejectedValue(new Error('network'));
    const wrapper = mount(DashboardPage, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Счета');
    expect(wrapper.text()).not.toContain('Не удалось загрузить сводку');
  });

  it('keeps the rest of the dashboard usable when recent operations fail to load', async () => {
    api.listTransactions.mockRejectedValue(new Error('network'));
    const wrapper = mount(DashboardPage, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Можно потратить');
    expect(wrapper.text()).toContain('Операций пока нет.');
    expect(wrapper.text()).not.toContain('Не удалось загрузить сводку');
  });

  it('shows the period leftover prompt when the summary reports one', async () => {
    api.getDashboardSummary.mockResolvedValue({
      ...summary,
      previousPeriodLeftover: {
        envelopeId: 'previous-envelope-id',
        envelopeName: 'Текущие 10–24',
        balanceMinor: '350000',
        currentPeriodEnvelopeId: 'envelope-id',
        currentPeriodEnvelopeName: 'Текущие 25–9',
      },
    });
    api.listTransactions.mockResolvedValue({ items: [], nextCursor: null });
    api.getAccountsSummary.mockResolvedValue({ totalMinor: '0' });
    api.getEnvelopesSummary.mockResolvedValue({ totalMinor: '0' });

    const wrapper = mount(DashboardPage, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    await flushPromises();

    expect(wrapper.find('[data-testid="period-leftover-prompt"]').exists()).toBe(true);
  });
});
