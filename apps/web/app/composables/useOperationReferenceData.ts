import { ref, type Ref } from 'vue';

import { useActiveWorkspace } from './useActiveWorkspace.js';
import { useAuth } from './useAuth.js';
import {
  useBudgetReferenceData,
  type AccountDto,
  type CategoryDto,
} from './useBudgetReferenceData.js';
import { useEnvelopePlanV2, type EnvelopePlanDto } from './useEnvelopePlanV2.js';

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
// Envelope Plan v2.2 records (funded/spent/balance from the server).
const envelopePlans = ref<EnvelopePlanDto[]>([]);
const budgetId = ref<string | null>(null);
// Which budget the cached lists belong to: a different budget — or a different
// signed-in user — must never read another one's reference data.
let loadedFor: string | null = null;

export function useOperationReferenceData(): {
  accounts: Ref<ReferenceOption[]>;
  accountDetails: Ref<AccountDto[]>;
  categories: Ref<CategoryDto[]>;
  envelopes: Ref<ReferenceOption[]>;
  envelopePlans: Ref<EnvelopePlanDto[]>;
  budgetId: Ref<string | null>;
  load: () => Promise<void>;
  invalidate: () => void;
} {
  const api = useBudgetReferenceData();
  const auth = useAuth();

  async function load(): Promise<void> {
    if (!auth.currentData.value) await auth.loadMe();
    // Created fresh on every call: test doubles for `useAuth` are plain
    // objects, not Vue refs, so a computed built once and cached would never
    // see a later `currentData` swap — only a brand-new computed re-reads it.
    const id = useActiveWorkspace().budgetId.value ?? null;
    budgetId.value = id;
    if (id === null) {
      forget();
      return;
    }
    if (loadedFor === id) return;
    if (loadedFor !== null) forget();

    // Envelopes come from the v2 list; accounts and categories stay on the
    // stable v1 endpoints.
    const [accountList, categoryList, envelopeResult] = await Promise.all([
      api.listAccounts(id, 'active'),
      api.listCategories(id, undefined, 'active'),
      useEnvelopePlanV2().listEnvelopes(id),
    ]);

    accounts.value = accountList.map((account) => ({ value: account.id, label: account.name }));
    accountDetails.value = accountList;
    categories.value = categoryList;
    const plans = envelopeResult.items.filter((envelope) => envelope.archivedAt === null);
    envelopePlans.value = plans;
    envelopes.value = plans.map((envelope) => ({ value: envelope.id, label: envelope.name }));
    loadedFor = id;
  }

  function forget(): void {
    accounts.value = [];
    accountDetails.value = [];
    categories.value = [];
    envelopes.value = [];
    envelopePlans.value = [];
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
    envelopePlans,
    budgetId,
    load,
    invalidate,
  };
}
