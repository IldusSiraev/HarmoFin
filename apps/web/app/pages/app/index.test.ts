import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The page watches shared dialog state; a wrapper left mounted would keep
// reacting to it from the next test.
enableAutoUnmount(afterEach);

const api = { getDashboardSummary: vi.fn() };
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

const summary = {
  cycle: { start: '2026-08-10', end: '2026-09-09' },
  period: { id: 'FIRST', start: '2026-08-10', end: '2026-08-24' },
  totalAccountMoneyMinor: '100000',
  accounts: [{ id: 'account-id', name: 'Наличные', balanceMinor: '100000' }],
  envelopes: [{ id: 'envelope-id', name: 'Текущие', balanceMinor: '7500' }],
  unallocatedIncomeMinor: '0',
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

describe('dashboard page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getDashboardSummary.mockResolvedValue(summary);
    useOperationDialogs().close();
  });

  it('renders server summary values and obligation navigation', async () => {
    const wrapper = mount(DashboardPage, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    await flushPromises();

    const text = wrapper.text().replaceAll(' ', ' ');
    expect(text).toContain('Остаток:75,00 ₽');
    expect(text).toContain('Наличные');
    expect(text).toContain('Ипотека');
    expect(wrapper.get('a[href="/app/plans?occurrence=occurrence-id"]')).toBeTruthy();
  });

  it('shows retry after summary request error', async () => {
    api.getDashboardSummary.mockRejectedValueOnce(new Error('network'));
    const wrapper = mount(DashboardPage);
    await flushPromises();

    expect(wrapper.text()).toContain('Не удалось загрузить сводку бюджета.');
    await wrapper.get('[data-action="retry-summary"]').trigger('click');
    expect(api.getDashboardSummary).toHaveBeenCalledTimes(2);
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
});
