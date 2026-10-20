import { readonly, ref, type Ref } from 'vue';

import {
  useEnvelopePlanV2,
  type TransferJournalItem,
  type UpdateDirectTransferRequest,
} from './useEnvelopePlanV2.js';
import { useToast } from './useToast.js';
import { v2ErrorMessage } from './useV2Error.js';

const OVERRIDES: Record<string, string> = {
  RESOURCE_NOT_FOUND: 'Перевод не найден. Обновите журнал.',
  INSUFFICIENT_BALANCE: 'На счёте недостаточно средств для этого изменения.',
  REFERENCE_INVALID: 'Счёт перевода в архиве. Верните счёт из архива, чтобы восстановить перевод.',
};

const COPY = {
  delete: { success: 'Перевод удалён', failure: 'Не удалось удалить перевод' },
  restore: { success: 'Перевод восстановлен', failure: 'Не удалось восстановить перевод' },
} as const;

export interface TransferMutations {
  pending: Readonly<Ref<boolean>>;
  /** Throws the API error so the edit form can show field errors. */
  update: (
    budgetId: string,
    transferId: string,
    input: UpdateDirectTransferRequest,
  ) => Promise<TransferJournalItem>;
  remove: (budgetId: string, transfer: TransferJournalItem) => Promise<TransferJournalItem | null>;
  restore: (budgetId: string, transfer: TransferJournalItem) => Promise<TransferJournalItem | null>;
}

export function useTransferMutations(): TransferMutations {
  const api = useEnvelopePlanV2();
  const { push } = useToast();
  const pending = ref(false);
  // A retry of the same request must carry the same key, or the server would
  // treat it as a second money movement.
  const keys = new Map<string, string>();

  function keyFor(operation: string): string {
    const existing = keys.get(operation);
    if (existing) return existing;
    const created = crypto.randomUUID();
    keys.set(operation, created);
    return created;
  }

  async function update(
    budgetId: string,
    transferId: string,
    input: UpdateDirectTransferRequest,
  ): Promise<TransferJournalItem> {
    const operation = `update:${transferId}:${JSON.stringify(input)}`;
    pending.value = true;
    try {
      const result = await api.updateTransfer(budgetId, transferId, input, keyFor(operation));
      keys.delete(operation);
      push({ tone: 'success', title: 'Перевод обновлён' });
      return result;
    } finally {
      pending.value = false;
    }
  }

  async function lifecycle(
    action: 'delete' | 'restore',
    budgetId: string,
    transfer: TransferJournalItem,
  ): Promise<TransferJournalItem | null> {
    if (pending.value) return null;
    const operation = `${action}:${transfer.id}`;
    pending.value = true;
    try {
      const key = keyFor(operation);
      const result =
        action === 'delete'
          ? await api.deleteTransfer(budgetId, transfer.id, key)
          : await api.restoreTransfer(budgetId, transfer.id, key);
      keys.delete(operation);
      push({ tone: 'success', title: COPY[action].success });
      return result;
    } catch (error) {
      push({
        tone: 'error',
        title: COPY[action].failure,
        description: v2ErrorMessage(error, 'Повторите попытку.', OVERRIDES),
      });
      return null;
    } finally {
      pending.value = false;
    }
  }

  return {
    pending: readonly(pending),
    update,
    remove: (budgetId, transfer) => lifecycle('delete', budgetId, transfer),
    restore: (budgetId, transfer) => lifecycle('restore', budgetId, transfer),
  };
}
