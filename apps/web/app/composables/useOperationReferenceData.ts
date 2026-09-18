import { ref, type Ref } from 'vue';

import { useAuth } from './useAuth.js';
import {
  useBudgetReferenceData,
  type AccountDto,
  type CategoryDto,
  type EnvelopeDto,
} from './useBudgetReferenceData.js';

export interface ReferenceOption {
  value: string;
  label: string;
}

// Module-level cache: the dialogs open from every screen, and re-reading the
// same three reference lists on each open is pure latency.
const accounts = ref<ReferenceOption[]>([]);
const accountDetails = ref<AccountDto[]>([]);
const categories = ref<CategoryDto[]>([]);
const envelopes = ref<ReferenceOption[]>([]);
const envelopeDetails = ref<EnvelopeDto[]>([]);
const budgetId = ref<string | null>(null);
// Which budget the cached lists belong to: a different budget — or a different
// signed-in user — must never read another one's reference data.
let loadedFor: string | null = null;

export function useOperationReferenceData(): {
  accounts: Ref<ReferenceOption[]>;
  accountDetails: Ref<AccountDto[]>;
  categories: Ref<CategoryDto[]>;
  envelopes: Ref<ReferenceOption[]>;
  envelopeDetails: Ref<EnvelopeDto[]>;
  budgetId: Ref<string | null>;
  load: () => Promise<void>;
  invalidate: () => void;
} {
  const api = useBudgetReferenceData();
  const auth = useAuth();

  async function load(): Promise<void> {
    if (!auth.currentData.value) await auth.loadMe();
    const id = auth.currentData.value?.workspaces[0]?.budgets[0]?.id ?? null;
    budgetId.value = id;
    if (id === null) {
      forget();
      return;
    }
    if (loadedFor === id) return;
    if (loadedFor !== null) forget();

    const [accountList, categoryList, envelopeList] = await Promise.all([
      api.listAccounts(id, 'active'),
      api.listCategories(id, undefined, 'active'),
      api.listEnvelopes(id, 'active'),
    ]);

    accounts.value = accountList.map((account) => ({ value: account.id, label: account.name }));
    accountDetails.value = accountList;
    categories.value = categoryList;
    envelopes.value = envelopeList.map((envelope) => ({
      value: envelope.id,
      label: envelope.name,
    }));
    envelopeDetails.value = envelopeList;
    loadedFor = id;
  }

  function forget(): void {
    accounts.value = [];
    accountDetails.value = [];
    categories.value = [];
    envelopes.value = [];
    envelopeDetails.value = [];
    loadedFor = null;
  }

  // Reference pages call this after they change an account, a category or an
  // envelope, so the next reader sees the new names instead of the cache.
  function invalidate(): void {
    loadedFor = null;
  }

  return {
    accounts,
    accountDetails,
    categories,
    envelopes,
    envelopeDetails,
    budgetId,
    load,
    invalidate,
  };
}
