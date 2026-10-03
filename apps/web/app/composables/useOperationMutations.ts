import { readonly, ref, type Ref } from 'vue';

import {
  useEnvelopePlanV2,
  type TransactionJournalV2Item,
  type TransactionV2LifecycleResponse,
} from './useEnvelopePlanV2.js';
import { useToast } from './useToast.js';
import { v2ErrorMessage } from './useV2Error.js';

// Journal actions on the Envelope Plan v2.2 API. There is no confirm or cancel:
// a v2 fact is created CONFIRMED (or DRAFT, edited in place) and leaves the books
// only through delete, which restore undoes.
export type OperationAction = 'delete' | 'restore';

type ActionCopy = { success: string; failure: string };

const COPY: Record<OperationAction, ActionCopy> = {
  delete: { success: 'Операция удалена', failure: 'Не удалось удалить операцию' },
  restore: { success: 'Операция восстановлена', failure: 'Не удалось восстановить операцию' },
};

// An income that still funds envelopes cannot be deleted until the assignments
// are reduced; the shared "source exhausted" text speaks about funding instead.
const OVERRIDES: Record<string, string> = {
  RESOURCE_NOT_FOUND: 'Операция не найдена. Обновите журнал.',
  SOURCE_EXHAUSTED:
    'На этот доход назначены средства. Сначала уменьшите или отмените назначения этого дохода.',
};

type RowState = Pick<TransactionJournalV2Item, 'status' | 'accountingModelVersion'>;

// A fact made before the move to model 2: the server answers every edit with
// 409 LEGACY_CORRECTION_REQUIRED, so the screen only shows it.
export function isLegacyTransaction(
  transaction: Pick<RowState, 'accountingModelVersion'>,
): boolean {
  return transaction.accountingModelVersion === 1;
}

export function canEditTransaction(transaction: RowState): boolean {
  return (
    !isLegacyTransaction(transaction) &&
    (transaction.status === 'CONFIRMED' || transaction.status === 'DRAFT')
  );
}

export function availableActions(transaction: RowState): OperationAction[] {
  if (isLegacyTransaction(transaction)) return [];
  return transaction.status === 'DELETED' ? ['restore'] : ['delete'];
}

export interface OperationMutations {
  pending: Readonly<Ref<boolean>>;
  // The last rejection, kept so a caller can react to a specific server code.
  lastError: Readonly<Ref<unknown>>;
  remove: (
    budgetId: string,
    transaction: TransactionJournalV2Item,
  ) => Promise<TransactionV2LifecycleResponse | null>;
  restore: (
    budgetId: string,
    transaction: TransactionJournalV2Item,
  ) => Promise<TransactionV2LifecycleResponse | null>;
  availableActions: (transaction: RowState) => OperationAction[];
}

export function useOperationMutations(): OperationMutations {
  const api = useEnvelopePlanV2();
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
    action: OperationAction,
    transaction: TransactionJournalV2Item,
    call: (idempotencyKey: string) => Promise<TransactionV2LifecycleResponse>,
  ): Promise<TransactionV2LifecycleResponse | null> {
    // A double click must not send a second request while the first is in flight.
    if (pending.value) return null;
    pending.value = true;
    const idempotencyKey = keyFor(action, transaction.id);
    try {
      const result = await call(idempotencyKey);
      keys.delete(`${action}:${transaction.id}`);
      lastError.value = null;
      const warnings = result.warnings.map((warning) => warning.detail).join(' ');
      push({
        tone: 'success',
        title: COPY[action].success,
        ...(warnings ? { description: warnings } : {}),
      });
      return result;
    } catch (error) {
      lastError.value = error;
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
    lastError: readonly(lastError),
    remove: (budgetId, transaction) =>
      run('delete', transaction, (key) => api.deleteTransaction(budgetId, transaction.id, key)),
    restore: (budgetId, transaction) =>
      run('restore', transaction, (key) => api.restoreTransaction(budgetId, transaction.id, key)),
    availableActions,
  };
}
