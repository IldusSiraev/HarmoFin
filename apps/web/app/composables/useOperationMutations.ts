import { readonly, ref, type Ref } from 'vue';

import { ApiRequestError } from './useApiClient.js';
import { useBudgetReferenceData, type TransactionDto } from './useBudgetReferenceData.js';
import { useToast } from './useToast.js';

// Deleting an income that still carries confirmed allocations is not a failure:
// the caller has to ask whether those allocations are cancelled or deleted, so
// this code is reported through lastError instead of a toast.
const CALLER_HANDLED_CODES = new Set(['INCOME_HAS_CONFIRMED_ALLOCATIONS']);

export type OperationAction = 'confirm' | 'cancel' | 'delete' | 'restore';

type ActionCopy = { success: string; failure: string };

const COPY: Record<OperationAction | 'deleteWithAllocations', ActionCopy> = {
  confirm: { success: 'Операция подтверждена', failure: 'Не удалось подтвердить операцию' },
  cancel: { success: 'Операция отменена', failure: 'Не удалось отменить операцию' },
  delete: { success: 'Операция удалена', failure: 'Не удалось удалить операцию' },
  restore: { success: 'Операция восстановлена', failure: 'Не удалось восстановить операцию' },
  deleteWithAllocations: {
    success: 'Операция удалена',
    failure: 'Не удалось удалить операцию',
  },
};

// Actions allowed per status. Editing lives in the form, not here.
const ACTIONS: Record<TransactionDto['status'], OperationAction[]> = {
  DRAFT: ['confirm', 'cancel', 'delete'],
  CONFIRMED: ['delete'],
  CANCELLED: ['delete'],
  DELETED: ['restore'],
};

export interface OperationMutations {
  pending: Readonly<Ref<boolean>>;
  // The last rejection, kept so a caller can react to a specific server code —
  // deleting an income with confirmed allocations needs a second decision.
  lastError: Readonly<Ref<unknown>>;
  confirm: (budgetId: string, transaction: TransactionDto) => Promise<TransactionDto | null>;
  cancel: (budgetId: string, transaction: TransactionDto) => Promise<TransactionDto | null>;
  remove: (budgetId: string, transaction: TransactionDto) => Promise<TransactionDto | null>;
  restore: (budgetId: string, transaction: TransactionDto) => Promise<TransactionDto | null>;
  removeWithAllocations: (
    budgetId: string,
    transaction: TransactionDto,
    resolution: 'CANCEL' | 'DELETE',
  ) => Promise<TransactionDto | null>;
  availableActions: (status: TransactionDto['status']) => OperationAction[];
}

export function useOperationMutations(): OperationMutations {
  const api = useBudgetReferenceData();
  const { push } = useToast();
  const pending = ref(false);
  const lastError = ref<unknown>(null);

  // A retry after a network error must carry the same key, or the server would
  // treat it as a second money movement.
  const keys = new Map<string, string>();

  function keyFor(action: string, transactionId: string): string {
    const mapKey = `${action}:${transactionId}`;
    const existing = keys.get(mapKey);
    if (existing !== undefined) return existing;
    const created = crypto.randomUUID();
    keys.set(mapKey, created);
    return created;
  }

  async function run(
    action: keyof typeof COPY,
    transactionId: string,
    call: (idempotencyKey: string) => Promise<TransactionDto>,
  ): Promise<TransactionDto | null> {
    pending.value = true;
    const idempotencyKey = keyFor(action, transactionId);
    try {
      const result = await call(idempotencyKey);
      keys.delete(`${action}:${transactionId}`);
      lastError.value = null;
      push({ tone: 'success', title: COPY[action].success });
      return result;
    } catch (error) {
      lastError.value = error;
      if (error instanceof ApiRequestError && CALLER_HANDLED_CODES.has(error.problem.code)) {
        return null;
      }
      const description = error instanceof Error ? error.message : undefined;
      push({ tone: 'error', title: COPY[action].failure, ...(description ? { description } : {}) });
      return null;
    } finally {
      pending.value = false;
    }
  }

  return {
    pending: readonly(pending),
    lastError: readonly(lastError),
    confirm: (budgetId, transaction) =>
      run('confirm', transaction.id, (key) =>
        api.confirmTransaction(budgetId, transaction.id, key),
      ),
    cancel: (budgetId, transaction) =>
      run('cancel', transaction.id, (key) => api.cancelTransaction(budgetId, transaction.id, key)),
    remove: (budgetId, transaction) =>
      run('delete', transaction.id, (key) => api.deleteTransaction(budgetId, transaction.id, key)),
    restore: (budgetId, transaction) =>
      run('restore', transaction.id, (key) =>
        api.restoreTransaction(budgetId, transaction.id, key),
      ),
    removeWithAllocations: (budgetId, transaction, resolution) =>
      run('deleteWithAllocations', transaction.id, (key) =>
        api.deleteTransactionWithAllocations(
          budgetId,
          transaction.id,
          { allocationResolution: resolution },
          key,
        ),
      ),
    availableActions: (status) => [...ACTIONS[status]],
  };
}
