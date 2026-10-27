import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';

const mutations = {
  pending: ref(false),
  update: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
};

const roleState = vi.hoisted(() => ({ role: 'OWNER' as 'OWNER' | 'EDITOR' | 'VIEWER' | null }));

vi.mock('../../composables/useTransferMutations.js', () => ({
  useTransferMutations: () => mutations,
}));
// usePermissions reads the user from useAuth; the dialogs only need the id or null.
vi.mock('../../composables/useAuth.js', async () => {
  const { computed } = await import('vue');
  return { useAuth: () => ({ currentUser: computed(() => null) }) };
});
vi.mock('../../composables/useActiveWorkspace.js', () => ({
  useActiveWorkspace: () => ({ role: computed(() => roleState.role) }),
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
  overrides: Partial<{
    transfer: TransferJournalItem;
    canRestore: boolean;
    intent: 'view' | 'edit' | 'delete' | 'restore';
  }> = {},
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
      ...(overrides.intent ? { intent: overrides.intent } : {}),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mutations.pending.value = false;
  roleState.role = 'OWNER';
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

  it('shows the author of the transfer as a row in the details list', () => {
    const wrapper = mountDialog({
      transfer: {
        ...transfer,
        createdBy: { userId: 'u1', displayName: 'Алия', isActiveMember: true },
      },
    });
    const rows = wrapper.findAll('.transfer-dialog__rows > div');
    const authorRow = rows.find((row) => row.get('dt').text() === 'Автор');
    expect(authorRow?.get('dd').text()).toBe('Алия');
  });

  it('shows no author line when the journal did not send one', () => {
    const wrapper = mountDialog();
    expect(wrapper.text()).not.toContain('Автор');
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

  describe('opened from the row menu', () => {
    it('edit intent opens the edit form without the detail card', () => {
      const wrapper = mountDialog({ intent: 'edit' });
      expect(wrapper.find('[data-testid="direct-transfer-form"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="transfer-dialog-edit"]').exists()).toBe(false);
    });

    it('delete intent asks for confirmation and removes on confirm', async () => {
      mutations.remove.mockResolvedValueOnce({ ...transfer, status: 'DELETED' });
      const wrapper = mountDialog({ intent: 'delete' });
      expect(wrapper.text()).toContain('Удалить перевод?');
      expect(wrapper.find('[data-testid="transfer-dialog-delete"]').exists()).toBe(false);
      await wrapper.find('dialog[open] button[data-confirm]').trigger('click');
      await flushPromises();
      expect(mutations.remove).toHaveBeenCalledWith('b1', transfer);
      expect(wrapper.emitted('changed')).toHaveLength(1);
    });

    it('cancelling the confirmation closes the whole dialog', async () => {
      const wrapper = mountDialog({ intent: 'delete' });
      await wrapper.find('dialog[open] .ui-confirm-dialog__button--secondary').trigger('click');
      expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('restore intent asks to restore', () => {
      const wrapper = mountDialog({
        transfer: { ...transfer, status: 'DELETED' },
        canRestore: true,
        intent: 'restore',
      });
      expect(wrapper.text()).toContain('Восстановить перевод?');
    });

    it('restore intent without the right to restore only shows the card', () => {
      const wrapper = mountDialog({
        transfer: { ...transfer, status: 'DELETED' },
        canRestore: false,
        intent: 'restore',
      });
      expect(wrapper.find('dialog[open] button[data-confirm]').exists()).toBe(false);
      expect(wrapper.text()).toContain('Удалён');
    });
  });

  it('hides edit and delete for a viewer, who cannot write transfers', () => {
    roleState.role = 'VIEWER';
    const wrapper = mountDialog();

    expect(wrapper.find('[data-testid="transfer-dialog-edit"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="transfer-dialog-delete"]').exists()).toBe(false);
    // No footer action at all: the modal must not render an empty padded bar.
    expect(wrapper.find('.modal__footer').exists()).toBe(false);
  });
});
