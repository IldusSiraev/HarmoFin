import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  getReport: vi.fn(),
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listEnvelopes: vi.fn(),
};
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
  useRoute: () => ({ query: {} }),
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

describe('analytics page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getReport.mockResolvedValue(report);
    api.listAccounts.mockResolvedValue([]);
    api.listCategories.mockResolvedValue([]);
    api.listEnvelopes.mockResolvedValue([]);
  });

  it('loads selected report and exposes report-to-journal link', async () => {
    const wrapper = mount(AnalyticsPage, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    await flushPromises();

    expect(api.getReport).toHaveBeenCalledWith('budget-id', 'expenses-by-category', {});
    expect(wrapper.get('[data-journal-link]').attributes('href')).toContain(
      'categoryId=category-id',
    );
  });
});
