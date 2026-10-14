import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The page watches shared dialog state; a wrapper left mounted would keep
// reacting to it from the next test.
enableAutoUnmount(afterEach);

const api = {
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
};
const auth = {
  currentData: {
    value: {
      user: { email: 'owner@example.test' },
      workspaces: [
        {
          name: 'Семья',
          budgets: [
            { id: 'budget-id', name: 'Бюджет', primaryCurrency: 'RUB', planModelVersion: 2 },
          ],
        },
      ],
    },
  },
  loadMe: vi.fn(),
  logout: vi.fn(),
};

vi.mock('#imports', () => ({ definePageMeta: vi.fn(), navigateTo: vi.fn() }));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));
const v2Api = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  listTransactions: vi.fn(),
  move: vi.fn(),
  listEnvelopes: vi.fn(),
  confirmPeriodTarget: vi.fn(),
  rejectPeriodTarget: vi.fn(),
}));
vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => v2Api }));
vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));

import { useFundingEntry } from '../../composables/useFundingEntry.js';
import DashboardPage from './index.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';

function normalize(text: string): string {
  return text.replaceAll(' ', ' ');
}

const recentTransaction = {
  id: 'transaction-id',
  budgetId: 'budget-id',
  accountingModelVersion: 2,
  transactionType: 'EXPENSE',
  status: 'CONFIRMED',
  amountMinor: '150000',
  currency: 'RUB',
  occurredOn: '2026-09-14',
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: null,
  sourceDescription: null,
  merchantName: 'Супермаркет',
  comment: null,
  planOccurrenceIds: [],
  confirmedAt: null,
  cancelledAt: null,
  deletedAt: null,
  createdAt: '2026-09-14T10:00:00.000Z',
};

