import { ref, type Ref } from 'vue';

import { useAuth } from './useAuth.js';
import {
  useBudgetReferenceData,
  type AccountDto,
  type CategoryDto,
  type EnvelopeDto,
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
// v1 budgets only: the legacy envelope records carry currentBalanceMinor.
const envelopeDetails = ref<EnvelopeDto[]>([]);
// v2 budgets only: Envelope Plan v2.2 records (funded/spent/balance from the server).
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
  envelopeDetails: Ref<EnvelopeDto[]>;
  envelopePlans: Ref<EnvelopePlanDto[]>;
  budgetId: Ref<string | null>;
  load: () => Promise<void>;
  invalidate: () => void;
} {
  const api = useBudgetReferenceData();
  const auth = useAuth();

  async function load(): Promise<void> {
    if (!auth.currentData.value) await auth.loadMe();
    const budget = auth.currentData.value?.workspaces[0]?.budgets[0] ?? null;
    const id = budget?.id ?? null;
    budgetId.value = id;
    if (id === null) {
      forget();
      return;
    }
    if (loadedFor === id) return;
    if (loadedFor !== null) forget();

    // Budgets on the Envelope Plan v2.2 model reject the legacy envelope GET
    // (409), so their envelopes come from the v2 list; accounts and categories
    // stay on the stable v1 endpoints.
    const isV2 = budget?.planModelVersion === 2;
    const [accountList, categoryList, envelopeResult] = await Promise.all([
      api.listAccounts(id, 'active'),
      api.listCategories(id, undefined, 'active'),
      isV2 ? useEnvelopePlanV2().listEnvelopes(id) : api.listEnvelopes(id, 'active'),
    ]);

    accounts.value = accountList.map((account) => ({ value: account.id, label: account.name }));
    accountDetails.value = accountList;
    categories.value = categoryList;
    if (isV2) {
      const plans = (envelopeResult as { items: EnvelopePlanDto[] }).items.filter(
        (envelope) => envelope.archivedAt === null,
      );
      envelopePlans.value = plans;
      envelopes.value = plans.map((envelope) => ({ value: envelope.id, label: envelope.name }));
      envelopeDetails.value = [];
    } else {
      const list = envelopeResult as EnvelopeDto[];
      envelopePlans.value = [];
      envelopes.value = list.map((envelope) => ({ value: envelope.id, label: envelope.name }));
      envelopeDetails.value = list;
    }
    loadedFor = id;
  }

  function forget(): void {
    accounts.value = [];
    accountDetails.value = [];
    categories.value = [];
    envelopes.value = [];
    envelopeDetails.value = [];
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
    envelopeDetails,
    envelopePlans,
    budgetId,
    load,
    invalidate,
  };
}
