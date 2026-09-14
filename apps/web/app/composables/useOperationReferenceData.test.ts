import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listEnvelopes: vi.fn(),
};
const auth = {
  currentData: {
    value: {
      user: { email: 'owner@example.test' },
      workspaces: [{ name: 'Семья', budgets: [{ id: 'budget-id', name: 'Бюджет' }] }],
    },
  },
  loadMe: vi.fn(),
};

vi.mock('./useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));
vi.mock('./useAuth.js', () => ({ useAuth: () => auth }));

import { useOperationReferenceData } from './useOperationReferenceData.js';

beforeEach(() => {
  vi.clearAllMocks();
  useOperationReferenceData().invalidate();
  api.listAccounts.mockResolvedValue([{ id: 'account-id', name: 'Основная карта' }]);
  api.listCategories.mockResolvedValue([
    { id: 'category-id', name: 'Продукты', categoryType: 'EXPENSE', templateKey: null },
  ]);
  api.listEnvelopes.mockResolvedValue([{ id: 'envelope-id', name: 'Текущие' }]);
});

describe('useOperationReferenceData', () => {
  it('loads options for the active budget', async () => {
    const { load, accounts, envelopes, categories, budgetId } = useOperationReferenceData();

    await load();

    expect(budgetId.value).toBe('budget-id');
    expect(accounts.value).toEqual([{ value: 'account-id', label: 'Основная карта' }]);
    expect(envelopes.value).toEqual([{ value: 'envelope-id', label: 'Текущие' }]);
    expect(categories.value).toHaveLength(1);
  });

  it('does not refetch what it already has', async () => {
    const { load } = useOperationReferenceData();

    await load();
    await load();

    expect(api.listAccounts).toHaveBeenCalledTimes(1);
  });
});
