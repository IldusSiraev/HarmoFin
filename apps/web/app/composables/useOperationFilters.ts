import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { navigateTo, useRoute } from '#imports';

import type { TransactionJournalV2Query } from './useEnvelopePlanV2.js';

// Exactly the filters GET /api/v2/budgets/:id/transactions accepts. The order
// (newest first) is fixed by the server, so there is no search or sort here.
export interface OperationFilters {
  type: '' | 'INCOME' | 'EXPENSE';
  status: '' | 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED';
  from: string;
  to: string;
  accountId: string;
  categoryId: string;
  envelopeId: string;
}

const DEFAULTS: OperationFilters = {
  type: '',
  status: '',
  from: '',
  to: '',
  accountId: '',
  categoryId: '',
  envelopeId: '',
};

const TYPES: ReadonlyArray<OperationFilters['type']> = ['INCOME', 'EXPENSE'];
const STATUSES: ReadonlyArray<OperationFilters['status']> = [
  'DRAFT',
  'CONFIRMED',
  'CANCELLED',
  'DELETED',
];

const FILTER_KEYS = Object.keys(DEFAULTS) as Array<keyof OperationFilters>;

function readString(query: Record<string, unknown>, key: string): string {
  const value = query[key];
  return typeof value === 'string' ? value : '';
}

// Old links may carry a value the strict v2 API answers with 400 (status=all,
// a made-up type): such a value is ignored instead of breaking the journal.
function readOneOf<T extends string>(
  query: Record<string, unknown>,
  key: string,
  allowed: ReadonlyArray<T>,
  fallback: '' | T,
): '' | T {
  const value = readString(query, key);
  return (allowed as ReadonlyArray<string>).includes(value) ? (value as T) : fallback;
}

export function useOperationFilters(): {
  filters: Ref<OperationFilters>;
  activeCount: ComputedRef<number>;
  toListInput: () => TransactionJournalV2Query;
  set: <K extends keyof OperationFilters>(key: K, value: OperationFilters[K]) => void;
  reset: () => void;
  syncQuery: () => Promise<void>;
} {
  const route = useRoute();
  const query = route.query as Record<string, unknown>;

  const filters = ref<OperationFilters>({
    type: readOneOf(query, 'type', TYPES, ''),
    status: readOneOf(query, 'status', STATUSES, ''),
    from: readString(query, 'from'),
    to: readString(query, 'to'),
    accountId: readString(query, 'accountId'),
    categoryId: readString(query, 'categoryId'),
    envelopeId: readString(query, 'envelopeId'),
  });

  const activeCount = computed(
    () => FILTER_KEYS.filter((key) => filters.value[key] !== DEFAULTS[key]).length,
  );

  function toListInput(): TransactionJournalV2Query {
    const current = filters.value;
    return {
      ...(current.type ? { type: current.type } : {}),
      ...(current.status ? { status: current.status } : {}),
      ...(current.from ? { from: current.from } : {}),
      ...(current.to ? { to: current.to } : {}),
      ...(current.accountId ? { accountId: current.accountId } : {}),
      ...(current.categoryId ? { categoryId: current.categoryId } : {}),
      ...(current.envelopeId ? { envelopeId: current.envelopeId } : {}),
    };
  }

  async function syncQuery(): Promise<void> {
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(filters.value)) {
      if (value !== DEFAULTS[key as keyof OperationFilters] && value !== '') next[key] = value;
    }
    await navigateTo({ path: route.path, query: next }, { replace: true });
  }

  function set<K extends keyof OperationFilters>(key: K, value: OperationFilters[K]): void {
    filters.value[key] = value;
    void syncQuery();
  }

  function reset(): void {
    filters.value = { ...DEFAULTS };
    void syncQuery();
  }

  return { filters, activeCount, toListInput, set, reset, syncQuery };
}
