<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { definePageMeta, navigateTo } from '#imports';

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

definePageMeta({ middleware: 'auth' });

const { currentData, loadMe, logout } = useAuth();
const api = useBudgetReferenceData();
const loading = ref(true);
const error = ref('');
const summary = ref<DashboardSummaryDto | null>(null);
const activeBudget = computed(() => currentData.value?.workspaces[0]?.budgets[0] ?? null);
function workspaceName() {
  return currentData.value?.workspaces[0]?.name ?? 'Бюджет';
}

function userEmail() {
  return currentData.value?.user?.email ?? '';
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

async function signOut() {
  await logout();
  await navigateTo('/login');
}
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <NuxtLink class="app-wordmark" to="/app">HarmoFin</NuxtLink>
      <UiButton variant="tertiary" @click="signOut">Выйти</UiButton>
    </header>
    <section class="app-content" aria-live="polite">
      <p v-if="loading">Загрузка бюджета…</p>
      <div v-else-if="error" class="app-error" role="alert">
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
        <p class="app-kicker">{{ workspaceName() }}</p>
        <h1>{{ activeBudget.name }}</h1>
        <p class="app-user">{{ userEmail() }}</p>
        <nav class="app-navigation" aria-label="Разделы бюджета">
          <NuxtLink to="/app/operations">Операции</NuxtLink>
          <NuxtLink to="/app/accounts">Счета</NuxtLink>
          <NuxtLink to="/app/envelopes">Конверты</NuxtLink>
          <NuxtLink to="/app/plans">Планы</NuxtLink>
          <NuxtLink to="/app/notifications">Уведомления</NuxtLink>
          <NuxtLink to="/app/analytics">Аналитика</NuxtLink>
        </nav>
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
    </section>
  </main>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  color: var(--hf-color-text);
  background: var(--hf-color-page-background);
}
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-4);
  max-width: 70rem;
  margin: 0 auto;
  padding: var(--hf-space-5) var(--hf-space-8);
}
.app-wordmark {
  color: var(--hf-color-text);
  font-size: 1.18rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: -0.04em;
  text-decoration: none;
}
.app-content {
  max-width: 70rem;
  margin: var(--hf-space-8) auto 0;
  padding: var(--hf-space-8);
}
.app-kicker {
  margin: 0 0 var(--hf-space-3);
  color: var(--hf-color-action-primary-hover);
  font-size: 0.74rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
h1 {
  margin: 0;
  font-size: clamp(2.4rem, 5vw, 4.7rem);
  line-height: 0.95;
  letter-spacing: -0.04em;
}
.app-user {
  color: var(--hf-color-text-muted);
}
.app-navigation {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-4);
  margin: var(--hf-space-6) 0;
}
.app-navigation a {
  color: var(--hf-color-action-primary-hover);
  font-weight: var(--hf-font-weight-bold);
  text-decoration: none;
}
.app-navigation a:hover {
  text-decoration: underline;
}
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--hf-space-5);
}
.total-money {
  display: grid;
  gap: var(--hf-space-2);
  padding: var(--hf-card-padding);
  border-top: 4px solid var(--hf-color-action-primary);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.total-money p {
  margin: 0;
  color: var(--hf-color-text-muted);
}
.total-money > .finance-money {
  font-size: clamp(2rem, 4vw, 3.25rem);
  font-weight: var(--hf-font-weight-bold);
}
.app-error {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
  align-items: center;
  color: var(--hf-color-text-danger);
}
@media (max-width: 47.9375rem) {
  .app-header,
  .app-content {
    padding-right: var(--hf-space-5);
    padding-left: var(--hf-space-5);
  }
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}
</style>
