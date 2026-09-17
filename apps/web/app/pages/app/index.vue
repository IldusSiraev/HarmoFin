<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { definePageMeta } from '#imports';
import { RefreshCw } from '@lucide/vue';

import AvailableBudgetCard from '../../components/dashboard/AvailableBudgetCard.vue';
import BalanceList from '../../components/dashboard/BalanceList.vue';
import DashboardWarnings from '../../components/dashboard/DashboardWarnings.vue';
import FinancialMonthTimeline from '../../components/dashboard/FinancialMonthTimeline.vue';
import RecentOperations from '../../components/dashboard/RecentOperations.vue';
import UpcomingObligations from '../../components/dashboard/UpcomingObligations.vue';
import UiButton from '../../components/ui/Button.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiSkeleton from '../../components/ui/Skeleton.vue';
import { useAuth } from '../../composables/useAuth.js';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';
import {
  type DashboardSummaryDto,
  type TransactionDto,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';

definePageMeta({ middleware: 'auth', layout: 'app' });

const { currentData, loadMe } = useAuth();
const api = useBudgetReferenceData();
const loading = ref(true);
const error = ref('');
const summary = ref<DashboardSummaryDto | null>(null);
const recent = ref<TransactionDto[]>([]);
const accountsTotal = ref<string | null>(null);
const envelopesTotal = ref<string | null>(null);
const { accounts, categories, envelopes, load: loadReferenceData } = useOperationReferenceData();
const { openDialog } = useOperationDialogs();
const activeBudget = computed(() => currentData.value?.workspaces[0]?.budgets[0] ?? null);
function workspaceName() {
  return currentData.value?.workspaces[0]?.name ?? 'Бюджет';
}

// The dialogs live in the layout now, so the page reloads its summary whenever
// one of them closes instead of owning their state.
watch(openDialog, (value, previous) => {
  if (value === 'none' && previous !== 'none') void loadDashboard();
});

onMounted(() => {
  void loadDashboard();
});

// A dashboard total is a nice-to-have next to the balance rows below it, not
// something worth failing the whole page over — a rejection here becomes
// "no total shown" instead of the generic error state.
async function safeTotal(read: Promise<{ totalMinor: string }>): Promise<string | null> {
  return read.then((value) => value.totalMinor).catch(() => null);
}

// Same reasoning as safeTotal: recent operations are a nice-to-have next to
// the summary cards, not something worth failing the whole page over.
async function safeTransactions(
  read: Promise<{ items: TransactionDto[]; nextCursor: string | null }>,
): Promise<{ items: TransactionDto[]; nextCursor: string | null }> {
  return read.catch(() => ({ items: [], nextCursor: null }));
}

async function loadDashboard() {
  loading.value = true;
  error.value = '';
  try {
    if (!currentData.value) await loadMe();
    const budget = activeBudget.value;
    if (!budget) return;
    const [summaryResult, recentResult, accountsTotalResult, envelopesTotalResult] =
      await Promise.all([
        api.getDashboardSummary(budget.id),
        safeTransactions(
          api.listTransactions(budget.id, {
            limit: 5,
            sortBy: 'occurredOn',
            sortDirection: 'desc',
          }),
        ),
        safeTotal(api.getAccountsSummary(budget.id)),
        safeTotal(api.getEnvelopesSummary(budget.id)),
        // The account/category/envelope names behind recent operations are
        // also a nice-to-have: if they fail to load, RecentOperations still
        // renders with whatever fallback it has, instead of taking down the
        // whole dashboard.
        loadReferenceData().catch(() => undefined),
      ]);
    summary.value = summaryResult;
    recent.value = recentResult.items;
    accountsTotal.value = accountsTotalResult;
    envelopesTotal.value = envelopesTotalResult;
  } catch {
    error.value = 'Не удалось загрузить сводку бюджета.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="dashboard">
    <div v-if="loading" data-testid="dashboard-loading" aria-busy="true" class="dashboard-loading">
      <UiSkeleton variant="card" />
      <UiSkeleton variant="row" :count="3" />
      <UiSkeleton variant="card" :count="2" />
    </div>
    <div v-else-if="error" class="dashboard-error" role="alert">
      <p>{{ error }}</p>
      <UiButton data-action="retry-summary" variant="tertiary" @click="loadDashboard"
        >Повторить</UiButton
      >
    </div>
    <UiEmptyState
      v-else-if="!activeBudget"
      title="Бюджет не выбран"
      description="Создайте или выберите активный бюджет для просмотра сводки."
    />
    <template v-else-if="summary">
      <div class="dashboard-header">
        <div>
          <p class="dashboard-kicker">{{ workspaceName() }}</p>
          <h1 class="dashboard-title">{{ activeBudget.name }}</h1>
        </div>
        <UiButton
          variant="tertiary"
          data-action="refresh-summary"
          aria-label="Обновить данные"
          @click="loadDashboard"
        >
          <RefreshCw :size="18" aria-hidden="true" />
        </UiButton>
      </div>

      <FinancialMonthTimeline
        class="dashboard-timeline"
        :cycle="summary.cycle"
        :period="summary.period"
      />

      <section class="dashboard-grid" aria-label="Сводка бюджета">
        <AvailableBudgetCard
          class="dashboard-grid__wide"
          :period-limit="summary.periodLimit"
          :period="summary.period"
        />
        <DashboardWarnings
          class="dashboard-grid__wide"
          :warnings="summary.warnings"
          :accounts="summary.accounts"
          :envelopes="summary.envelopes"
          :unallocated-income-minor="summary.unallocatedIncomeMinor"
        />
        <UpcomingObligations class="dashboard-grid__wide" :items="summary.upcomingObligations" />
        <RecentOperations
          class="dashboard-grid__wide"
          :transactions="recent"
          :categories="categories"
          :accounts="accounts"
          :envelopes="envelopes"
        />
        <BalanceList
          title="Конверты"
          :items="summary.envelopes"
          :warnings="summary.warnings"
          subject="ENVELOPE"
          :total-minor="envelopesTotal"
          more-link="/app/envelopes"
        />
        <BalanceList
          title="Счета"
          :items="summary.accounts"
          :warnings="summary.warnings"
          subject="ACCOUNT"
          :total-minor="accountsTotal"
          more-link="/app/accounts"
        />
      </section>
    </template>
  </div>
</template>

<style scoped>
.dashboard {
  color: var(--hf-color-text);
}

.dashboard-loading {
  display: grid;
  gap: var(--hf-space-5);
}

.dashboard-error {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
  align-items: center;
  color: var(--hf-color-text-danger);
}

.dashboard-error p {
  margin: 0;
}

.dashboard-header {
  display: flex;
  gap: var(--hf-space-4);
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--hf-space-6);
}

.dashboard-kicker {
  margin: 0 0 var(--hf-space-2);
  color: var(--hf-color-action-primary-hover);
  font-size: 0.875rem;
  font-weight: var(--hf-font-weight-semibold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.dashboard-title {
  margin: 0;
  font-size: clamp(2rem, 5vw, 3.25rem);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1.1;
}

.dashboard-timeline {
  max-width: 28rem;
  margin-bottom: var(--hf-space-6);
}

.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--hf-space-5);
}

@media (min-width: 1024px) {
  .dashboard-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dashboard-grid__wide {
    grid-column: 1 / -1;
  }
}
</style>
