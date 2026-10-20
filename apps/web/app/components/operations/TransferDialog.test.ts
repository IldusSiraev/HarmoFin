import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const mutations = {
  pending: ref(false),
  update: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
};

vi.mock('../../composables/useTransferMutations.js', () => ({
  useTransferMutations: () => mutations,
}));

import TransferDialog from './TransferDialog.vue';
import { ApiRequestError } from '../../composables/useApiClient.js';
import type { TransferJournalItem } from '../../composables/useEnvelopePlanV2.js';

const transfer: TransferJournalItem = {
  kind: 'TRANSFER',
  id: 't1',
  budgetId: 'b1',
  status: 'CONFIRMED',
  amountMinor: '150000',
  currency: 'RUB',
  occurredOn: '2026-10-20',
  sourceAccountId: 'a',
  destinationAccountId: 'b',
  comment: 'Отпуск',
  createdAt: '2026-10-20T10:00:00.000Z',
  deletedAt: null,
};

const accounts = [
  { value: 'a', label: 'Карта' },
  { value: 'b', label: 'Вклад' },
];

const accountNames = new Map([
  ['a', 'Карта'],
  ['b', 'Вклад'],
]);

function mountDialog(
  overrides: Partial<{ transfer: TransferJournalItem; canRestore: boolean }> = {},
) {
  return mount(TransferDialog, {
    attachTo: document.body,
    global: { stubs: { teleport: true } },
    props: {
      transfer: overrides.transfer ?? transfer,
      budgetId: 'b1',
      accounts,
      accountNames,
      canRestore: overrides.canRestore ?? false,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mutations.pending.value = false;
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute('open', '');
  });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.removeAttribute('open');
  });
});

describe('TransferDialog', () => {
  it('shows amount, accounts, date and comment', () => {
    const wrapper = mountDialog();
    expect(wrapper.text()).toContain('Карта');
    expect(wrapper.text()).toContain('Вклад');
    expect(wrapper.text()).toContain('Отпуск');
  });

  it('edits: submits only changed fields and emits changed', async () => {
    mutations.update.mockResolvedValueOnce({ ...transfer, comment: 'Новое' });
    const wrapper = mountDialog();
    await wrapper.find('[data-testid="transfer-dialog-edit"]').trigger('click');
    await wrapper.find('input[name="comment"]').setValue('Новое');
    await wrapper.find('[data-testid="direct-transfer-form"]').trigger('submit');
    await flushPromises();
    expect(mutations.update).toHaveBeenCalledWith('b1', 't1', { comment: 'Новое' });
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('edit with no changes does not call the API', async () => {
    const wrapper = mountDialog();
    await wrapper.find('[data-testid="transfer-dialog-edit"]').trigger('click');
    await wrapper.find('[data-testid="direct-transfer-form"]').trigger('submit');
    await flushPromises();
    expect(mutations.update).not.toHaveBeenCalled();
  });

  it('shows server field errors in the edit form', async () => {
    mutations.update.mockRejectedValueOnce(
      new ApiRequestError(400, {
        code: 'VALIDATION_FAILED',
        detail: 'x',
        fieldErrors: [
          { field: 'amount', message: 'Сумма должна быть больше нуля.', code: 'invalid' },
        ],
      }),
    );
    const wrapper = mountDialog();
    await wrapper.find('[data-testid="transfer-dialog-edit"]').trigger('click');
    await wrapper.find('input[name="comment"]').setValue('x');
    await wrapper.find('[data-testid="direct-transfer-form"]').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Сумма должна быть больше нуля.');
  });

  it('delete asks for confirmation, then removes and emits changed', async () => {
    mutations.remove.mockResolvedValueOnce({ ...transfer, status: 'DELETED' });
    const wrapper = mountDialog();
    await wrapper.find('[data-testid="transfer-dialog-delete"]').trigger('click');
    expect(wrapper.text()).toContain('Удалить перевод?');
    expect(wrapper.text()).toContain(
      'Перевод останется в истории, но перестанет влиять на балансы счетов.',
    );
    await wrapper.find('button[data-confirm]').trigger('click');
    await flushPromises();
    expect(mutations.remove).toHaveBeenCalledWith('b1', transfer);
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('a deleted transfer offers restore only to the owner and no edit', () => {
    const deleted = { ...transfer, status: 'DELETED' as const };
    expect(
      mountDialog({ transfer: deleted, canRestore: true })
        .find('[data-testid="transfer-dialog-restore"]')
        .exists(),
    ).toBe(true);
    expect(
      mountDialog({ transfer: deleted, canRestore: false })
        .find('[data-testid="transfer-dialog-restore"]')
        .exists(),
    ).toBe(false);
    expect(
      mountDialog({ transfer: deleted, canRestore: true })
        .find('[data-testid="transfer-dialog-edit"]')
        .exists(),
    ).toBe(false);
  });
});
