import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  listTransactionAllocations: vi.fn(),
  listTransactionAudit: vi.fn(),
  confirmTransaction: vi.fn(),
  cancelTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  restoreTransaction: vi.fn(),
  deleteTransactionWithAllocations: vi.fn(),
  createIncomeAllocation: vi.fn(),
  getTransaction: vi.fn(),
};

vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));

import OperationDrawer from './OperationDrawer.vue';
import { useToast } from '../../composables/useToast.js';
import type { TransactionDto } from '../../composables/useBudgetReferenceData.js';

const transaction = {
  id: 'transaction-id',
  budgetId: 'budget-id',
  transactionType: 'EXPENSE',
  status: 'DRAFT',
  amountMinor: '245000',
  currency: 'RUB',
  scale: 2,
  occurredOn: '2026-09-14',
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  sourceDescription: null,
  merchantName: 'Супермаркет',
  isPlanned: false,
  comment: 'Еженедельная закупка',
  confirmedAt: null,
  cancelledAt: null,
  deletedAt: null,
  accountCurrentBalanceMinor: '1000000',
  envelopeCurrentBalanceMinor: '500000',
  unallocatedMinor: '0',
  allocationProposal: null,
} as unknown as TransactionDto;

const mountDrawer = (overrides: Partial<TransactionDto> = {}) =>
  mount(OperationDrawer, {
    props: {
      transaction: { ...transaction, ...overrides },
      budgetId: 'budget-id',
      accountName: 'Основная карта',
      categoryName: 'Продукты',
      envelopeName: 'Текущие',
      accounts: [{ value: 'account-id', label: 'Основная карта' }],
      envelopes: [{ value: 'envelope-id', label: 'Текущие' }],
    },
    attachTo: document.body,
  });

beforeEach(() => {
  vi.clearAllMocks();
  useToast().clear();
  api.listTransactionAllocations.mockResolvedValue([]);
  api.listTransactionAudit.mockResolvedValue([]);
});

describe('OperationDrawer', () => {
  it('shows what the operation is', async () => {
    const wrapper = mountDrawer();
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain('Продукты');
    expect(text).toContain('Основная карта');
    expect(text).toContain('Текущие');
    expect(text).toContain('Еженедельная закупка');
    wrapper.unmount();
  });

  it('loads allocations and audit history when it opens', async () => {
    const wrapper = mountDrawer();
    await flushPromises();

    expect(api.listTransactionAllocations).toHaveBeenCalledWith('budget-id', 'transaction-id');
    expect(api.listTransactionAudit).toHaveBeenCalledWith('budget-id', 'transaction-id');
    wrapper.unmount();
  });

  it('confirms a draft and reports the new state', async () => {
    api.confirmTransaction.mockResolvedValue({ ...transaction, status: 'CONFIRMED' });
    const wrapper = mountDrawer();
    await flushPromises();

    await wrapper.get('[data-testid="drawer-confirm"]').trigger('click');
    await flushPromises();

    expect(api.confirmTransaction).toHaveBeenCalled();
    expect(wrapper.emitted('changed')?.[0]?.[0]).toMatchObject({ status: 'CONFIRMED' });
    wrapper.unmount();
  });

  it('asks the page to handle deletion instead of deleting itself', async () => {
    const wrapper = mountDrawer();
    await flushPromises();

    await wrapper.get('[data-testid="drawer-delete"]').trigger('click');

    expect(api.deleteTransaction).not.toHaveBeenCalled();
    expect(wrapper.emitted('request-delete')).toHaveLength(1);
    wrapper.unmount();
  });

  it('offers restore for a deleted operation and nothing else', async () => {
    const wrapper = mountDrawer({ status: 'DELETED' });
    await flushPromises();

    expect(wrapper.find('[data-testid="drawer-confirm"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="drawer-restore"]')).toBeTruthy();
    wrapper.unmount();
  });
});
