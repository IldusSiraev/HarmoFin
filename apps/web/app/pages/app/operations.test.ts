import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The journal reads and writes only the v2 API. The v1 reference client keeps
// just the model-agnostic audit route, so anything else would throw on this mock.
const v1 = {
  listTransactionAudit: vi.fn(),
};
const v2 = {
  listTransactions: vi.fn(),
  getTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  restoreTransaction: vi.fn(),
  exportTransactions: vi.fn(),
};
const auth = {
  currentData: {
    value: null as {
      user: { email: string };
      workspaces: Array<{
        role: string;
        budgets: Array<{
          id: string;
          name: string;
          primaryCurrency: string;
          planModelVersion: number;
        }>;
      }>;
    } | null,
  },
  loadMe: vi.fn(),
};
const reference = {
  accounts: ref([{ value: 'account-id', label: 'Основная карта' }]),
  categories: ref([
    {
      id: 'category-id',
      budgetId: 'budget-id',
      templateKey: null,
      name: 'Продукты',
      categoryType: 'EXPENSE',
      parentId: null,
      displayOrder: 0,
      comment: null,
      icon: null,
      archivedAt: null,
    },
  ]),
  envelopes: ref([{ value: 'envelope-id', label: 'Текущие' }]),
  load: vi.fn(),
};

const { routeQuery } = vi.hoisted(() => ({ routeQuery: {} as Record<string, string> }));

vi.mock('#imports', () => ({
  definePageMeta: vi.fn(),
  navigateTo: vi.fn(),
  useRoute: () => ({ path: '/app/operations', query: routeQuery }),
}));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));
vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => v1,
}));
vi.mock('../../composables/useEnvelopePlanV2.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useEnvelopePlanV2: () => v2,
}));
vi.mock('../../composables/useOperationReferenceData.js', () => ({
  useOperationReferenceData: () => reference,
}));

import { ApiRequestError } from '../../composables/useApiClient.js';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
import { useToast } from '../../composables/useToast.js';
import OperationsPage from './operations.vue';

const expense = {
  id: '00000000-0000-4000-8000-000000000001',
  budgetId: 'budget-id',
  accountingModelVersion: 2,
  transactionType: 'EXPENSE',
  status: 'CONFIRMED',
  amountMinor: '125000',
  currency: 'RUB',
  occurredOn: '2026-09-05',
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  sourceDescription: null,
  merchantName: 'Магазин',
  comment: null,
  planOccurrenceIds: [],
  confirmedAt: '2026-09-05T00:00:00.000Z',
  cancelledAt: null,
  deletedAt: null,
  createdAt: '2026-09-05T00:00:00.000Z',
};
const lifecycle = (status: string) => ({
  id: expense.id,
  status,
  warnings: [],
  occurrences: [],
});

