import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
};
const v2 = {
  getReport: vi.fn(),
  listEnvelopes: vi.fn(),
  exportTransactions: vi.fn(),
  exportAssignments: vi.fn(),
};
const route = { query: {} as Record<string, string> };
const budgetRow = {
  id: 'budget-id',
  name: 'Бюджет',
  primaryCurrency: 'RUB',
  planModelVersion: 2,
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

const global = {
  stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
};

describe('analytics page', () => {
  beforeEach(() => {
    route.query = {};
    vi.clearAllMocks();
    workspaceRow.role = 'OWNER';
    v2.getReport.mockResolvedValue({ key: 'expenses-by-category', rows: [] });
    v2.listEnvelopes.mockResolvedValue({ items: [] });
    api.listAccounts.mockResolvedValue([]);
    api.listCategories.mockResolvedValue([]);
  });

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
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
  });

  it('reads the v2 report and never calls v1 reports or envelope balances', async () => {
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();

    expect(v2.getReport).toHaveBeenCalledWith('budget-id', 'expenses-by-category', {});
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
    expect(text).toContain('Отложено');
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
    expect(wrapper.text()).toContain('Скачать распределения (CSV)');
  });

  it('hides exports from non-owners and explains why', async () => {
    workspaceRow.role = 'VIEWER';
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();

    expect(wrapper.find('[data-action="export-transactions"]').exists()).toBe(false);
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

  it('does not call exports for a non-owner', async () => {
    workspaceRow.role = 'VIEWER';
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();

    expect(wrapper.find('[data-action="export-assignments"]').exists()).toBe(false);
    expect(v2.exportTransactions).not.toHaveBeenCalled();
    expect(v2.exportAssignments).not.toHaveBeenCalled();
  });

  it('falls back from an unknown report key', async () => {
    route.query = { report: 'envelope-balances' };
    mount(AnalyticsPage, { global });
    await flushPromises();

    expect(v2.getReport).toHaveBeenCalledWith('budget-id', 'expenses-by-category', {});
  });
});
