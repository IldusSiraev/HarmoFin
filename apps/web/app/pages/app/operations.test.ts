import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  listTransactions: vi.fn(),
  downloadTransactionsCsv: vi.fn(),
  getTransaction: vi.fn(),
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listEnvelopes: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
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
      workspaces: [
        { role: 'OWNER', budgets: [{ id: 'budget-id', name: 'Бюджет', primaryCurrency: 'RUB' }] },
      ],
    } as {
      user: { email: string };
      workspaces: Array<{
        role: string;
        budgets: Array<{ id: string; name: string; primaryCurrency: string }>;
      }>;
    } | null,
  },
  loadMe: vi.fn(),
};

const { routeQuery } = vi.hoisted(() => ({ routeQuery: {} as Record<string, string> }));

vi.mock('#imports', () => ({
  definePageMeta: vi.fn(),
  navigateTo: vi.fn(),
  useRoute: () => ({ query: routeQuery }),
}));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));
vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));

import { ApiRequestError } from '../../composables/useApiClient.js';
import OperationsPage from './operations.vue';

describe('operations page', () => {
  let wrapper: ReturnType<typeof mount> | null = null;

  const mountPage = (props = {}) => {
    wrapper = mount(OperationsPage, {
      attachTo: document.body,
      ...props,
    });
    return wrapper;
  };

  beforeEach(() => {
    auth.currentData.value = {
      user: { email: 'owner@harmofin.test' },
      workspaces: [
        { role: 'OWNER', budgets: [{ id: 'budget-id', name: 'Бюджет', primaryCurrency: 'RUB' }] },
      ],
    };
    vi.clearAllMocks();
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    api.listTransactions.mockResolvedValue({ items: [], nextCursor: null });
    api.getTransaction.mockResolvedValue(null);
    api.listAccounts.mockResolvedValue([]);
    api.listCategories.mockResolvedValue([]);
    api.listEnvelopes.mockResolvedValue([]);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it('loads server journal and opens explicit operation form', async () => {
    mountPage();
    await flushPromises();

    expect(api.listTransactions).toHaveBeenCalledWith('budget-id', {
      sortBy: 'occurredOn',
      sortDirection: 'desc',
    });
    await wrapper!.get('[data-action="create-operation"]').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('Создать черновик');
    expect(document.body.textContent).toContain('Подтвердить операцию');
  });

  it('lets owner download CSV with current journal filters', async () => {
    routeQuery.status = 'CONFIRMED';
    routeQuery.sortBy = 'amount';
    api.downloadTransactionsCsv.mockResolvedValue(new Blob(['csv']));
    mountPage();
    await flushPromises();

    await wrapper!.get('[data-action="download-csv"]').trigger('click');
    await flushPromises();

    expect(api.downloadTransactionsCsv).toHaveBeenCalledWith('budget-id', {
      status: 'CONFIRMED',
      sortBy: 'amount',
      sortDirection: 'desc',
    });
  });

  it('announces CSV download error to owner', async () => {
    api.downloadTransactionsCsv.mockRejectedValue(
      new ApiRequestError(422, {
        code: 'EXPORT_LIMIT_EXCEEDED',
        detail: 'Сузьте фильтры журнала.',
      }),
    );
    mountPage();
    await flushPromises();

    await wrapper!.get('[data-action="download-csv"]').trigger('click');
    await flushPromises();

    expect(wrapper!.get('[role="alert"]').text()).toContain('Не удалось скачать CSV');
  });

  it('hides CSV download from editor', async () => {
    auth.currentData.value = {
      user: { email: 'editor@harmofin.test' },
      workspaces: [
        { role: 'EDITOR', budgets: [{ id: 'budget-id', name: 'Бюджет', primaryCurrency: 'RUB' }] },
      ],
    };
    mountPage();
    await flushPromises();

    expect(wrapper!.find('[data-action="download-csv"]').exists()).toBe(false);
  });

  it('preloads draft from draftId query into operation editor', async () => {
    routeQuery.draftId = '00000000-0000-4000-8000-000000000001';
    api.getTransaction.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      budgetId: 'budget-id',
      transactionType: 'INCOME',
      status: 'DRAFT',
      amountMinor: '10000',
      currency: 'RUB',
      scale: 2,
      occurredOn: '2026-09-10',
      accountId: 'account-id',
      categoryId: 'category-id',
      envelopeId: null,
      sourceDescription: 'Доход по плану',
      merchantName: null,
      isPlanned: true,
      comment: null,
      confirmedAt: null,
      cancelledAt: null,
      deletedAt: null,
      accountCurrentBalanceMinor: '0',
      envelopeCurrentBalanceMinor: null,
      unallocatedMinor: '10000',
      allocationProposal: null,
    });
    mountPage();
    await flushPromises();

    expect(api.getTransaction).toHaveBeenCalledWith(
      'budget-id',
      '00000000-0000-4000-8000-000000000001',
    );
    expect(document.body.textContent).toContain('Сохранить изменения');
    const amountInput = document.querySelector('input[name="amount"]') as HTMLInputElement;
    expect(amountInput?.value).toBe('100.00');
  });

  it('does not reopen the draft editor after saving it once (post-save reload)', async () => {
    routeQuery.draftId = '00000000-0000-4000-8000-000000000001';
    api.getTransaction.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      budgetId: 'budget-id',
      transactionType: 'INCOME',
      status: 'DRAFT',
      amountMinor: '10000',
      currency: 'RUB',
      scale: 2,
      occurredOn: '2026-09-10',
      accountId: 'account-id',
      categoryId: 'category-id',
      envelopeId: null,
      sourceDescription: 'Доход по плану',
      merchantName: null,
      isPlanned: true,
      comment: null,
      confirmedAt: null,
      cancelledAt: null,
      deletedAt: null,
      accountCurrentBalanceMinor: '0',
      envelopeCurrentBalanceMinor: null,
      unallocatedMinor: '10000',
      allocationProposal: null,
    });
    api.updateTransaction.mockResolvedValue(undefined);
    mountPage();
    await flushPromises();

    expect(api.getTransaction).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('Сохранить изменения');

    const amountInput = document.querySelector('input[name="amount"]') as HTMLInputElement;
    amountInput.value = '150.00';
    amountInput.dispatchEvent(new Event('input', { bubbles: true }));
    amountInput.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    const form = document.querySelector('.operation-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    const confirmButton = wrapper!
      .findAll('button')
      .find((button) => button.text() === 'Подтвердить');
    await confirmButton!.trigger('click');
    await flushPromises();

    expect(api.updateTransaction).toHaveBeenCalledTimes(1);
    // runConfirmation()'s 'update' branch clears formOpen AND selectedTransaction, then
    // reloads. draftId is still in the URL and the (mocked) transaction is still DRAFT,
    // so without the preloadedDraftId guard this reload would reopen the same edit
    // modal in a loop.
    expect(api.getTransaction).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain('Сохранить изменения');
  });

  it('shows API money validation beside operation amount', async () => {
    api.createTransaction.mockRejectedValueOnce(
      new ApiRequestError(400, {
        code: 'VALIDATION_FAILED',
        detail: 'Допустимо не более двух знаков после запятой.',
        fieldErrors: [],
      }),
    );
    mountPage();
    await flushPromises();

    await wrapper!.get('[data-action="create-operation"]').trigger('click');
    await flushPromises();

    const amountInput = document.querySelector('input[name="amount"]') as HTMLInputElement;
    amountInput.value = '1.234';
    amountInput.dispatchEvent(new Event('input', { bubbles: true }));
    amountInput.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    const form = document.querySelector('.operation-form') as HTMLFormElement;
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(document.body.textContent).toContain('Укажите данные формы.');
    expect(amountInput?.getAttribute('aria-invalid')).toBe('true');
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
    mountPage();
    await flushPromises();

    await wrapper!.get('.allocation-form button:last-child').trigger('click');
    await flushPromises();

    expect(wrapper!.text()).not.toContain('Применить предложение');
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
    mountPage();
    await flushPromises();

    await wrapper!.get('[data-action="edit-operation"]').trigger('click');
    await flushPromises();

    const amountInput = document.querySelector('input[name="amount"]') as HTMLInputElement;
    expect(amountInput?.value).toBe('1250.00');
    expect(document.body.textContent).toContain('Сохранить изменения');
  });

  it('renders no-budget empty state without inventing budget id', async () => {
    auth.currentData.value = null;
    mountPage();
    await flushPromises();

    expect(wrapper!.text()).toContain('Бюджет не выбран');
    expect(api.listTransactions).not.toHaveBeenCalled();
  });
});
