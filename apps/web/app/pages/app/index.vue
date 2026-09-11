<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { definePageMeta } from '#imports';

import BalanceList from '../../components/dashboard/BalanceList.vue';
import PeriodLimitCard from '../../components/dashboard/PeriodLimitCard.vue';
import UpcomingObligations from '../../components/dashboard/UpcomingObligations.vue';
import FinanceMoney from '../../components/finance/FinanceMoney.vue';
import UiButton from '../../components/ui/Button.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import { useAuth } from '../../composables/useAuth.js';
import {
  type DashboardSummaryDto,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';

definePageMeta({ middleware: 'auth', layout: 'app' });

const { currentData, loadMe } = useAuth();
const api = useBudgetReferenceData();
const loading = ref(true);
const error = ref('');
const summary = ref<DashboardSummaryDto | null>(null);
const activeBudget = computed(() => currentData.value?.workspaces[0]?.budgets[0] ?? null);
function workspaceName() {
  return currentData.value?.workspaces[0]?.name ?? 'Бюджет';
}

onMounted(() => {
  void loadDashboard();
});

async function loadDashboard() {
  loading.value = true;
  error.value = '';
  try {
    if (!currentData.value) await loadMe();
    if (!activeBudget.value) return;
    summary.value = await api.getDashboardSummary(activeBudget.value.id);
  } catch {
    error.value = 'Не удалось загрузить сводку бюджета.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="dashboard">
    <div v-if="loading" class="dashboard-loading">
      <p>Загрузка бюджета…</p>
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
      </div>

      <section class="dashboard-grid" aria-label="Сводка бюджета">
          <section class="total-money" aria-labelledby="total-money-title">
            <p id="total-money-title">Всего на счетах</p>
            <FinanceMoney :minor-units="summary.totalAccountMoneyMinor" currency="RUB" :scale="2" />
            <p>
              Нераспределено:
              <FinanceMoney
                :minor-units="summary.unallocatedIncomeMinor"
                currency="RUB"
                :scale="2"
              />
            </p>
          </section>
          <PeriodLimitCard :period-limit="summary.periodLimit" />
          <UpcomingObligations :items="summary.upcomingObligations" />
          <BalanceList
            title="Счета"
            :items="summary.accounts"
            :warnings="summary.warnings"
            subject="ACCOUNT"
          />
          <BalanceList
            title="Конверты"
            :items="summary.envelopes"
            :warnings="summary.warnings"
            subject="ENVELOPE"
          />
        </section>
      </template>
  </div>
</template>

<style scoped>
.dashboard {
  color: var(--hf-color-text);
}

.dashboard-loading,
.dashboard-error {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
  align-items: center;
}

.dashboard-error {
  color: var(--hf-color-text-danger);
}

.dashboard-loading p,
.dashboard-error p {
  margin: 0;
}

.dashboard-header {
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
.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--hf-space-5);
}

@media (min-width: 768px) {
  .dashboard-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.total-money {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-top: 4px solid var(--hf-color-action-primary);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}

@media (min-width: 768px) {
  .total-money {
    grid-column: span 2;
  }
}

.total-money p {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: 0.875rem;
  font-weight: var(--hf-font-weight-medium);
}

.total-money > .finance-money {
  color: var(--hf-color-text);
  font-size: clamp(2rem, 4vw, 3.25rem);
  font-weight: var(--hf-font-weight-bold);
}
</style>
