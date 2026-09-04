import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  listTransactions: vi.fn(),
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listEnvelopes: vi.fn(),
  createTransaction: vi.fn(),
  confirmTransaction: vi.fn(),
  cancelTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  createIncomeAllocation: vi.fn(),
};
const auth = {
  currentData: {
    value: {
      user: { email: 'owner@harmofin.test' },
      workspaces: [{ budgets: [{ id: 'budget-id', name: 'Бюджет', primaryCurrency: 'RUB' }] }],
    } as {
      user: { email: string };
      workspaces: Array<{ budgets: Array<{ id: string; name: string; primaryCurrency: string }> }>;
    } | null,
  },
  loadMe: vi.fn(),
};

vi.mock('#imports', () => ({ definePageMeta: vi.fn() }));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));
vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));

import OperationsPage from './operations.vue';

describe('operations page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listTransactions.mockResolvedValue({ items: [], nextCursor: null });
    api.listAccounts.mockResolvedValue([]);
    api.listCategories.mockResolvedValue([]);
    api.listEnvelopes.mockResolvedValue([]);
  });

  it('loads server journal and opens explicit operation form', async () => {
    const wrapper = mount(OperationsPage);
    await flushPromises();

    expect(api.listTransactions).toHaveBeenCalledWith('budget-id', {});
    await wrapper.get('[data-action="create-operation"]').trigger('click');
    expect(wrapper.text()).toContain('Создать черновик');
    expect(wrapper.text()).toContain('Подтвердить операцию');
  });

  it('renders no-budget empty state without inventing budget id', async () => {
    auth.currentData.value = null;
    const wrapper = mount(OperationsPage);
    await flushPromises();

    expect(wrapper.text()).toContain('Бюджет не выбран');
    expect(api.listTransactions).not.toHaveBeenCalled();
  });
});
