<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { definePageMeta } from '#imports';
import { RefreshCw, Wallet } from '@lucide/vue';

import AppAddMenu from '../../components/app/AppAddMenu.vue';
import { accountSubtitle, ACCOUNT_TYPE_ICONS } from '../../components/accounts/account-type.js';
import AvailableBudgetCard from '../../components/dashboard/AvailableBudgetCard.vue';
import BalanceList from '../../components/dashboard/BalanceList.vue';
import DashboardWarnings from '../../components/dashboard/DashboardWarnings.vue';
import OnboardingChecklist from '../../components/dashboard/OnboardingChecklist.vue';
import PeriodDecisionCard from '../../components/dashboard/PeriodDecisionCard.vue';
import PeriodLeftoverPrompt from '../../components/dashboard/PeriodLeftoverPrompt.vue';
import FinancialMonthTimeline from '../../components/dashboard/FinancialMonthTimeline.vue';
import RecentOperations from '../../components/dashboard/RecentOperations.vue';
import UpcomingObligations from '../../components/dashboard/UpcomingObligations.vue';
import { envelopeSubtitle, ENVELOPE_TYPE_ICONS } from '../../components/envelopes/envelope-type.js';
import FinanceMoney from '../../components/finance/FinanceMoney.vue';
import { formatMinorUnits } from '../../components/finance/money-format.js';
import UiButton from '../../components/ui/Button.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiProgress from '../../components/ui/Progress.vue';
import UiSkeleton from '../../components/ui/Skeleton.vue';
import UiStatus from '../../components/ui/Status.vue';
import { useAuth } from '../../composables/useAuth.js';
import {
  type DashboardV2Response,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
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
const dashboardV2 = ref<DashboardV2Response | null>(null);
const recent = ref<TransactionDto[]>([]);
const accountsTotal = ref<string | null>(null);
const envelopesTotal = ref<string | null>(null);
const {
  accounts,
  accountDetails,
  categories,
  envelopes,
  envelopeDetails,
  load: loadReferenceData,
} = useOperationReferenceData();
const { openDialog } = useOperationDialogs();
const accountById = computed(
  () => new Map(accountDetails.value.map((account) => [account.id, account])),
);
const envelopeById = computed(
  () => new Map(envelopeDetails.value.map((envelope) => [envelope.id, envelope])),
);

function accountIcon(id: string) {
  const account = accountById.value.get(id);
  return account ? ACCOUNT_TYPE_ICONS[account.accountType] : null;
}

function accountSubtitleFor(id: string): string {
  const account = accountById.value.get(id);
  return account ? accountSubtitle(account) : '';
}

function envelopeIcon(id: string) {
  const envelope = envelopeById.value.get(id);
  return envelope ? ENVELOPE_TYPE_ICONS[envelope.envelopeType] : null;
}

function envelopeSubtitleFor(id: string): string {
  const envelope = envelopeById.value.get(id);
  return envelope ? envelopeSubtitle(envelope) : '';
}

// Only savings-goal envelopes carry a meaningful target — the same condition
// EnvelopeRow.vue already uses on the reference page, so the dashboard's
// progress bar means the same thing there and here.
function envelopeTarget(id: string): string | null {
  return envelopeById.value.get(id)?.targetAmountMinor ?? null;
}

function envelopeGoalLabel(id: string, balanceMinor: string): string {
  const envelope = envelopeById.value.get(id);
  const target = envelope?.targetAmountMinor;
  if (!envelope || target === null || target === undefined) return '';
  const saved = formatMinorUnits(balanceMinor, envelope.currency, envelope.scale);
  const total = formatMinorUnits(target, envelope.currency, envelope.scale);
  return `${saved} из ${total}`;
}

const activeBudget = computed(() => currentData.value?.workspaces[0]?.budgets[0] ?? null);
const isModelV2 = computed(() => activeBudget.value?.planModelVersion === 2);
// The v2 client needs the Nuxt app context, so it is only created for v2 budgets.
const planV2 =
  currentData.value?.workspaces[0]?.budgets[0]?.planModelVersion === 2 ? useEnvelopePlanV2() : null;
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
    dashboardV2.value = await (planV2 ?? useEnvelopePlanV2()).getDashboard(budget.id);
    // The decision card may be gone now: keep focus on a stable element.
    await nextTick();
    focusFallback(true);
  } catch {
    error.value = 'Не удалось обновить сводку бюджета.';
  }
}

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
    if (budget.planModelVersion === 2) {
      // Model 2: the v1 dashboard/envelope summaries answer 409, so the page
      // reads only the v2 dashboard (accounts included).
      const [dashboardResult, recentResult] = await Promise.all([
        (planV2 ?? useEnvelopePlanV2()).getDashboard(budget.id),
        safeTransactions(
          api.listTransactions(budget.id, {
            limit: 5,
            sortBy: 'occurredOn',
            sortDirection: 'desc',
          }),
        ),
        loadReferenceData().catch(() => undefined),
      ]);
      dashboardV2.value = dashboardResult;
      summary.value = null;
      recent.value = recentResult.items;
      return;
    }
    dashboardV2.value = null;
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
    <template v-else-if="dashboardV2 && isModelV2">
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

      <div class="dashboard-sections">
        <OnboardingChecklist
          :budget-id="activeBudget.id"
          :initialize-template="api.initializeTemplate"
          @template-initialized="loadDashboard"
        />

        <PeriodDecisionCard
          :budget-id="activeBudget.id"
          :warnings="dashboardV2.warnings"
          :suggested-target="dashboardV2.suggestedTarget"
          :period-id="dashboardV2.period.periodId"
          :protected-assignments="dashboardV2.protectedAssignments"
          @changed="refreshDashboardV2"
          @focus-fallback="focusFallback()"
        />

        <DashboardWarnings :v2-warnings="coverageWarnings" />

        <AvailableBudgetCard :dashboard="dashboardV2" />

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

        <RecentOperations
          :transactions="recent"
          :categories="categories"
          :accounts="accounts"
          :envelopes="envelopes"
        />
      </div>
    </template>
    <template v-else-if="summary">
      <div class="dashboard-header">
        <div>
          <p class="dashboard-kicker">{{ workspaceName() }}</p>
          <h1 class="dashboard-title">{{ activeBudget.name }}</h1>
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
        :cycle="summary.cycle"
        :period="summary.period"
      />

      <div class="dashboard-sections">
        <OnboardingChecklist
          :budget-id="activeBudget.id"
          :onboarding="summary.onboarding"
          :initialize-template="api.initializeTemplate"
          @template-initialized="loadDashboard"
        />

        <DashboardWarnings
          :warnings="summary.warnings"
          :accounts="summary.accounts"
          :envelopes="summary.envelopes"
          :unallocated-income-minor="summary.unallocatedIncomeMinor"
          :unassigned-starting-balance-minor="summary.unassignedStartingBalanceMinor"
        />

        <PeriodLeftoverPrompt
          :leftover="summary.previousPeriodLeftover"
          :budget-id="activeBudget.id"
          :envelopes="envelopeDetails"
          :create-reallocation="api.createEnvelopeReallocation"
          @reallocated="loadDashboard"
        />

        <div class="dashboard-hero-row">
          <AvailableBudgetCard
            class="dashboard-hero-row__spend"
            :period-limit="summary.periodLimit"
            :period="summary.period"
          />
          <UpcomingObligations
            class="dashboard-hero-row__obligations"
            :items="summary.upcomingObligations"
          />
        </div>

        <div class="dashboard-lists-row">
          <BalanceList
            title="Счета"
            :items="summary.accounts"
            :warnings="summary.warnings"
            subject="ACCOUNT"
            :total-minor="accountsTotal"
            more-link="/app/accounts"
          >
            <template #row="{ item, hasWarning }">
              <span class="dashboard-balance-icon">
                <component :is="accountIcon(item.id) ?? Wallet" :size="16" aria-hidden="true" />
              </span>
              <span class="dashboard-balance-body">
                <span class="dashboard-balance-name">{{ item.name }}</span>
                <span class="dashboard-balance-subtitle">{{ accountSubtitleFor(item.id) }}</span>
              </span>
              <span v-if="hasWarning" class="dashboard-balance-meta">
                <UiStatus label="Дефицит" tone="warning" />
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
            :items="summary.envelopes"
            :warnings="summary.warnings"
            subject="ENVELOPE"
            :total-minor="envelopesTotal"
            more-link="/app/envelopes"
          >
            <template #row="{ item, hasWarning }">
              <span class="dashboard-balance-icon">
                <component :is="envelopeIcon(item.id) ?? Wallet" :size="16" aria-hidden="true" />
              </span>
              <span class="dashboard-balance-body">
                <span class="dashboard-balance-line">
                  <span class="dashboard-balance-name">{{ item.name }}</span>
                  <span v-if="hasWarning" class="dashboard-balance-meta">
                    <UiStatus label="Дефицит" tone="warning" />
                  </span>
                  <FinanceMoney
                    class="dashboard-balance-trailing"
                    :minor-units="item.balanceMinor"
                    currency="RUB"
                    :scale="2"
                  />
                </span>
                <template v-if="envelopeTarget(item.id)">
                  <UiProgress
                    class="dashboard-balance-progress"
                    :value="item.balanceMinor"
                    :max="envelopeTarget(item.id) ?? '0'"
                    :label="`Накоплено ${envelopeGoalLabel(item.id, item.balanceMinor)}`"
                  />
                  <span class="dashboard-balance-subtitle">{{
                    envelopeGoalLabel(item.id, item.balanceMinor)
                  }}</span>
                </template>
                <span v-else class="dashboard-balance-subtitle">{{
                  envelopeSubtitleFor(item.id)
                }}</span>
              </span>
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

.dashboard-sections {
  display: grid;
  gap: var(--hf-space-5);
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

.dashboard-balance-meta {
  display: flex;
  flex-shrink: 0;
  align-items: center;
}

.dashboard-balance-trailing {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.dashboard-balance-line {
  display: flex;
  gap: var(--hf-space-2);
  align-items: center;
}

.dashboard-balance-line .dashboard-balance-name {
  flex: 1;
}

.dashboard-balance-progress {
  margin-top: var(--hf-space-1);
}
</style>
