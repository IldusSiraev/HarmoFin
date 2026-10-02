import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  getReport: vi.fn(),
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listEnvelopes: vi.fn(),
  downloadTransactionsCsv: vi.fn(),
};
const v2 = {
  getReport: vi.fn(),
  listEnvelopes: vi.fn(),
  exportTransactions: vi.fn(),
  exportAssignments: vi.fn(),
  exportLegacyAssignments: vi.fn(),
  getLegacyAssignmentHistory: vi.fn(),
};
const route = { query: {} as Record<string, string> };
const budgetRow: { id: string; name: string; primaryCurrency: string; planModelVersion?: 1 | 2 } = {
  id: 'budget-id',
  name: 'Бюджет',
  primaryCurrency: 'RUB',
};
const workspaceRow = { role: 'OWNER', budgets: [budgetRow] };
const auth = {
  currentData: { value: { workspaces: [workspaceRow] } },
  loadMe: vi.fn(),
};

vi.mock('#imports', () => ({
  definePageMeta: vi.fn(),
  navigateTo: vi.fn(),
  useRoute: () => route,
}));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));
vi.mock('../../composables/useEnvelopePlanV2.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useEnvelopePlanV2: () => v2,
}));
vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));

import { ApiRequestError } from '../../composables/useApiClient.js';
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
    delete budgetRow.planModelVersion;
    workspaceRow.role = 'OWNER';
    v2.getReport.mockResolvedValue({ key: 'expenses-by-category', rows: [] });
    v2.listEnvelopes.mockResolvedValue({ items: [] });
    v2.getLegacyAssignmentHistory.mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
    api.getReport.mockResolvedValue(report);
    api.listAccounts.mockResolvedValue([]);
    api.listCategories.mockResolvedValue([]);
    api.listEnvelopes.mockResolvedValue([]);
  });

  it('falls back from assignment-movements on a v1 budget', async () => {
    route.query = { report: 'assignment-movements' };
    mount(AnalyticsPage, { global });
    await flushPromises();

    expect(api.getReport).toHaveBeenCalledWith('budget-id', 'expenses-by-category', {});
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

  describe('model v2', () => {
    const flat = (text: string) => text.replace(/\s/g, ' ');
    const goal = {
      envelopeId: 'goal-id',
      name: 'Отпуск',
      envelopeType: 'SAVINGS_GOAL',
      currentMinor: '1234500',
      targetMinor: '5000000',
      targetDate: null,
      assignedMinor: '1500000',
      movedNetMinor: '0',
      spentMinor: '265500',
      remainingMinor: '3765500',
      progressPermille: 247,
      isReached: false,
      daysRemaining: null,
    };

    beforeEach(() => {
      budgetRow.planModelVersion = 2;
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    });

    it('reads the v2 report and never calls v1 reports or envelope balances', async () => {
      const wrapper = mount(AnalyticsPage, { global });
      await flushPromises();

      expect(v2.getReport).toHaveBeenCalledWith('budget-id', 'expenses-by-category', {});
      expect(api.getReport).not.toHaveBeenCalled();
      expect(api.listEnvelopes).not.toHaveBeenCalled();
      expect(wrapper.text()).not.toContain('Баланс конверта');
      expect(wrapper.text()).not.toContain('Остатки конвертов');
    });

    it('shows the assigned continuous savings balance from the DTO', async () => {
      route.query = { report: 'savings-goals' };
      v2.getReport.mockResolvedValue({ key: 'savings-goals', rows: [goal] });
      const wrapper = mount(AnalyticsPage, { global });
      await flushPromises();

      const text = flat(wrapper.text());
      expect(v2.getReport).toHaveBeenCalledWith('budget-id', 'savings-goals', {});
      expect(text).toContain('Отпуск');
      expect(text).toContain('Назначено');
      expect(text).toContain('12 345,00');
      expect(wrapper.find('progress').attributes('value')).toBe('247');
    });

    it('offers owner CSV downloads through v2 methods only', async () => {
      v2.exportTransactions.mockResolvedValue(new Blob(['a']));
      v2.exportAssignments.mockResolvedValue(new Blob(['b']));
      const wrapper = mount(AnalyticsPage, { global });
      await flushPromises();

      await wrapper.get('[data-action="export-transactions"]').trigger('click');
      await flushPromises();
      await wrapper.get('[data-action="export-assignments"]').trigger('click');
      await flushPromises();

      expect(v2.exportTransactions).toHaveBeenCalledWith('budget-id');
      expect(v2.exportAssignments).toHaveBeenCalledWith('budget-id');
      expect(wrapper.text()).toContain('Скачать операции (CSV)');
      expect(wrapper.text()).toContain('Скачать назначения (CSV)');
    });

    it('hides exports from non-owners and explains why', async () => {
      workspaceRow.role = 'VIEWER';
      const wrapper = mount(AnalyticsPage, { global });
      await flushPromises();

      expect(wrapper.find('[data-action="export-transactions"]').exists()).toBe(false);
      expect(wrapper.find('[data-action="export-legacy-assignments"]').exists()).toBe(false);
      expect(wrapper.text()).toContain('Экспорт доступен только владельцу бюджета');
    });

    it('explains EXPORT_LIMIT_EXCEEDED in Russian', async () => {
      v2.exportTransactions.mockRejectedValue(
        new ApiRequestError(422, { code: 'EXPORT_LIMIT_EXCEEDED', detail: 'too many' } as never),
      );
      const wrapper = mount(AnalyticsPage, { global });
      await flushPromises();

      await wrapper.get('[data-action="export-transactions"]').trigger('click');
      await flushPromises();

      expect(flat(wrapper.get('[data-testid="export-error"]').text())).toContain('10 000');
    });

    it('shows the legacy archive as historical data with a cursor and its own CSV', async () => {
      v2.getLegacyAssignmentHistory
        .mockResolvedValueOnce({
          items: [
            {
              sourceKind: 'LEGACY_ALLOCATION',
              id: 'legacy-1',
              occurredOn: '2026-01-10',
              amountMinor: '100000',
              status: 'CONFIRMED',
              isDeleted: false,
              isEnvelopeArchived: false,
              envelopeId: null,
              sourceEnvelopeId: null,
              destinationEnvelopeId: null,
              incomeTransactionId: null,
              categoryId: null,
              accountId: null,
            },
          ],
          nextCursor: 'cursor-2',
          hasMore: true,
        })
        .mockResolvedValueOnce({ items: [], nextCursor: null, hasMore: false });
      v2.exportLegacyAssignments.mockResolvedValue(new Blob(['c']));
      const wrapper = mount(AnalyticsPage, { global });
      await flushPromises();

      expect(wrapper.text()).toContain('Исторические назначения (до модели v2)');
      expect(wrapper.text()).toContain('исторические данные, не средства модели v2');
      expect(flat(wrapper.text())).toContain('1 000,00');
      await wrapper.get('[data-action="legacy-more"]').trigger('click');
      await flushPromises();
      expect(v2.getLegacyAssignmentHistory).toHaveBeenLastCalledWith('budget-id', {
        cursor: 'cursor-2',
      });
      await wrapper.get('[data-action="export-legacy-assignments"]').trigger('click');
      await flushPromises();
      expect(v2.exportLegacyAssignments).toHaveBeenCalledWith('budget-id');
    });

    it('offers exactly the nine v2 report keys', async () => {
      const wrapper = mount(AnalyticsPage, { global });
      await flushPromises();

      const values = wrapper.findAll('select option').map((option) => option.attributes('value'));
      expect(values).toEqual([
        'expenses-by-category',
        'expenses-by-period',
        'expenses-by-cycle',
        'incomes-by-cycle',
        'net-cash-flow',
        'account-balances',
        'savings-goals',
        'plan-vs-actual',
        'assignment-movements',
      ]);
    });

    it('does not call exports or the archive for a non-owner', async () => {
      workspaceRow.role = 'VIEWER';
      const wrapper = mount(AnalyticsPage, { global });
      await flushPromises();

      expect(wrapper.find('[data-action="export-assignments"]').exists()).toBe(false);
      expect(v2.exportTransactions).not.toHaveBeenCalled();
      expect(v2.exportAssignments).not.toHaveBeenCalled();
      expect(v2.exportLegacyAssignments).not.toHaveBeenCalled();
      expect(v2.getLegacyAssignmentHistory).not.toHaveBeenCalled();
      expect(wrapper.text()).not.toContain('Исторические назначения');
    });

    it('never calls the v1 export on export click', async () => {
      v2.exportTransactions.mockResolvedValue(new Blob(['a']));
      const wrapper = mount(AnalyticsPage, { global });
      await flushPromises();
      await wrapper.get('[data-action="export-transactions"]').trigger('click');
      await flushPromises();

      expect(api.downloadTransactionsCsv).not.toHaveBeenCalled();
    });

    it('falls back from a v1-only report key on a v2 budget', async () => {
      route.query = { report: 'envelope-balances' };
      mount(AnalyticsPage, { global });
      await flushPromises();

      expect(v2.getReport).toHaveBeenCalledWith('budget-id', 'expenses-by-category', {});
    });

    it('keeps rows, hides More at the end and retries after a failed page', async () => {
      const row = (id: string) => ({
        sourceKind: 'LEGACY_ALLOCATION',
        id,
        occurredOn: '2026-01-10',
        amountMinor: id === 'a' ? '100000' : '250000',
        status: 'CONFIRMED',
        isDeleted: false,
        isEnvelopeArchived: false,
        envelopeId: null,
        sourceEnvelopeId: null,
        destinationEnvelopeId: null,
        incomeTransactionId: null,
        categoryId: null,
        accountId: null,
      });
      v2.getLegacyAssignmentHistory
        .mockResolvedValueOnce({ items: [row('a')], nextCursor: 'c2', hasMore: true })
        .mockRejectedValueOnce(new Error('net'))
        .mockResolvedValueOnce({ items: [row('b')], nextCursor: null, hasMore: false });
      const wrapper = mount(AnalyticsPage, { global });
      await flushPromises();

      await wrapper.get('[data-action="legacy-more"]').trigger('click');
      await flushPromises();
      expect(flat(wrapper.text())).toContain('1 000,00');
      expect(wrapper.text()).toContain('Не удалось загрузить исторические назначения.');

      await wrapper.get('[data-action="legacy-retry"]').trigger('click');
      await flushPromises();
      expect(v2.getLegacyAssignmentHistory).toHaveBeenLastCalledWith('budget-id', {
        cursor: 'c2',
      });
      expect(flat(wrapper.text())).toContain('1 000,00');
      expect(flat(wrapper.text())).toContain('2 500,00');
      expect(wrapper.find('[data-action="legacy-more"]').exists()).toBe(false);
    });

    it('keeps v1 budgets away from the v2 archive and exports', async () => {
      delete budgetRow.planModelVersion;
      const wrapper = mount(AnalyticsPage, { global });
      await flushPromises();

      expect(v2.getReport).not.toHaveBeenCalled();
      expect(v2.exportTransactions).not.toHaveBeenCalled();
      expect(v2.exportAssignments).not.toHaveBeenCalled();
      expect(v2.exportLegacyAssignments).not.toHaveBeenCalled();
      expect(v2.getLegacyAssignmentHistory).not.toHaveBeenCalled();
      expect(wrapper.text()).not.toContain('Исторические назначения');
    });
  });
});
