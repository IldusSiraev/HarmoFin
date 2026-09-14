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
  ]);
  api.listEnvelopes.mockResolvedValue([{ id: 'envelope-id', name: 'Текущие' }]);
});

describe('AppOperationDialogs', () => {
  it('shows nothing while no dialog is requested', () => {
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });

    expect(document.querySelector('form.operation-form')).toBeNull();
    expect(document.querySelector('form.transfer-form')).toBeNull();
    wrapper.unmount();
  });

  it('opens the requested dialog with the budget reference data', async () => {
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });

    useOperationDialogs().openTransfer();
    await flushPromises();

    expect(api.listAccounts).toHaveBeenCalledWith('budget-id', 'active');
    expect(document.querySelector('form.transfer-form')).not.toBeNull();
    wrapper.unmount();
  });

  it('creates an operation through the API and closes', async () => {
    api.createTransaction.mockResolvedValue({ id: 'transaction-id' });
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });
    useOperationDialogs().openOperation('EXPENSE');
    await flushPromises();

    const form = document.querySelector('form.operation-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(api.createTransaction).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({ transactionType: 'EXPENSE' }),
      expect.any(String),
    );
    expect(useOperationDialogs().openDialog.value).toBe('none');
    expect(useToast().toasts.value.at(-1)?.title).toBe('Операция сохранена');
    expect(wrapper.emitted('saved')).toHaveLength(1);
    wrapper.unmount();
  });

  it('announces a failed save and keeps the dialog open', async () => {
    api.createTransaction.mockRejectedValue(new Error('network'));
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });
    useOperationDialogs().openOperation('INCOME');
    await flushPromises();

    const form = document.querySelector('form.operation-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(useOperationDialogs().openDialog.value).toBe('operation');
    expect(useToast().toasts.value.at(-1)?.tone).toBe('error');
    wrapper.unmount();
  });
});
