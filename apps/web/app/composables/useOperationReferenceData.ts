import { ref, type Ref } from 'vue';

import { authorLabel } from '../components/operations/author-label.js';
import { useActiveWorkspace } from './useActiveWorkspace.js';
import { useAuth } from './useAuth.js';
import {
  useBudgetReferenceData,
  type AccountDto,
  type CategoryDto,
} from './useBudgetReferenceData.js';
import { useEnvelopePlanV2, type EnvelopePlanDto, type PersonRef } from './useEnvelopePlanV2.js';

export interface ReferenceOption {
  value: string;
  label: string;
}

// Foreign records carry their owner in the label, so a member picking from a
// family-wide list cannot mistake someone else's account or envelope for theirs.
function captioned(name: string, owner: PersonRef | null | undefined, meId: string | null): string {
  return owner && owner.userId !== meId ? `${name} — ${authorLabel(owner)}` : name;
}

// Module-level cache: the dialogs open from every screen, and re-reading the
// same three reference lists on each open is pure latency.
const accounts = ref<ReferenceOption[]>([]);
const ownAccounts = ref<ReferenceOption[]>([]);
const familyAccounts = ref<ReferenceOption[]>([]);
const accountDetails = ref<AccountDto[]>([]);
const categories = ref<CategoryDto[]>([]);
const envelopes = ref<ReferenceOption[]>([]);
const envelopeOptions = ref<ReferenceOption[]>([]);
// Envelope Plan v2.2 records (funded/spent/balance from the server).
const envelopePlans = ref<EnvelopePlanDto[]>([]);
const budgetId = ref<string | null>(null);
// Which budget the cached lists belong to: a different budget — or a different
// signed-in user — must never read another one's reference data.
let loadedFor: string | null = null;

export function useOperationReferenceData(): {
  accounts: Ref<ReferenceOption[]>;
  ownAccounts: Ref<ReferenceOption[]>;
  familyAccounts: Ref<ReferenceOption[]>;
  accountDetails: Ref<AccountDto[]>;
  categories: Ref<CategoryDto[]>;
  envelopes: Ref<ReferenceOption[]>;
  envelopeOptions: Ref<ReferenceOption[]>;
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
    // The server owns the verdict; the client only filters by its `canEdit`
    // flag. Doubles without the flag stay out of the own lists, never in them.
    const meId = auth.currentUser?.value?.id ?? null;
    ownAccounts.value = accountList
      .filter((account) => account.canEdit === true)
      .map((account) => ({ value: account.id, label: account.name }));
    familyAccounts.value = accountList.map((account) => ({
      value: account.id,
      label: captioned(account.name, account.owner, meId),
    }));
    envelopeOptions.value = plans.map((envelope) => ({
      value: envelope.id,
      label: captioned(envelope.name, envelope.owner, meId),
    }));
    loadedFor = id;
  }

  function forget(): void {
    accounts.value = [];
    ownAccounts.value = [];
    familyAccounts.value = [];
    accountDetails.value = [];
    categories.value = [];
    envelopes.value = [];
    envelopeOptions.value = [];
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
    ownAccounts,
    familyAccounts,
    accountDetails,
    categories,
    envelopes,
    envelopeOptions,
    envelopePlans,
    budgetId,
    load,
    invalidate,
  };
}
