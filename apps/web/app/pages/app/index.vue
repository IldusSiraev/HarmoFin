<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { definePageMeta } from '#imports';
import { RefreshCw, Wallet } from '@lucide/vue';

import AppAddMenu from '../../components/app/AppAddMenu.vue';
import { accountSubtitle, ACCOUNT_TYPE_ICONS } from '../../components/accounts/account-type.js';
import AvailableBudgetCard from '../../components/dashboard/AvailableBudgetCard.vue';
import FinancialMonthTimeline from '../../components/dashboard/FinancialMonthTimeline.vue';
import BalanceList from '../../components/dashboard/BalanceList.vue';
import UpcomingObligations from '../../components/dashboard/UpcomingObligations.vue';
import DashboardWarnings from '../../components/dashboard/DashboardWarnings.vue';
import OnboardingChecklist from '../../components/dashboard/OnboardingChecklist.vue';
import PeriodDecisionCard from '../../components/dashboard/PeriodDecisionCard.vue';
import RecentOperations from '../../components/dashboard/RecentOperations.vue';
import { ENVELOPE_TYPE_ICONS, envelopeSubtitle } from '../../components/envelopes/envelope-type.js';
import FinanceMoney from '../../components/finance/FinanceMoney.vue';
import UiButton from '../../components/ui/Button.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiSkeleton from '../../components/ui/Skeleton.vue';
import { useAuth } from '../../composables/useAuth.js';
import { useFundingEntry } from '../../composables/useFundingEntry.js';
import {
  type DashboardV2Response,
  type TransactionJournalV2Item,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';

definePageMeta({ middleware: 'auth', layout: 'app' });

const { currentData, loadMe } = useAuth();
const loading = ref(true);
const error = ref('');
const dashboardV2 = ref<DashboardV2Response | null>(null);
// The onboarding checklist shows the period plan decision while it is expanded.
const checklistHostsTarget = ref(false);
const recent = ref<TransactionJournalV2Item[]>([]);
const {
  accounts,
  accountDetails,
  categories,
  envelopes,
  load: loadReferenceData,
} = useOperationReferenceData();
const { openDialog } = useOperationDialogs();
const accountById = computed(
  () => new Map(accountDetails.value.map((account) => [account.id, account])),
);

function accountIcon(id: string) {
  const account = accountById.value.get(id);
  return account ? ACCOUNT_TYPE_ICONS[account.accountType] : null;
}

function accountSubtitleFor(id: string): string {
  const account = accountById.value.get(id);
  return account ? accountSubtitle(account) : '';
}

type EnvelopeRow = DashboardV2Response['envelopes'][number];

// The list slot hands over the generic balance item; the full server row is looked up by id.
function envelopeRow(id: string): EnvelopeRow {
  return dashboardV2.value!.envelopes.find((row) => row.id === id)!;
}

function envelopeIcon(row: EnvelopeRow) {
  return ENVELOPE_TYPE_ICONS[row.envelopeType] ?? Wallet;
}

function envelopeSubtitleFor(row: EnvelopeRow): string {
  return envelopeSubtitle(row);
}

// Free money is shown as the server sent it; only a string check decides if the row appears.
const hasFreeMoney = computed(() => {
  const free = dashboardV2.value?.freeToAssignMinor ?? '0';
  return free !== '0' && !free.startsWith('-');
});

const activeBudget = computed(() => currentData.value?.workspaces[0]?.budgets[0] ?? null);
const planV2 = useEnvelopePlanV2();
const funding = useFundingEntry();
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

// A confirmed assignment changes what is free and what the period holds.
watch(
  () => funding.confirmedCount.value,
  () => void refreshDashboardV2(),
);

// Period leftover/deficit warnings are decisions owned by PeriodDecisionCard;
// the shared warnings list keeps only the coverage ones.
const coverageWarnings = computed(
  () => dashboardV2.value?.warnings.filter((warning) => warning.kind !== 'PERIOD') ?? [],
);

// Re-reads the server dashboard after a decision without swapping the page for
// the loading skeleton, so focus stays on the decision card.
const pageTitle = ref<HTMLElement | null>(null);
function focusFallback(preferCard = false) {
  const card = preferCard ? document.getElementById('period-decision-title') : null;
  (card ?? pageTitle.value)?.focus();
}

async function refreshDashboardV2() {
  const budget = activeBudget.value;
  if (!budget) return;
  try {
    dashboardV2.value = await planV2.getDashboard(budget.id);
    // The decision card may be gone now: keep focus on a stable element.
    await nextTick();
    focusFallback(true);
  } catch {
    error.value = 'Не удалось обновить сводку бюджета.';
  }
}

// Recent operations are a nice-to-have next to the summary cards, not
// something worth failing the whole page over.
async function safeTransactions(
  read: Promise<{ items: TransactionJournalV2Item[]; nextCursor: string | null }>,
): Promise<{ items: TransactionJournalV2Item[]; nextCursor: string | null }> {
  return read.catch(() => ({ items: [], nextCursor: null }));
}

async function loadDashboard() {
  loading.value = true;
  error.value = '';
  try {
    if (!currentData.value) await loadMe();
    const budget = activeBudget.value;
    if (!budget) return;
    const [dashboardResult, recentResult] = await Promise.all([
      planV2.getDashboard(budget.id),
      // The journal is newest first by contract: the first page is "recent".
      safeTransactions(planV2.listTransactions(budget.id, { limit: 5 })),
      loadReferenceData().catch(() => undefined),
    ]);
    dashboardV2.value = dashboardResult;
    recent.value = recentResult.items;
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
    <template v-else-if="dashboardV2">
      <div class="dashboard-header">
        <div>
          <p class="dashboard-kicker">{{ workspaceName() }}</p>
          <h1 ref="pageTitle" class="dashboard-title" tabindex="-1">{{ activeBudget.name }}</h1>
        </div>
        <div class="dashboard-header__actions">
          <AppAddMenu tooltip-placement="bottom" />
          <UiButton
            variant="tertiary"
            data-action="refresh-summary"
            aria-label="Обновить данные"
            tooltip="Обновить данные"
            tooltip-placement="bottom"
            @click="loadDashboard"
          >
            <RefreshCw :size="18" aria-hidden="true" />
          </UiButton>
        </div>
      </div>

      <FinancialMonthTimeline
        class="dashboard-timeline"
        :cycle="dashboardV2.cycle"
        :period="dashboardV2.period"
        :as-of="dashboardV2.asOf"
      />

      <div class="dashboard-sections">
        <OnboardingChecklist
          :budget-id="activeBudget.id"
          @template-initialized="loadDashboard"
          @target-decided="refreshDashboardV2"
          @hosts-target="checklistHostsTarget = $event"
        />

        <PeriodDecisionCard
          :budget-id="activeBudget.id"
          :warnings="dashboardV2.warnings"
          :suggested-target="dashboardV2.suggestedTarget"
          :hide-target="checklistHostsTarget"
          :period-id="dashboardV2.period.periodId"
          :protected-assignments="dashboardV2.protectedAssignments"
          @changed="refreshDashboardV2"
          @focus-fallback="focusFallback()"
        />

        <DashboardWarnings :v2-warnings="coverageWarnings" />

        <div class="dashboard-hero-row">
          <AvailableBudgetCard
            class="dashboard-hero-row__spend"
            :dashboard="dashboardV2"
            @assign="funding.offer({ sourceKind: 'FREE' })"
          />
          <UpcomingObligations
            class="dashboard-hero-row__obligations"
            :items="dashboardV2.nearestObligations"
          />
        </div>

        <div class="dashboard-lists-row">
          <BalanceList
            title="Счета"
            :items="dashboardV2.accounts"
            :warnings="[]"
            subject="ACCOUNT"
            :total-minor="dashboardV2.cashMinor"
            more-link="/app/accounts"
          >
            <template #row="{ item }">
              <span class="dashboard-balance-icon">
                <component :is="accountIcon(item.id) ?? Wallet" :size="16" aria-hidden="true" />
              </span>
              <span class="dashboard-balance-body">
                <span class="dashboard-balance-name">{{ item.name }}</span>
                <span class="dashboard-balance-subtitle">{{ accountSubtitleFor(item.id) }}</span>
              </span>
              <FinanceMoney
                class="dashboard-balance-trailing"
                :minor-units="item.balanceMinor"
                currency="RUB"
                :scale="2"
              />
            </template>
          </BalanceList>

          <BalanceList
            title="Конверты"
            :items="dashboardV2.envelopes"
            :warnings="[]"
            subject="ENVELOPE"
            :total-minor="dashboardV2.envelopesTotalMinor"
            more-link="/app/envelopes"
          >
            <template #row="{ item }">
              <span class="dashboard-balance-icon">
                <component :is="envelopeIcon(envelopeRow(item.id))" :size="16" aria-hidden="true" />
              </span>
              <span class="dashboard-balance-body">
                <span class="dashboard-balance-name">{{ item.name }}</span>
                <span class="dashboard-balance-subtitle">{{
                  envelopeSubtitleFor(envelopeRow(item.id))
                }}</span>
              </span>
              <FinanceMoney
                class="dashboard-balance-trailing"
                :minor-units="item.balanceMinor"
                currency="RUB"
                :scale="2"
              />
            </template>
            <template #footer>
              <p
                v-if="hasFreeMoney"
                class="dashboard-unassigned"
                data-testid="envelopes-unassigned"
              >
                Не распределено
                <FinanceMoney
                  :minor-units="dashboardV2.freeToAssignMinor"
                  currency="RUB"
                  :scale="2"
                />
              </p>
            </template>
          </BalanceList>
        </div>

        <RecentOperations
          :transactions="recent"
          :categories="categories"
          :accounts="accounts"
          :envelopes="envelopes"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.dashboard {
  max-width: 70rem;
  margin: 0 auto;
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

.dashboard-header__actions {
  display: flex;
  gap: var(--hf-space-2);
  align-items: center;
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
  margin-bottom: var(--hf-space-6);
}

.dashboard-hero-row,
.dashboard-lists-row {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--hf-space-5);
}

@media (min-width: 1024px) {
  .dashboard-hero-row {
    grid-template-columns: 2fr 1fr;
    align-items: stretch;
  }

  .dashboard-lists-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.dashboard-unassigned {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-variant-numeric: tabular-nums;
}

.dashboard-sections {
  display: grid;
  gap: var(--hf-space-5);
}

.dashboard-balance-icon {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text-muted);
}

.dashboard-balance-body {
  display: grid;
  flex: 1;
  gap: 0.125rem;
  min-width: 0;
}

.dashboard-balance-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-balance-subtitle {
  overflow: hidden;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-balance-trailing {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
</style>
