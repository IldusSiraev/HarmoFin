import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  getReport: vi.fn(),
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listEnvelopes: vi.fn(),
};
const route = { query: {} as Record<string, string> };
const auth = {
  currentData: {
    value: {
      workspaces: [{ budgets: [{ id: 'budget-id', name: 'Бюджет', primaryCurrency: 'RUB' }] }],
    },
  },
  loadMe: vi.fn(),
};

vi.mock('#imports', () => ({
  definePageMeta: vi.fn(),
  navigateTo: vi.fn(),
  useRoute: () => route,
}));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));
vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));

import AnalyticsPage from './analytics.vue';

const report = {
  key: 'expenses-by-category',
  rows: [
    {
      categoryName: 'Продукты',
      expenseMinor: '2500',
      journalFilters: { categoryId: 'category-id', type: 'EXPENSE' },
    },
  ],
};

const planVsActualReport = {
  key: 'plan-vs-actual',
  rows: [
    {
      planId: 'plan-id',
      planName: 'Ипотека',
      planType: 'EXPENSE',
      plannedMinor: '300000',
      actualMinor: '170000',
      varianceMinor: '-130000',
      plannedOccurrenceCount: 2,
      confirmedOccurrenceCount: 1,
      journalFilters: { planId: 'plan-id', status: 'CONFIRMED' },
    },
  ],
};

const global = {
  stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
};

describe('analytics page', () => {
  beforeEach(() => {
    route.query = {};
    vi.clearAllMocks();
    api.getReport.mockResolvedValue(report);
    api.listAccounts.mockResolvedValue([]);
    api.listCategories.mockResolvedValue([]);
    api.listEnvelopes.mockResolvedValue([]);
  });

  it('loads selected report and exposes report-to-journal link', async () => {
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();

    expect(api.getReport).toHaveBeenCalledWith('budget-id', 'expenses-by-category', {});
    expect(wrapper.get('[data-journal-link]').attributes('href')).toContain(
      'categoryId=category-id',
    );
  });

  it('loads selected typed plan/fact report from URL', async () => {
    route.query = { report: 'plan-vs-actual' };
    api.getReport.mockResolvedValue(planVsActualReport);
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();

    expect(api.getReport).toHaveBeenCalledWith('budget-id', 'plan-vs-actual', {});
    expect(wrapper.text()).toContain('Ипотека');
    expect(wrapper.get('[data-journal-link]').attributes('href')).toContain('planId=plan-id');
  });
});
