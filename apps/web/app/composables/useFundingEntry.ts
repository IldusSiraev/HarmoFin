import { readonly, ref, type Ref } from 'vue';

import { useAuth } from './useAuth.js';

// One optional "assign this money" step offered after the money fact is saved:
// an income (INCOME), the first account balance (OPENING) or free money (FREE).
// Module-level because the offering screens and the layout-mounted host are
// different components. The offer is only a request to open the panel; the
// server preview/confirm and every amount live in FundingEntryHost.

export type FundingEntrySource =
  | { sourceKind: 'INCOME'; incomeTransactionId: string }
  | { sourceKind: 'OPENING' }
  | { sourceKind: 'FREE' };

export interface FundingEntryRequest {
  budgetId: string;
  source: FundingEntrySource;
  /** Distinguishes two offers of the same source so a re-offer re-opens the panel. */
  seq: number;
}

const request = ref<FundingEntryRequest | null>(null);
// Bumped after each successful confirm so screens that show dashboard data can
// watch it and reload from the server.
const confirmedCount = ref(0);
let nextSeq = 0;

export function useFundingEntry(): {
  request: Readonly<Ref<FundingEntryRequest | null>>;
  confirmedCount: Readonly<Ref<number>>;
  offer: (source: FundingEntrySource) => boolean;
  dismiss: () => void;
  markConfirmed: () => void;
} {
  const auth = useAuth();

  function offer(source: FundingEntrySource): boolean {
    const budget = auth.currentData.value?.workspaces[0]?.budgets[0] ?? null;
    if (!budget) return false;
    nextSeq += 1;
    request.value = { budgetId: budget.id, source, seq: nextSeq };
    return true;
  }

  return {
    request: readonly(request) as Readonly<Ref<FundingEntryRequest | null>>,
    confirmedCount: readonly(confirmedCount),
    offer,
    dismiss: () => {
      request.value = null;
    },
    markConfirmed: () => {
      confirmedCount.value += 1;
    },
  };
}