describe('operations page (v2 journal)', () => {
  let wrapper: ReturnType<typeof mount> | null = null;

  const mountPage = () => {
    wrapper = mount(OperationsPage, { attachTo: document.body });
    return wrapper;
  };
  const withItems = (...items: Array<Record<string, unknown>>) =>
    v2.listTransactions.mockResolvedValue({ items, nextCursor: null });
  const openRowAction = async (testId: string) => {
    await wrapper!.get('[data-testid="action-menu-trigger"]').trigger('click');
    await wrapper!.get(`[data-testid="${testId}"]`).trigger('click');
  };
  const confirmDialog = async () => {
    await wrapper!.get('[data-confirm]').trigger('click');
    await flushPromises();
  };
  const submitEditForm = async (comment: string) => {
    const input = document.querySelector('input[name="comment"]') as HTMLInputElement;
    input.value = comment;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    const form = document.querySelector('.operation-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
  };

  beforeEach(() => {
    auth.currentData.value = {
      user: { email: 'owner@harmofin.test' },
      workspaces: [
        {
          role: 'OWNER',
          budgets: [
            { id: 'budget-id', name: 'Бюджет', primaryCurrency: 'RUB', planModelVersion: 2 },
          ],
        },
      ],
    };
    vi.clearAllMocks();
    useOperationDialogs().close();
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    v2.listTransactions.mockResolvedValue({ items: [], nextCursor: null });
    v2.getTransaction.mockResolvedValue(expense);
    v1.listTransactionAudit.mockResolvedValue([]);
    reference.load.mockResolvedValue(undefined);
    useToast().clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it('reads the journal from the v2 API and opens the shared type picker from the create button', async () => {
    mountPage();
    await flushPromises();

    expect(v2.listTransactions).toHaveBeenCalledWith('budget-id', {});
    await wrapper!.get('[data-action="create-operation"]').trigger('click');
    expect(useOperationDialogs().openDialog.value).toBe('choose');
  });

  it('sends the chosen filters in the API vocabulary', async () => {
    routeQuery.status = 'DRAFT';
    routeQuery.from = '2026-09-01';
    mountPage();
    await flushPromises();
    expect(v2.listTransactions).toHaveBeenLastCalledWith('budget-id', {
      status: 'DRAFT',
      from: '2026-09-01',
    });

    await wrapper!.get('[data-testid="type-tab-EXPENSE"]').trigger('click');
    await flushPromises();

    expect(v2.listTransactions).toHaveBeenLastCalledWith('budget-id', {
      type: 'EXPENSE',
      status: 'DRAFT',
      from: '2026-09-01',
    });
  });

  it('reloads the journal after the shared quick-add dialog closes', async () => {
    mountPage();
    await flushPromises();
    expect(v2.listTransactions).toHaveBeenCalledTimes(1);

    const dialogs = useOperationDialogs();
    dialogs.openOperation('EXPENSE');
    await wrapper!.vm.$nextTick();
    dialogs.close();
    await flushPromises();

    expect(v2.listTransactions).toHaveBeenCalledTimes(2);
  });

  it('lists operations as rows grouped by day and pages with the cursor', async () => {
    v2.listTransactions.mockResolvedValueOnce({ items: [expense], nextCursor: 'cursor-1' });
    v2.listTransactions.mockResolvedValueOnce({
      items: [{ ...expense, id: '00000000-0000-4000-8000-000000000002', occurredOn: '2026-09-04' }],
      nextCursor: null,
    });
    mountPage();
    await flushPromises();
    expect(wrapper!.findAll('[data-testid="operation-group-label"]').length).toBeGreaterThan(0);
    expect(wrapper!.findAll('[data-testid="list-row-select"]')).toHaveLength(1);

    const more = wrapper!.findAll('button').find((button) => button.text() === 'Показать ещё');
    await more!.trigger('click');
    await flushPromises();

    expect(v2.listTransactions).toHaveBeenLastCalledWith('budget-id', { cursor: 'cursor-1' });
    expect(wrapper!.findAll('[data-testid="list-row-select"]')).toHaveLength(2);
    expect(wrapper!.findAll('button').some((button) => button.text() === 'Показать ещё')).toBe(
      false,
    );
  });

  it('opens the drawer from a row and reads the audit from the model-agnostic route', async () => {
    withItems(expense);
    mountPage();
    await flushPromises();

    await wrapper!.get('[data-testid="list-row-select"]').trigger('click');
    await flushPromises();

    expect(wrapper!.find('[data-testid="drawer"]').exists()).toBe(true);
    expect(v1.listTransactionAudit).toHaveBeenCalledWith('budget-id', expense.id);
  });

  it('opens the drawer for the operation named in the query through the v2 read', async () => {
    routeQuery.operationId = expense.id;
    mountPage();
    await flushPromises();

    expect(v2.getTransaction).toHaveBeenCalledWith('budget-id', expense.id);
    expect(wrapper!.find('[data-testid="drawer"]').exists()).toBe(true);
  });

  it('announces a load failure in Russian and retries', async () => {
    v2.listTransactions.mockRejectedValueOnce(new Error('network'));
    mountPage();
    await flushPromises();

    expect(wrapper!.get('[role="alert"]').text()).toContain('Не удалось загрузить операции');

    const retry = wrapper!.findAll('button').find((button) => button.text() === 'Повторить');
    await retry!.trigger('click');
    await flushPromises();

    expect(v2.listTransactions).toHaveBeenCalledTimes(2);
  });

  it('edits a field through PATCH with only that field, after a confirmation', async () => {
    withItems(expense);
    v2.updateTransaction.mockResolvedValue(lifecycle('CONFIRMED'));
    mountPage();
    await flushPromises();

    await openRowAction('row-edit');
    await flushPromises();
    expect((document.querySelector('input[name="amount"]') as HTMLInputElement).value).toBe(
      '1250.00',
    );
    await submitEditForm('Заметка');
    await confirmDialog();

    expect(v2.updateTransaction).toHaveBeenCalledWith(
      'budget-id',
      expense.id,
      { comment: 'Заметка' },
      expect.any(String),
    );
    expect(useToast().toasts.value.at(-1)?.title).toBe('Операция обновлена');
    expect(v2.listTransactions).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.operation-form')).toBeNull();
  });

  it('keeps the form open and shows field-level and form-level errors on a rejected edit', async () => {
    withItems(expense);
    v2.updateTransaction.mockRejectedValue(
      new ApiRequestError(400, {
        code: 'VALIDATION_FAILED',
        detail: 'technical',
        fieldErrors: [{ field: 'amount', message: 'Сумма должна быть больше нуля.', code: 'x' }],
      }),
    );
    mountPage();
    await flushPromises();

    await openRowAction('row-edit');
    await flushPromises();
    await submitEditForm('Заметка');
    await confirmDialog();

    expect(document.body.textContent).toContain('Сумма должна быть больше нуля.');
    expect(document.body.textContent).toContain('Проверьте введённые данные.');
    expect(document.body.textContent).not.toContain('technical');
    expect(document.querySelector('.operation-form')).not.toBeNull();
  });

  it('retries a failed edit with the same key, and a changed edit with a new one', async () => {
    withItems(expense);
    v2.updateTransaction.mockRejectedValue(new Error('network'));
    mountPage();
    await flushPromises();

    await openRowAction('row-edit');
    await flushPromises();
    await submitEditForm('Заметка');
    await confirmDialog();
    await submitEditForm('Заметка');
    await confirmDialog();
    await submitEditForm('Другая заметка');
    await confirmDialog();

    const keys = v2.updateTransaction.mock.calls.map((call) => call[3]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('deletes through the v2 API once even when the confirmation is clicked twice', async () => {
    withItems(expense);
    v2.deleteTransaction.mockResolvedValue(lifecycle('DELETED'));
    mountPage();
    await flushPromises();

    await openRowAction('row-delete');
    const button = wrapper!.get('[data-confirm]');
    await Promise.all([button.trigger('click'), button.trigger('click')]);
    await flushPromises();

    expect(v2.deleteTransaction).toHaveBeenCalledTimes(1);
    expect(v2.deleteTransaction).toHaveBeenCalledWith('budget-id', expense.id, expect.any(String));
    expect(useToast().toasts.value.at(-1)?.title).toBe('Операция удалена');
    expect(v2.listTransactions).toHaveBeenCalledTimes(2);
  });

  it('says in Russian why an income with assignments cannot be deleted', async () => {
    withItems({ ...expense, transactionType: 'INCOME', envelopeId: null });
    v2.deleteTransaction.mockRejectedValue(
      new ApiRequestError(409, { code: 'SOURCE_EXHAUSTED', detail: 'technical' }),
    );
    mountPage();
    await flushPromises();

    await openRowAction('row-delete');
    await confirmDialog();

    const toast = useToast().toasts.value.at(-1);
    expect(toast?.tone).toBe('error');
    expect(toast?.description).toContain('На этот доход назначены средства');
  });

  it('restores a deleted operation through the v2 API', async () => {
    routeQuery.status = 'DELETED';
    withItems({ ...expense, status: 'DELETED', deletedAt: '2026-09-06T00:00:00.000Z' });
    v2.restoreTransaction.mockResolvedValue(lifecycle('CONFIRMED'));
    mountPage();
    await flushPromises();

    await openRowAction('row-restore');
    await confirmDialog();

    expect(v2.restoreTransaction).toHaveBeenCalledWith('budget-id', expense.id, expect.any(String));
    expect(useToast().toasts.value.at(-1)?.title).toBe('Операция восстановлена');
  });

  it('shows no leftovers of the old model: no unallocated banner, no confirm or cancel', async () => {
    withItems({ ...expense, transactionType: 'INCOME', envelopeId: null, status: 'DRAFT' });
    mountPage();
    await flushPromises();

    await wrapper!.get('[data-testid="action-menu-trigger"]').trigger('click');

    expect(wrapper!.text()).not.toContain('Не распределено');
    expect(wrapper!.find('[data-testid="row-confirm"]').exists()).toBe(false);
    expect(wrapper!.find('[data-testid="row-cancel"]').exists()).toBe(false);
    expect(wrapper!.find('[data-testid="row-edit"]').exists()).toBe(true);
  });

  it('lets the owner download the v2 CSV export', async () => {
    v2.exportTransactions.mockResolvedValue(new Blob(['csv']));
    mountPage();
    await flushPromises();

    await wrapper!.get('[data-action="download-csv"]').trigger('click');
    await flushPromises();

    expect(v2.exportTransactions).toHaveBeenCalledWith('budget-id');
    expect(wrapper!.get('[role="status"]').text()).toContain('Экспорт CSV подготовлен');
  });

  it('announces a CSV download error to the owner', async () => {
    v2.exportTransactions.mockRejectedValue(
      new ApiRequestError(422, { code: 'EXPORT_LIMIT_EXCEEDED', detail: 'technical' }),
    );
    mountPage();
    await flushPromises();

    await wrapper!.get('[data-action="download-csv"]').trigger('click');
    await flushPromises();

    expect(wrapper!.get('[role="alert"]').text()).toContain('Не удалось скачать CSV');
  });

  it('hides CSV download from an editor', async () => {
    auth.currentData.value!.workspaces[0]!.role = 'EDITOR';
    mountPage();
    await flushPromises();

    expect(wrapper!.find('[data-action="download-csv"]').exists()).toBe(false);
  });

  it('shows skeletons while the first page is loading', async () => {
    v2.listTransactions.mockReturnValueOnce(new Promise(() => {}));
    mountPage();
    await wrapper!.vm.$nextTick();

    expect(wrapper!.get('[data-testid="operations-loading"]').attributes('aria-busy')).toBe('true');
    expect(wrapper!.findAll('[data-testid="skeleton-item"]').length).toBeGreaterThan(0);
  });

  it('separates an empty result from an empty journal', async () => {
    mountPage();
    await flushPromises();
    expect(wrapper!.text()).toContain('Операций пока нет');

    await wrapper!.get('[data-testid="type-tab-EXPENSE"]').trigger('click');
    await flushPromises();

    expect(wrapper!.text()).toContain('Ничего не найдено');
  });

  it('renders no-budget empty state without inventing budget id', async () => {
    auth.currentData.value = null;
    mountPage();
    await flushPromises();

    expect(wrapper!.text()).toContain('Бюджет не выбран');
    expect(v2.listTransactions).not.toHaveBeenCalled();
  });
});
