import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
};

describe('dashboard page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getDashboardSummary.mockResolvedValue(summary);
  });

  it('renders server summary values and budget navigation', async () => {
    const wrapper = mount(DashboardPage, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    await flushPromises();

    const text = wrapper.text().replaceAll(' ', ' ');
    expect(text).toContain('Остаток:75,00 ₽');
    expect(text).toContain('Наличные');
    expect(wrapper.get('a[href="/app/operations"]')).toBeTruthy();
  });

  it('shows retry after summary request error', async () => {
    api.getDashboardSummary.mockRejectedValueOnce(new Error('network'));
    const wrapper = mount(DashboardPage);
    await flushPromises();

    expect(wrapper.text()).toContain('Не удалось загрузить сводку бюджета.');
    await wrapper.get('[data-action="retry-summary"]').trigger('click');
    expect(api.getDashboardSummary).toHaveBeenCalledTimes(2);
  });
});
