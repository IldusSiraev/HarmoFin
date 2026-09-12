<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { definePageMeta, navigateTo, useRoute } from '#imports';

import GoalProgressReport from '../../components/analytics/GoalProgressReport.vue';
import PlanVsActualReport from '../../components/analytics/PlanVsActualReport.vue';
import ReportChart from '../../components/analytics/ReportChart.vue';
import ReportFilters, { type AnalyticsFilters } from '../../components/analytics/ReportFilters.vue';
import UiButton from '../../components/ui/Button.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiSelect from '../../components/ui/Select.vue';
import { useAuth } from '../../composables/useAuth.js';
import {
  type GenericReportDto,
  type GoalProgressReportDto,
  type PlanVsActualReportDto,
  type ReportDto,
  type ReportKey,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'BudgetAnalyticsPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const auth = useAuth();
const route = useRoute();
const api = useBudgetReferenceData();
const loading = ref(true);
const error = ref('');
const report = ref<ReportDto | null>(null);
const reportKey = ref<ReportKey>(reportKeyFromQuery(route.query.report));
const filters = ref<AnalyticsFilters>(filtersFromQuery(route.query));
const accounts = ref<Array<{ value: string; label: string }>>([]);
const categories = ref<Array<{ value: string; label: string }>>([]);
const envelopes = ref<Array<{ value: string; label: string }>>([]);
const budget = computed(() => auth.currentData.value?.workspaces[0]?.budgets[0] ?? null);

onMounted(() => {
  void load();
});

async function load() {
  if (!budget.value) await auth.loadMe();
  if (!budget.value) {
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const [reportData, accountData, categoryData, envelopeData] = await Promise.all([
      api.getReport(budget.value.id, reportKey.value, reportFilters()),
      api.listAccounts(budget.value.id, 'active'),
      api.listCategories(budget.value.id, undefined, 'active'),
      api.listEnvelopes(budget.value.id, 'active'),
    ]);
    report.value = reportData;
    accounts.value = accountData.map((item) => ({ value: item.id, label: item.name }));
    categories.value = categoryData.map((item) => ({ value: item.id, label: item.name }));
    envelopes.value = envelopeData.map((item) => ({ value: item.id, label: item.name }));
  } catch {
    error.value = 'Не удалось загрузить отчёт.';
  } finally {
    loading.value = false;
  }
}

function updateFilters(value: AnalyticsFilters) {
  filters.value = value;
  updateUrlAndLoad();
}

function updateReportKey(value: string) {
  reportKey.value = value as ReportKey;
  updateUrlAndLoad();
}

function updateUrlAndLoad() {
  void navigateTo({ query: queryState() }, { replace: true });
  void load();
}

function reportFilters() {
  return {
    ...(filters.value.from ? { from: filters.value.from } : {}),
    ...(filters.value.to ? { to: filters.value.to } : {}),
    ...(filters.value.accountId ? { accountId: filters.value.accountId } : {}),
    ...(filters.value.categoryId ? { categoryId: filters.value.categoryId } : {}),
    ...(filters.value.envelopeId ? { envelopeId: filters.value.envelopeId } : {}),
    ...(filters.value.type ? { type: filters.value.type } : {}),
  };
}

function queryState() {
  return { report: reportKey.value, ...reportFilters() };
}

function filtersFromQuery(
  query: Record<string, string | null | Array<string | null> | undefined>,
): AnalyticsFilters {
  const value = (name: string) => (typeof query[name] === 'string' ? query[name] : '');
  const type = value('type');
  return {
    from: value('from'),
    to: value('to'),
    accountId: value('accountId'),
    categoryId: value('categoryId'),
    envelopeId: value('envelopeId'),
    type: type === 'INCOME' || type === 'EXPENSE' ? type : '',
  };
}

function isPlanVsActualReport(value: ReportDto | null): value is PlanVsActualReportDto {
  return value?.key === 'plan-vs-actual';
}

function isGoalProgressReport(value: ReportDto | null): value is GoalProgressReportDto {
  return value?.key === 'savings-goals';
}

function isGenericReport(value: ReportDto | null): value is GenericReportDto {
  return value !== null && !isPlanVsActualReport(value) && !isGoalProgressReport(value);
}

function reportKeyFromQuery(value: string | null | Array<string | null> | undefined): ReportKey {
  const keys: ReportKey[] = [
    'expenses-by-category',
    'expenses-by-period',
    'expenses-by-cycle',
    'incomes-by-cycle',
    'savings-reallocation-by-cycle',
    'net-cash-flow',
    'account-balances',
    'envelope-balances',
    'savings-goals',
    'plan-vs-actual',
  ];
  return typeof value === 'string' && keys.includes(value as ReportKey)
    ? (value as ReportKey)
    : 'expenses-by-category';
}
</script>

<template>
  <main class="analytics-page">
    <header>
      <p>Аналитика</p>
      <h1>Отчёты бюджета</h1>
    </header>
    <p v-if="error" role="alert" class="analytics-page__error">
      {{ error }} <UiButton variant="tertiary" @click="load">Повторить</UiButton>
    </p>
    <UiEmptyState
      v-if="!loading && !budget"
      title="Бюджет не выбран"
      description="Выберите активный бюджет для просмотра отчётов."
    />
    <template v-else>
      <UiSelect
        v-model="reportKey"
        name="reportKey"
        label="Отчёт"
        :options="[
          { value: 'expenses-by-category', label: 'Расходы по категориям' },
          { value: 'expenses-by-period', label: 'Расходы по периодам' },
          { value: 'expenses-by-cycle', label: 'Расходы по циклам' },
          { value: 'incomes-by-cycle', label: 'Доходы по циклам' },
          { value: 'savings-reallocation-by-cycle', label: 'Перераспределения накоплений' },
          { value: 'net-cash-flow', label: 'Чистый денежный поток' },
          { value: 'account-balances', label: 'Остатки счетов' },
          { value: 'envelope-balances', label: 'Остатки конвертов' },
          { value: 'savings-goals', label: 'Цели накоплений' },
          { value: 'plan-vs-actual', label: 'План и факт' },
        ]"
        @update:model-value="updateReportKey"
      />
      <ReportFilters
        v-model="filters"
        :accounts="accounts"
        :categories="categories"
        :envelopes="envelopes"
        @update:model-value="updateFilters"
      />
      <p v-if="loading">Загрузка отчёта…</p>
      <UiEmptyState
        v-else-if="report && report.rows.length === 0"
        title="Нет данных"
        description="Измените фильтры или добавьте подтверждённые операции."
      />
      <PlanVsActualReport v-else-if="isPlanVsActualReport(report)" :rows="report.rows" />
      <GoalProgressReport v-else-if="isGoalProgressReport(report)" :rows="report.rows" />
      <ReportChart v-else-if="isGenericReport(report)" :report="report" />
    </template>
  </main>
</template>

<style scoped>
.analytics-page {
  display: grid;
  gap: var(--hf-space-5);
  max-width: 70rem;
  margin: 0 auto;
  padding: var(--hf-space-8);
}
.analytics-page header p,
.analytics-page header h1,
.analytics-page__error {
  margin: 0;
}
.analytics-page header p {
  color: var(--hf-color-action-primary-hover);
  font-size: 0.8rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.analytics-page header h1 {
  margin-top: var(--hf-space-2);
  font-size: clamp(2rem, 4vw, 3.5rem);
  letter-spacing: -0.04em;
}
.analytics-page__error {
  color: var(--hf-color-text-danger);
}
@media (max-width: 47.9375rem) {
  .analytics-page {
    padding: var(--hf-space-5);
  }
}
</style>
