import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listEnvelopes: vi.fn(),
  createTransaction: vi.fn(),
  createTransfer: vi.fn(),
};
const auth = {
  currentData: {
    value: {
      user: { email: 'owner@harmofin.test' },
      workspaces: [{ role: 'OWNER', budgets: [{ id: 'budget-id', name: 'Бюджет' }] }],
    },
  },
  loadMe: vi.fn(),
};

vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));

import AppOperationDialogs from './AppOperationDialogs.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';
import { useToast } from '../../composables/useToast.js';

function click(testId: string): void {
  document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
}

function typeAmount(value: string): void {
  const input = document.querySelector<HTMLInputElement>('input[name="amount"]');
  if (!input) return;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useOperationDialogs().close();
  useToast().clear();
  useOperationReferenceData().invalidate();
  api.listAccounts.mockResolvedValue([{ id: 'account-id', name: 'Основная карта' }]);
  api.listCategories.mockResolvedValue([
    {
      id: 'category-id',
      name: 'Продукты',
      categoryType: 'EXPENSE',
      templateKey: 'expense-groceries',
      archivedAt: null,
    },
    {
      id: 'income-category-id',
      name: 'Зарплата',
      categoryType: 'INCOME',
      templateKey: 'income-salary',
      archivedAt: null,
    },
  ]);
  api.listEnvelopes.mockResolvedValue([{ id: 'envelope-id', name: 'Текущие' }]);
});

describe('AppOperationDialogs', () => {
  it('shows nothing while no dialog is requested', () => {
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });

    expect(document.querySelector('[data-testid="entry-submit"]')).toBeNull();
    expect(document.querySelector('form.transfer-form')).toBeNull();
    wrapper.unmount();
  });

  it('opens the type picker and routes the chosen type into the entry dialog', async () => {
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });

    useOperationDialogs().openChoose();
    await flushPromises();
    expect(document.querySelector('[data-testid="operation-type-expense"]')).not.toBeNull();

    click('operation-type-income');
    await flushPromises();

    expect(useOperationDialogs().openDialog.value).toBe('entry');
    expect(useOperationDialogs().entryType.value).toBe('INCOME');
    expect(document.querySelector('[data-testid="entry-tab-INCOME"]')?.getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(document.querySelector('[data-testid="operation-type-expense"]')).toBeNull();
    wrapper.unmount();
  });

  it('opens the transfer tab of the entry dialog with the budget reference data', async () => {
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });

    useOperationDialogs().openTransfer();
    await flushPromises();

    expect(api.listAccounts).toHaveBeenCalledWith('budget-id', 'active');
    expect(document.querySelector('[data-testid="entry-tab-TRANSFER"]')?.getAttribute('aria-selected')).toBe(
      'true',
    );
    wrapper.unmount();
  });

  it('creates an expense through the API and closes', async () => {
    api.createTransaction.mockResolvedValue({ id: 'transaction-id' });
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });
    useOperationDialogs().openOperation('EXPENSE');
    await flushPromises();

    typeAmount('500');
    click('pill-account-account-id');
    click('pill-category-category-id');
    click('pill-envelope-envelope-id');
    await flushPromises();
    click('entry-submit');
    await flushPromises();

    expect(api.createTransaction).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({ transactionType: 'EXPENSE', status: 'CONFIRMED' }),
      expect.any(String),
    );
    expect(useOperationDialogs().openDialog.value).toBe('none');
    expect(useToast().toasts.value.at(-1)?.title).toBe('Операция сохранена');
    expect(wrapper.emitted('saved')).toHaveLength(1);
    wrapper.unmount();
  });

  it('creates an income without requiring an envelope', async () => {
    api.createTransaction.mockResolvedValue({ id: 'transaction-id' });
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });
    useOperationDialogs().openOperation('INCOME');
    await flushPromises();

    typeAmount('1000');
    click('pill-account-account-id');
    click('pill-category-income-category-id');
    await flushPromises();
    click('entry-submit');
    await flushPromises();

    expect(api.createTransaction).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({ transactionType: 'INCOME', status: 'CONFIRMED' }),
      expect.any(String),
    );
    wrapper.unmount();
  });

  it('announces a failed save and keeps the entry dialog open', async () => {
    api.createTransaction.mockRejectedValue(new Error('network'));
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });
    useOperationDialogs().openOperation('INCOME');
    await flushPromises();

    typeAmount('1000');
    click('pill-account-account-id');
    click('pill-category-income-category-id');
    await flushPromises();
    click('entry-submit');
    await flushPromises();

    expect(useOperationDialogs().openDialog.value).toBe('entry');
    expect(useToast().toasts.value.at(-1)?.tone).toBe('error');
    wrapper.unmount();
  });

  it('hands the quick transfer fields to the advanced split-by-envelope form', async () => {
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });
    api.listAccounts.mockResolvedValue([
      { id: 'account-id', name: 'Основная карта' },
      { id: 'savings-id', name: 'Накопительный' },
    ]);
    useOperationDialogs().openTransfer();
    await flushPromises();

    typeAmount('2000');
    click('pill-transferSource-account-id');
    click('pill-transferDestination-savings-id');
    click('pill-transferEnvelope-envelope-id');
    click('entry-split-transfer');
    await flushPromises();

    expect(useOperationDialogs().openDialog.value).toBe('transferAdvanced');
    expect(document.querySelector<HTMLInputElement>('input[name="total"]')?.value).toBe('2000');
    wrapper.unmount();
  });
});
