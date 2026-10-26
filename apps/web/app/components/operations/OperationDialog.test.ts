import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';

const api = {
  listTransactionAudit: vi.fn(),
  listTransactionAllocations: vi.fn(),
};

const roleState = vi.hoisted(() => ({ role: 'OWNER' as 'OWNER' | 'EDITOR' | 'VIEWER' | null }));

vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));
vi.mock('../../composables/useActiveWorkspace.js', () => ({
  useActiveWorkspace: () => ({ role: computed(() => roleState.role) }),
}));

import OperationDialog from './OperationDialog.vue';
import { useToast } from '../../composables/useToast.js';
import type { TransactionJournalV2Item } from '../../composables/useEnvelopePlanV2.js';

const transaction: TransactionJournalV2Item = {
  id: 'transaction-id',
  budgetId: 'budget-id',
  accountingModelVersion: 2,
  transactionType: 'EXPENSE',
  status: 'CONFIRMED',
  amountMinor: '245000',
  currency: 'RUB',
  occurredOn: '2026-09-14',
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  sourceDescription: null,
  merchantName: 'Супермаркет',
  comment: 'Еженедельная закупка',
  planOccurrenceIds: [],
  confirmedAt: '2026-09-14T10:00:00.000Z',
  cancelledAt: null,
  deletedAt: null,
  createdAt: '2026-09-14T10:00:00.000Z',
};

const mountDialog = (overrides: Partial<TransactionJournalV2Item> = {}, busy = false) =>
  mount(OperationDialog, {
    props: {
      transaction: { ...transaction, ...overrides },
      budgetId: 'budget-id',
      accountName: 'Основная карта',
      categoryName: 'Продукты',
      envelopeName: 'Текущие',
      busy,
    },
    attachTo: document.body,
    global: { stubs: { teleport: true } },
  });

beforeEach(() => {
  vi.clearAllMocks();
  useToast().clear();
  api.listTransactionAudit.mockResolvedValue([]);
  roleState.role = 'OWNER';
});

describe('OperationDialog', () => {
  it('shows what the operation is', async () => {
    const wrapper = mountDialog();
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain('Продукты');
    expect(text).toContain('Основная карта');
    expect(text).toContain('Текущие');
    expect(text).toContain('Еженедельная закупка');
    wrapper.unmount();
  });

  it('shows the author of the operation', async () => {
    const wrapper = mountDialog({
      createdBy: { userId: 'u1', displayName: 'Алия', isActiveMember: true },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Автор: Алия');
    wrapper.unmount();
  });

  it('shows no author line when the journal did not send one', async () => {
    const wrapper = mountDialog();
    await flushPromises();

    expect(wrapper.text()).not.toContain('Автор');
    wrapper.unmount();
  });

  it('loads only the audit history when it opens, no allocations', async () => {
    const wrapper = mountDialog();
    await flushPromises();

    expect(api.listTransactionAudit).toHaveBeenCalledWith('budget-id', 'transaction-id');
    expect(api.listTransactionAllocations).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('Распределения дохода');
    wrapper.unmount();
  });

  it('announces when the history cannot be loaded', async () => {
    api.listTransactionAudit.mockRejectedValue(new Error('network'));
    const wrapper = mountDialog();
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('Не удалось загрузить');
    wrapper.unmount();
  });

  it('writes the history in words instead of raw codes', async () => {
    api.listTransactionAudit.mockResolvedValue([
      {
        id: 'audit-id',
        createdAt: '2026-09-14T10:28:07.826Z',
        actor: { id: 'user-id', displayName: null, email: 'owner@harmofin.test' },
        entityType: 'transaction',
        entityId: 'transaction-id',
        action: 'CONFIRMED',
        source: 'API',
        oldValues: null,
        newValues: null,
      },
    ]);
    const wrapper = mountDialog();
    await flushPromises();

    const entry = wrapper.get('[data-testid="operation-dialog-audit-event"]').text();
    expect(entry).toContain('Подтверждена');
    expect(entry).toContain('owner@harmofin.test');
    expect(entry).not.toContain('CONFIRMED');
    expect(entry).not.toContain('2026-09-14T10:28:07.826Z');
    wrapper.unmount();
  });

  it('has no confirm or cancel: a v2 fact is edited, deleted or restored', async () => {
    const wrapper = mountDialog({ status: 'DRAFT' });
    await flushPromises();

    expect(wrapper.text()).toContain('Черновик');
    expect(wrapper.find('[data-testid="operation-dialog-confirm"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="operation-dialog-cancel"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="operation-dialog-edit"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('asks the page to edit, delete or restore instead of doing it itself', async () => {
    const wrapper = mountDialog();
    await flushPromises();

    await wrapper.get('[data-testid="operation-dialog-edit"]').trigger('click');
    await wrapper.get('[data-testid="operation-dialog-delete"]').trigger('click');

    expect(wrapper.emitted('edit')).toHaveLength(1);
    expect(wrapper.emitted('request-delete')).toHaveLength(1);
    wrapper.unmount();

    const deleted = mountDialog({ status: 'DELETED' });
    await flushPromises();
    await deleted.get('[data-testid="operation-dialog-restore"]').trigger('click');
    expect(deleted.emitted('request-restore')).toHaveLength(1);
    deleted.unmount();
  });

  it('offers restore for a deleted operation and nothing else', async () => {
    const wrapper = mountDialog({ status: 'DELETED' });
    await flushPromises();

    expect(wrapper.find('[data-testid="operation-dialog-edit"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="operation-dialog-delete"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="operation-dialog-restore"]')).toBeTruthy();
    wrapper.unmount();
  });

  it('disables the actions while a request is running', async () => {
    const wrapper = mountDialog({}, true);
    await flushPromises();

    expect(
      wrapper.get('[data-testid="operation-dialog-delete"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('[data-testid="operation-dialog-edit"]').attributes('disabled'),
    ).toBeDefined();
    wrapper.unmount();
  });

  it('marks a payment made against a plan', async () => {
    const wrapper = mountDialog({ planOccurrenceIds: ['occurrence-id'] });
    await flushPromises();

    expect(wrapper.text()).toContain('По плану');
    wrapper.unmount();
  });

  it('hides edit and delete for a viewer, who cannot write operations', async () => {
    roleState.role = 'VIEWER';
    const wrapper = mountDialog();
    await flushPromises();

    expect(wrapper.find('[data-testid="operation-dialog-edit"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="operation-dialog-delete"]').exists()).toBe(false);
    // No footer action at all: the modal must not render an empty padded bar.
    expect(wrapper.find('.modal__footer').exists()).toBe(false);
    wrapper.unmount();
  });
});
