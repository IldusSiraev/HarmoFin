import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { navigateTo, useRoute } from '#imports';

import type { TransactionListInput } from './useBudgetReferenceData.js';

export interface OperationFilters {
  search: string;
  type: '' | 'INCOME' | 'EXPENSE';
  status: '' | 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED' | 'all';
  from: string;
  to: string;
  cycleStart: string;
  periodStart: string;
  accountId: string;
  categoryId: string;
  envelopeId: string;
  planId: string;
  sortBy: 'occurredOn' | 'amount';
  sortDirection: 'asc' | 'desc';
}

const DEFAULTS: OperationFilters = {
  search: '',
  type: '',
  status: '',
  from: '',
  to: '',
  cycleStart: '',
  periodStart: '',
  accountId: '',
  categoryId: '',
  envelopeId: '',
  planId: '',
  sortBy: 'occurredOn',
  sortDirection: 'desc',
};

// Sorting is not a filter: it never contributes to the "active filters" badge.
const FILTER_KEYS = [
  'search',
  'type',
  'status',
  'from',
  'to',
  'cycleStart',
  'periodStart',
  'accountId',
  'categoryId',
  'envelopeId',
  'planId',
] as const satisfies ReadonlyArray<keyof OperationFilters>;

function readString(query: Record<string, unknown>, key: string): string {
  const value = query[key];
  return typeof value === 'string' ? value : '';
}

export function useOperationFilters(): {
  filters: Ref<OperationFilters>;
  activeCount: ComputedRef<number>;
  isGrouped: ComputedRef<boolean>;
  toListInput: () => TransactionListInput;
  set: <K extends keyof OperationFilters>(key: K, value: OperationFilters[K]) => void;
  reset: () => void;
  syncQuery: () => Promise<void>;
} {
  const route = useRoute();
  const query = route.query as Record<string, unknown>;

  const filters = ref<OperationFilters>({
    ...DEFAULTS,
    search: readString(query, 'search'),
    type: (readString(query, 'type') || DEFAULTS.type) as OperationFilters['type'],
    status: (readString(query, 'status') || DEFAULTS.status) as OperationFilters['status'],
    from: readString(query, 'from'),
    to: readString(query, 'to'),
    cycleStart: readString(query, 'cycleStart'),
    periodStart: readString(query, 'periodStart'),
    accountId: readString(query, 'accountId'),
    categoryId: readString(query, 'categoryId'),
    envelopeId: readString(query, 'envelopeId'),
    planId: readString(query, 'planId'),
    sortBy: (readString(query, 'sortBy') || DEFAULTS.sortBy) as OperationFilters['sortBy'],
    sortDirection: (readString(query, 'sortDirection') ||
      DEFAULTS.sortDirection) as OperationFilters['sortDirection'],
  });

  const activeCount = computed(
    () => FILTER_KEYS.filter((key) => filters.value[key] !== DEFAULTS[key]).length,
  );

  const isGrouped = computed(() => filters.value.sortBy === 'occurredOn');

  function toListInput(): TransactionListInput {
    const current = filters.value;
    return {
      ...(current.search ? { search: current.search } : {}),
      ...(current.type ? { type: current.type } : {}),
      ...(current.status ? { status: current.status } : {}),
      ...(current.from ? { from: current.from } : {}),
      ...(current.to ? { to: current.to } : {}),
      ...(current.cycleStart ? { cycleStart: current.cycleStart } : {}),
      ...(current.periodStart ? { periodStart: current.periodStart } : {}),
      ...(current.accountId ? { accountId: current.accountId } : {}),
      ...(current.categoryId ? { categoryId: current.categoryId } : {}),
      ...(current.envelopeId ? { envelopeId: current.envelopeId } : {}),
      ...(current.planId ? { planId: current.planId } : {}),
      sortBy: current.sortBy,
      sortDirection: current.sortDirection,
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

  return { filters, activeCount, isGrouped, toListInput, set, reset, syncQuery };
}
