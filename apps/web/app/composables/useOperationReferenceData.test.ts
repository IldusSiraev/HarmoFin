import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listEnvelopes: vi.fn(),
};
const v2 = { listEnvelopes: vi.fn() };
type AuthData = {
  user: { email: string };
  workspaces: Array<{ name: string; budgets: Array<{ id: string; name: string }> }>;
} | null;

const auth = {
  currentData: {
    value: null as AuthData,
  },
  loadMe: vi.fn(),
};

vi.mock('./useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));
vi.mock('./useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => v2 }));
vi.mock('./useAuth.js', () => ({ useAuth: () => auth }));

import { useOperationReferenceData } from './useOperationReferenceData.js';

beforeEach(() => {
  vi.clearAllMocks();
  auth.currentData.value = {
    user: { email: 'owner@example.test' },
    workspaces: [{ name: 'Семья', budgets: [{ id: 'budget-id', name: 'Бюджет' }] }],
  };
  useOperationReferenceData().invalidate();
  api.listAccounts.mockResolvedValue([
    { id: 'account-id', name: 'Основная карта', accountType: 'BANK_CARD' },
  ]);
  api.listCategories.mockResolvedValue([
    { id: 'category-id', name: 'Продукты', categoryType: 'EXPENSE', templateKey: null },
  ]);
  api.listEnvelopes.mockResolvedValue([
    { id: 'envelope-id', name: 'Текущие', envelopeType: 'CURRENT_EXPENSES' },
  ]);
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

  it('also keeps the full account and envelope records for callers that need more than name', async () => {
    const { load, accountDetails, envelopeDetails } = useOperationReferenceData();

    await load();

    expect(accountDetails.value).toEqual([
      { id: 'account-id', name: 'Основная карта', accountType: 'BANK_CARD' },
    ]);
    expect(envelopeDetails.value).toEqual([
      { id: 'envelope-id', name: 'Текущие', envelopeType: 'CURRENT_EXPENSES' },
    ]);
  });

  it('does not refetch what it already has', async () => {
    const { load } = useOperationReferenceData();

    await load();
    await load();

    expect(api.listAccounts).toHaveBeenCalledTimes(1);
  });

  it('reloads after a reference record changed', async () => {
    const { load, invalidate } = useOperationReferenceData();
    await load();

    invalidate();
    await load();

    expect(api.listAccounts).toHaveBeenCalledTimes(2);
  });

  it('never serves one budget the cache of another', async () => {
    const { load, accounts, budgetId } = useOperationReferenceData();
    await load();

    auth.currentData.value = {
      user: { email: 'other@example.test' },
      workspaces: [{ name: 'Другая семья', budgets: [{ id: 'other-budget-id', name: 'Бюджет' }] }],
    };
    api.listAccounts.mockResolvedValue([{ id: 'other-account-id', name: 'Чужая карта' }]);
    await load();

    expect(budgetId.value).toBe('other-budget-id');
    expect(accounts.value).toEqual([{ value: 'other-account-id', label: 'Чужая карта' }]);
    expect(api.listAccounts).toHaveBeenLastCalledWith('other-budget-id', 'active');
  });

  it('drops what it holds when nobody is signed in', async () => {
    const { load, accounts } = useOperationReferenceData();
    await load();

    auth.currentData.value = null;
    auth.loadMe.mockResolvedValue(undefined);
    await load();

    expect(accounts.value).toEqual([]);
  });
});

describe('useOperationReferenceData for an Envelope Plan v2 budget', () => {
  it('loads envelopes through the v2 list and never calls the v1 envelope endpoint', async () => {
    auth.currentData.value = {
      user: { email: 'owner@example.test' },
      workspaces: [
        {
          name: 'Семья',
          budgets: [{ id: 'budget-v2', name: 'Бюджет', planModelVersion: 2 }],
        },
      ],
    } as never;
    v2.listEnvelopes.mockResolvedValue({
      items: [{ id: 'env-v2', name: 'Обязательные', envelopeType: 'MANDATORY', archivedAt: null }],
    });
    const { load, envelopes, envelopePlans, envelopeDetails, accounts } =
      useOperationReferenceData();

    await load();

    expect(v2.listEnvelopes).toHaveBeenCalledWith('budget-v2');
    expect(api.listEnvelopes).not.toHaveBeenCalled();
    expect(api.listAccounts).toHaveBeenCalledWith('budget-v2', 'active');
    expect(envelopes.value).toEqual([{ value: 'env-v2', label: 'Обязательные' }]);
    expect(envelopePlans.value).toHaveLength(1);
    expect(envelopeDetails.value).toEqual([]);
    expect(accounts.value).toHaveLength(1);
  });
});
