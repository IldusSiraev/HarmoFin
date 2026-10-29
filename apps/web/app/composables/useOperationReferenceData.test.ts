import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
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
  currentUser: {
    value: null as { id: string; email: string } | null,
  },
  loadMe: vi.fn(),
};

const OWN_ACCOUNT = {
  id: 'account-id',
  name: 'Основная карта',
  accountType: 'BANK_CARD',
  canEdit: true,
  owner: { userId: 'user-1', displayName: 'Иван', isActiveMember: true },
};
const FOREIGN_ACCOUNT = {
  id: 'foreign-account',
  name: 'Копилка',
  accountType: 'SAVINGS',
  canEdit: false,
  owner: { userId: 'member-1', displayName: 'Алия', isActiveMember: true },
};
const OWN_ENVELOPE = {
  id: 'envelope-id',
  name: 'Текущие',
  envelopeType: 'CURRENT_EXPENSES',
  archivedAt: null,
  owner: { userId: 'user-1', displayName: 'Иван', isActiveMember: true },
};
const FOREIGN_ENVELOPE = {
  id: 'foreign-envelope',
  name: 'Аренда',
  envelopeType: 'CURRENT_EXPENSES',
  archivedAt: null,
  owner: { userId: 'member-1', displayName: 'Алия', isActiveMember: true },
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
  auth.currentUser.value = { id: 'user-1', email: 'owner@example.test' };
  useOperationReferenceData().invalidate();
  api.listAccounts.mockResolvedValue([OWN_ACCOUNT, FOREIGN_ACCOUNT]);
  api.listCategories.mockResolvedValue([
    { id: 'category-id', name: 'Продукты', categoryType: 'EXPENSE', templateKey: null },
  ]);
  v2.listEnvelopes.mockResolvedValue({
    items: [
      OWN_ENVELOPE,
      FOREIGN_ENVELOPE,
      { ...OWN_ENVELOPE, id: 'archived-id', archivedAt: 'x' },
    ],
  });
});

describe('useOperationReferenceData', () => {
  it('loads options for the active budget through the v2 envelope list', async () => {
    const { load, accounts, envelopes, categories, budgetId } = useOperationReferenceData();

    await load();

    expect(v2.listEnvelopes).toHaveBeenCalledWith('budget-id');
    expect(budgetId.value).toBe('budget-id');
    expect(accounts.value).toEqual([
      { value: 'account-id', label: 'Основная карта' },
      { value: 'foreign-account', label: 'Копилка' },
    ]);
    expect(envelopes.value).toEqual([
      { value: 'envelope-id', label: 'Текущие' },
      { value: 'foreign-envelope', label: 'Аренда' },
    ]);
    expect(categories.value).toHaveLength(1);
  });

  it('also keeps the full account and envelope plan records for callers that need more than name', async () => {
    const { load, accountDetails, envelopePlans } = useOperationReferenceData();

    await load();

    expect(accountDetails.value.map((account) => account.id)).toEqual([
      'account-id',
      'foreign-account',
    ]);
    expect(envelopePlans.value.map((plan) => plan.id)).toEqual(['envelope-id', 'foreign-envelope']);
  });

  it('offers the forms only own accounts, while the family lists caption foreign ones', async () => {
    const { load, ownAccounts, familyAccounts, envelopeOptions } = useOperationReferenceData();

    await load();

    // Forms: strictly the server-marked editable accounts, plain names.
    expect(ownAccounts.value).toEqual([{ value: 'account-id', label: 'Основная карта' }]);
    // Destination pickers and envelope lists: everything, foreign owner in the label.
    expect(familyAccounts.value).toEqual([
      { value: 'account-id', label: 'Основная карта' },
      { value: 'foreign-account', label: 'Копилка — Алия' },
    ]);
    expect(envelopeOptions.value).toEqual([
      { value: 'envelope-id', label: 'Текущие' },
      { value: 'foreign-envelope', label: 'Аренда — Алия' },
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
    const { load, accounts, ownAccounts, familyAccounts, envelopeOptions } =
      useOperationReferenceData();
    await load();

    auth.currentData.value = null;
    auth.loadMe.mockResolvedValue(undefined);
    await load();

    expect(accounts.value).toEqual([]);
    expect(ownAccounts.value).toEqual([]);
    expect(familyAccounts.value).toEqual([]);
    expect(envelopeOptions.value).toEqual([]);
  });
});