describe('dashboard page', () => {
  const dashboardV2 = {
    planModelVersion: 2,
    period: { start: '2026-09-25', end: '2026-10-09', periodId: 'period-id' },
    cycle: { start: '2026-09-10', end: '2026-10-09' },
    asOf: '2026-10-04',
    horizonEnd: '2026-10-20',
    spendable: { state: 'READY', amountMinor: '5500000' },
    suggestedTarget: null,
    cashMinor: '10000000',
    currentBalanceMinor: '6500000',
    mandatoryBalanceMinor: '0',
    mandatoryDueMinor: '1000000',
    otherProtectedMinor: '0',
    freeToAssignMinor: '0',
    unbackedMinor: '0',
    mandatoryGapMinor: '1000000',
    mandatoryDueCurrentMinor: '800000',
    mandatoryDueNextMinor: '200000',
    mandatoryGapCurrentMinor: '800000',
    mandatoryGapNextMinor: '200000',
    dueMayBeIncomplete: false,
    nearestObligations: [
      { occurrenceId: 'occ-1', name: 'Ипотека', scheduledOn: '2026-10-26', unpaidMinor: '3597300' },
    ],
    periodStats: {
      spentMinor: '348297',
      availableMinor: '6848297',
      daysLeft: 6,
      averagePerDayMinor: '726396',
    },
    envelopes: [
      {
        id: 'env-1',
        name: 'Второй период',
        envelopeType: 'CURRENT_EXPENSES',
        periodSlot: 'SECOND',
        balanceMinor: '4358377',
      },
      {
        id: 'env-2',
        name: 'Ремонт',
        envelopeType: 'RESERVE',
        periodSlot: null,
        balanceMinor: '48941866',
      },
    ],
    envelopesTotalMinor: '53300243',
    upcoming: [],
    accounts: [{ id: 'account-id', name: 'Наличные', balanceMinor: '10000000' }],
    protectedAssignments: [],
    warnings: [
      {
        kind: 'COVERAGE',
        code: 'MANDATORY_GAP',
        message: 'Не хватает на обязательства 10 000,00 ₽.',
        amountMinor: '1000000',
        envelopeId: null,
        periodId: null,
        balanceMinor: null,
        actionPath: '/app/envelopes?cover=mandatory',
        level: 'ALERT',
      },
    ],
    onboarding: {
      categoriesSeeded: true,
      hasAccounts: true,
      needsOpeningAssignment: false,
      needsPeriodSetup: false,
      hasMandatoryPlans: true,
    },
  };
  const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

  beforeEach(() => {
    vi.clearAllMocks();
    useOperationReferenceData().invalidate();
    useOperationDialogs().close();
    v2Api.listTransactions.mockReset().mockResolvedValue({ items: [], nextCursor: null });
    api.listAccounts.mockResolvedValue([
      {
        id: 'account-id',
        name: 'Наличные',
        accountType: 'BANK_CARD',
        lastFourDigits: '4801',
        archivedAt: null,
      },
    ]);
    api.listCategories.mockResolvedValue([]);
    v2Api.listEnvelopes.mockResolvedValue({ items: [] });
    v2Api.getDashboard.mockReset().mockResolvedValue(dashboardV2);
  });

  it('shows the honest spendable number from the server dashboard', async () => {
    const wrapper = mount(DashboardPage, { global: { stubs } });
    await flushPromises();

    const text = normalize(wrapper.text());
    expect(text).toContain('Можно потратить');
    expect(text).toContain('55 000,00 ₽');
    expect(text).toContain('В конверте периода 65 000,00 ₽');
    expect(text).toContain('Не хватает на обязательные');
    expect(text).toContain('Покрыть обязательные');
    expect(wrapper.get('a[href="/app/envelopes?cover=mandatory"]')).toBeTruthy();
    expect(wrapper.get('a[href="/app/plans"]')).toBeTruthy();
    expect(v2Api.getDashboard).toHaveBeenCalledWith('budget-id');
    expect(normalize(text)).toContain('Банковская карта · 4801');
  });

  it('shows the financial month timeline from the server cycle and date', async () => {
    const wrapper = mount(DashboardPage, { global: { stubs } });
    await flushPromises();

    expect(wrapper.text()).toContain('Ваш финансовый месяц');
    expect(wrapper.get('.fm-timeline [role="img"]').attributes('aria-label')).toBe(
      'Финансовый месяц: с 10 сентября по 9 октября. Сегодня — день 25 из 30. Смена периода: 25 сент.',
    );
  });

  it('shows the nearest obligations, period figures and envelopes from the server', async () => {
    v2Api.getDashboard.mockResolvedValue({ ...dashboardV2, freeToAssignMinor: '5215531' });
    const wrapper = mount(DashboardPage, { global: { stubs } });
    await flushPromises();

    const text = normalize(wrapper.text());
    expect(text).toContain('Ипотека');
    expect(text).toContain('26 октября');
    expect(wrapper.get('a[href="/app/plans?occurrence=occ-1"]')).toBeTruthy();
    expect(text).toContain('В среднем в день');
    expect(text).toContain('Конверты');
    expect(text).toContain('Второй период');
    expect(text).toContain('Текущие расходы · Вторая половина');
    expect(text).toContain('Ремонт');
    expect(text).toContain('533 002,43 ₽');
    expect(normalize(wrapper.get('[data-testid="envelopes-unassigned"]').text())).toContain(
      'Не назначено 52 155,31 ₽',
    );
  });

  it('hides the unassigned row when no money is free', async () => {
    const wrapper = mount(DashboardPage, { global: { stubs } });
    await flushPromises();

    expect(wrapper.find('[data-testid="envelopes-unassigned"]').exists()).toBe(false);
  });

  it('reads the latest operations from the journal', async () => {
    v2Api.listTransactions.mockResolvedValue({ items: [recentTransaction], nextCursor: null });
    const wrapper = mount(DashboardPage, { global: { stubs } });
    await flushPromises();

    expect(v2Api.listTransactions).toHaveBeenCalledWith('budget-id', { limit: 5 });
    expect(wrapper.text()).toContain('Последние операции');
    expect(normalize(wrapper.text())).toContain('1 500,00 ₽');
    expect(wrapper.text()).toContain('Супермаркет');
  });

  it('keeps the rest of the dashboard usable when recent operations fail to load', async () => {
    v2Api.listTransactions.mockRejectedValue(new Error('network'));
    const wrapper = mount(DashboardPage, { global: { stubs } });
    await flushPromises();

    expect(wrapper.text()).toContain('Можно потратить');
    expect(wrapper.text()).toContain('Операций пока нет.');
    expect(wrapper.text()).not.toContain('Не удалось загрузить сводку');
  });

  it('invites to set up the period limit instead of showing zero', async () => {
    v2Api.getDashboard.mockResolvedValue({
      ...dashboardV2,
      spendable: { state: 'NEEDS_PERIOD_SETUP', amountMinor: null },
      mandatoryGapMinor: '0',
      warnings: [],
    });
    const wrapper = mount(DashboardPage, { global: { stubs } });
    await flushPromises();

    expect(wrapper.text()).toContain('Настройте лимит периода');
    expect(normalize(wrapper.text())).not.toMatch(/(^|[^\d,])0,00 ₽/);
  });

  const leftoverWarning = {
    kind: 'PERIOD',
    code: 'PERIOD_LEFTOVER',
    message: 'Остаток прошлого периода 10 000,00 ₽ ещё не передан.',
    amountMinor: '1000000',
    envelopeId: 'env-current',
    periodId: 'period-old',
    balanceMinor: '1000000',
    actionPath: '/app/envelopes?leftoverPeriod=period-old',
  };

  it('shows last period leftover as a decision, not added automatically', async () => {
    v2Api.getDashboard.mockResolvedValue({ ...dashboardV2, warnings: [leftoverWarning] });
    const wrapper = mount(DashboardPage, { global: { stubs } });
    await flushPromises();

    expect(wrapper.find('[data-testid="period-decision-card"]').exists()).toBe(true);
    expect(normalize(wrapper.text())).toContain('10 000,00 ₽');
    expect(v2Api.move).not.toHaveBeenCalled();
  });

  it('moves leftover only after confirmation and then rereads the dashboard', async () => {
    v2Api.getDashboard.mockResolvedValueOnce({ ...dashboardV2, warnings: [leftoverWarning] });
    v2Api.getDashboard.mockResolvedValue(dashboardV2);
    v2Api.move.mockResolvedValue({ movementId: 'm1' });
    const wrapper = mount(DashboardPage, { global: { stubs } });
    await flushPromises();
    const initialReads = v2Api.getDashboard.mock.calls.length;

    await wrapper.get('[data-testid="action-menu-trigger"]').trigger('click');
    await wrapper.get('[data-action="leftover-free"]').trigger('click');
    expect(v2Api.move).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="leftover-confirm"]').trigger('click');
    await flushPromises();

    expect(v2Api.move).toHaveBeenCalledTimes(1);
    expect(v2Api.getDashboard).toHaveBeenCalledTimes(initialReads + 1);
    expect(wrapper.find('[data-testid="period-decision-card"]').exists()).toBe(false);
  });

  it('offers no move for a negative previous period balance', async () => {
    v2Api.getDashboard.mockResolvedValue({
      ...dashboardV2,
      warnings: [
        {
          ...leftoverWarning,
          code: 'PERIOD_DEFICIT',
          balanceMinor: '-1000000',
          actionPath: '/app/envelopes?coverPeriod=period-old',
        },
      ],
    });
    const wrapper = mount(DashboardPage, { global: { stubs } });
    await flushPromises();

    expect(wrapper.find('[data-testid="period-decision-card"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Перенести');
    expect(wrapper.find('[data-testid="action-menu-trigger"]').exists()).toBe(false);
  });

  it('confirms the suggested period target only on explicit click', async () => {
    v2Api.getDashboard.mockResolvedValue({ ...dashboardV2, suggestedTarget: '5000000' });
    v2Api.confirmPeriodTarget.mockResolvedValue({ periodId: 'period-id' });
    const wrapper = mount(DashboardPage, { global: { stubs } });
    await flushPromises();

    expect(normalize(wrapper.text())).toContain('Предложенный план периода');
    expect(v2Api.confirmPeriodTarget).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="target-confirm"]').trigger('click');
    await flushPromises();
    expect(v2Api.confirmPeriodTarget).toHaveBeenCalledTimes(1);
    expect(v2Api.confirmPeriodTarget.mock.calls[0]![1]).toBe('period-id');
  });

  it('shows the period plan decision once, inside the onboarding step', async () => {
    v2Api.getDashboard.mockResolvedValue({
      ...dashboardV2,
      suggestedTarget: '5000000',
      onboarding: { ...dashboardV2.onboarding, needsPeriodSetup: true, hasMandatoryPlans: false },
    });
    v2Api.confirmPeriodTarget.mockResolvedValue({ periodId: 'period-id' });
    const wrapper = mount(DashboardPage, { global: { stubs } });
    await flushPromises();

    expect(wrapper.find('[data-testid="target-row"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="onboarding-target-confirm"]')).toHaveLength(1);
    const reads = v2Api.getDashboard.mock.calls.length;

    await wrapper.get('[data-testid="onboarding-target-confirm"]').trigger('click');
    await flushPromises();

    expect(v2Api.confirmPeriodTarget).toHaveBeenCalledTimes(1);
    expect(v2Api.confirmPeriodTarget.mock.calls[0]![1]).toBe('period-id');
    expect(v2Api.getDashboard.mock.calls.length).toBeGreaterThan(reads);
  });

  it('shows the plan decision in the period card once the checklist is collapsed', async () => {
    v2Api.getDashboard.mockResolvedValue({
      ...dashboardV2,
      suggestedTarget: '5000000',
      onboarding: { ...dashboardV2.onboarding, needsPeriodSetup: true, hasMandatoryPlans: false },
    });
    const wrapper = mount(DashboardPage, { global: { stubs } });
    await flushPromises();
    expect(wrapper.find('[data-testid="target-row"]').exists()).toBe(false);

    await wrapper.get('[data-action="onboarding-collapse"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="target-row"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="onboarding-target-confirm"]').exists()).toBe(false);
  });

  it('opens the free money assignment from the dashboard and refreshes after confirm', async () => {
    v2Api.getDashboard.mockResolvedValue({ ...dashboardV2, freeToAssignMinor: '5215531' });
    const wrapper = mount(DashboardPage, { global: { stubs } });
    await flushPromises();

    await wrapper.get('[data-action="assign-free-money"]').trigger('click');
    expect(useFundingEntry().request.value?.source).toEqual({ sourceKind: 'FREE' });

    const reads = v2Api.getDashboard.mock.calls.length;
    useFundingEntry().markConfirmed();
    await flushPromises();
    expect(v2Api.getDashboard.mock.calls.length).toBeGreaterThan(reads);
    useFundingEntry().dismiss();
  });

  it('shows retry after a dashboard request error', async () => {
    v2Api.getDashboard.mockRejectedValueOnce(new Error('network'));
    const wrapper = mount(DashboardPage, { global: { stubs } });
    await flushPromises();

    expect(wrapper.text()).toContain('Не удалось загрузить сводку бюджета.');
    const failedReads = v2Api.getDashboard.mock.calls.length;
    await wrapper.get('[data-action="retry-summary"]').trigger('click');
    await flushPromises();
    expect(v2Api.getDashboard.mock.calls.length).toBeGreaterThan(failedReads);
    expect(wrapper.text()).toContain('Можно потратить');
  });

  it('reloads the dashboard after an entry dialog closes', async () => {
    const wrapper = mount(DashboardPage, { global: { stubs } });
    await flushPromises();
    const initialReads = v2Api.getDashboard.mock.calls.length;

    const dialogs = useOperationDialogs();
    dialogs.openOperation();
    await wrapper.vm.$nextTick();
    dialogs.close();
    await flushPromises();

    expect(v2Api.getDashboard.mock.calls.length).toBeGreaterThan(initialReads);
  });

  it('shows no legacy leftover prompt or template button', async () => {
    const wrapper = mount(DashboardPage, { global: { stubs } });
    await flushPromises();

    expect(wrapper.find('[data-testid="period-leftover-prompt"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Создать базовый шаблон');
  });
});
