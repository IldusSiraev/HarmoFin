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
  restoreTransaction: vi.fn(),
  deleteTransactionWithAllocations: vi.fn(),
  listTransactionAllocations: vi.fn(),
  listTransactionAudit: vi.fn(),
  createIncomeAllocation: vi.fn(),
  restoreIncomeAllocation: vi.fn(),
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

import { ApiRequestError } from '../../composables/useApiClient.js';
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

    expect(api.listTransactions).toHaveBeenCalledWith('budget-id', {
      sortBy: 'occurredOn',
      sortDirection: 'desc',
    });
    await wrapper.get('[data-action="create-operation"]').trigger('click');
    expect(wrapper.text()).toContain('Создать черновик');
    expect(wrapper.text()).toContain('Подтвердить операцию');
  });

  it('shows API money validation beside operation amount', async () => {
    api.createTransaction.mockRejectedValueOnce(
      new ApiRequestError(400, {
        code: 'VALIDATION_FAILED',
        detail: 'Допустимо не более двух знаков после запятой.',
        fieldErrors: [],
      }),
    );
    const wrapper = mount(OperationsPage);
    await flushPromises();

    await wrapper.get('[data-action="create-operation"]').trigger('click');
    await wrapper.get('input[name="amount"]').setValue('1.234');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Укажите данные формы.');
    expect(wrapper.get('input[name="amount"]').attributes('aria-invalid')).toBe('true');
  });

  it('hides a rejected generic allocation proposal without creating allocation', async () => {
    api.listTransactions.mockResolvedValue({
      items: [
        {
          id: 'income-id',
          budgetId: 'budget-id',
          transactionType: 'INCOME',
          status: 'CONFIRMED',
          amountMinor: '1200000',
          currency: 'RUB',
          scale: 2,
          occurredOn: '2026-09-04',
          accountId: 'account-id',
          categoryId: 'category-id',
          envelopeId: null,
          sourceDescription: null,
          merchantName: null,
          isPlanned: false,
          comment: null,
          confirmedAt: '2026-09-04T00:00:00.000Z',
          cancelledAt: null,
          deletedAt: null,
          accountCurrentBalanceMinor: '1200000',
          envelopeCurrentBalanceMinor: null,
          unallocatedMinor: '1200000',
          allocationProposal: {
            targetEnvelopeId: 'envelope-id',
            amountMinor: '1200000',
            currency: 'RUB',
            scale: 2,
          },
        },
      ],
      nextCursor: null,
    });
    const wrapper = mount(OperationsPage);
    await flushPromises();

    await wrapper.get('.allocation-form button:last-child').trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('Применить предложение');
    expect(api.createIncomeAllocation).not.toHaveBeenCalled();
  });

  it('preloads edit form for selected operation', async () => {
    api.listTransactions.mockResolvedValue({
      items: [
        {
          id: 'expense-id',
          budgetId: 'budget-id',
          transactionType: 'EXPENSE',
          status: 'CONFIRMED',
          amountMinor: '125000',
          currency: 'RUB',
          scale: 2,
          occurredOn: '2026-09-05',
          accountId: 'account-id',
          categoryId: 'category-id',
          envelopeId: 'envelope-id',
          sourceDescription: null,
          merchantName: 'Магазин',
          isPlanned: false,
          comment: null,
          confirmedAt: '2026-09-05T00:00:00.000Z',
          cancelledAt: null,
          deletedAt: null,
          accountCurrentBalanceMinor: '0',
          envelopeCurrentBalanceMinor: '0',
          unallocatedMinor: '0',
          allocationProposal: null,
        },
      ],
      nextCursor: null,
    });
    const wrapper = mount(OperationsPage);
    await flushPromises();

    await wrapper.get('[data-action="edit-operation"]').trigger('click');

    expect((wrapper.get('input[name="amount"]').element as HTMLInputElement).value).toBe('1250.00');
    expect(wrapper.text()).toContain('Сохранить изменения');
  });

  it('renders no-budget empty state without inventing budget id', async () => {
    auth.currentData.value = null;
    const wrapper = mount(OperationsPage);
    await flushPromises();

    expect(wrapper.text()).toContain('Бюджет не выбран');
    expect(api.listTransactions).not.toHaveBeenCalled();
  });
});
