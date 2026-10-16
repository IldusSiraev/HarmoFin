<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { definePageMeta, navigateTo, useRoute } from '#imports';

import ExportPanelV2 from '../../components/analytics/ExportPanelV2.vue';
import GoalProgressReport from '../../components/analytics/GoalProgressReport.vue';
import PlanVsActualReport from '../../components/analytics/PlanVsActualReport.vue';
import ReportChart from '../../components/analytics/ReportChart.vue';
import ReportFilters, { type AnalyticsFilters } from '../../components/analytics/ReportFilters.vue';
import ReportTable from '../../components/analytics/ReportTable.vue';
import FilterPanel from '../../components/ui/FilterPanel.vue';
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../components/ui/Button.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiSelect from '../../components/ui/Select.vue';
import { useAuth } from '../../composables/useAuth.js';
import {
  REPORT_V2_KEYS,
  type ReportV2Key,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
import {
  type GenericReportDto,
  type GoalProgressReportDto,
  type PlanVsActualReportDto,
  type ReportDto,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'BudgetAnalyticsPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const V2_KEYS: ReadonlyArray<string> = REPORT_V2_KEYS;

const auth = useAuth();
const route = useRoute();
const api = useBudgetReferenceData();
const v2 = useEnvelopePlanV2();
const loading = ref(true);
const error = ref('');
const report = ref<ReportDto | null>(null);
const reportKey = ref<ReportV2Key>(reportKeyFromQuery(route.query.report));
const filters = ref<AnalyticsFilters>(filtersFromQuery(route.query));
const accounts = ref<Array<{ value: string; label: string }>>([]);
const categories = ref<Array<{ value: string; label: string }>>([]);
const envelopes = ref<Array<{ value: string; label: string }>>([]);
const budget = computed(() => auth.currentData.value?.workspaces[0]?.budgets[0] ?? null);
const isOwner = computed(() => auth.currentData.value?.workspaces[0]?.role === 'OWNER');

onMounted(() => {
  void load();
});

async function load() {
  if (!budget.value) await auth.loadMe();
  if (!budget.value) {
    loading.value = false;
    return;
  }
  // A shared link may carry an unknown key; fall back to the default.
  if (!V2_KEYS.includes(reportKey.value)) reportKey.value = 'expenses-by-category';
  loading.value = true;
  error.value = '';
  try {
    const budgetId = budget.value.id;
    const [reportData, accountData, categoryData, envelopeData] = await Promise.all([
      v2.getReport(budgetId, reportKey.value, reportFilters()),
      api.listAccounts(budgetId, 'active'),
      api.listCategories(budgetId, undefined, 'active'),
      v2.listEnvelopes(budgetId),
    ]);
    report.value = reportData as ReportDto;
    accounts.value = accountData.map((item) => ({ value: item.id, label: item.name }));
    categories.value = categoryData.map((item) => ({ value: item.id, label: item.name }));
    envelopes.value = envelopeData.items
      .filter((item) => item.archivedAt === null)
      .map((item) => ({ value: item.id, label: item.name }));
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
  reportKey.value = value as ReportV2Key;
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
  };
}

function queryState() {
  return { report: reportKey.value, ...reportFilters() };
}

function filtersFromQuery(
  query: Record<string, string | null | Array<string | null> | undefined>,
): AnalyticsFilters {
  const value = (name: string) => (typeof query[name] === 'string' ? query[name] : '');
  return {
    from: value('from'),
    to: value('to'),
    accountId: value('accountId'),
    categoryId: value('categoryId'),
    envelopeId: value('envelopeId'),
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

function reportKeyFromQuery(value: string | null | Array<string | null> | undefined): ReportV2Key {
  return typeof value === 'string' && V2_KEYS.includes(value)
    ? (value as ReportV2Key)
    : 'expenses-by-category';
}

// There is no physical envelope balance report: savings goals show the assigned balance.
const reportOptions = [
  { value: 'expenses-by-category', label: 'Расходы по категориям' },
  { value: 'expenses-by-period', label: 'Расходы по периодам' },
  { value: 'expenses-by-cycle', label: 'Расходы по циклам' },
  { value: 'incomes-by-cycle', label: 'Доходы по циклам' },
  { value: 'net-cash-flow', label: 'Доходы минус расходы' },
  { value: 'account-balances', label: 'Остатки счетов' },
  { value: 'savings-goals', label: 'Цели накоплений (отложено)' },
  { value: 'plan-vs-actual', label: 'План и факт' },
  { value: 'assignment-movements', label: 'Распределения и переносы' },
];

function activeFilterCount() {
  const advanced: Array<string> = [
    filters.value.from,
    filters.value.to,
    filters.value.accountId,
    filters.value.categoryId,
    filters.value.envelopeId,
  ];
  return advanced.filter((value) => value !== '').length;
}
</script>

<template>
  <div class="analytics-page">
    <UiEmptyState
      v-if="!loading && !budget"
      title="Бюджет не выбран"
      description="Выберите активный бюджет для просмотра отчётов."
    />
    <ReferencePageLayout v-else>
      <template #kicker>Аналитика</template>
      <template #title>Отчёты бюджета</template>
      <template #filters>
        <UiSelect
          v-model="reportKey"
          name="reportKey"
          label="Отчёт"
          :options="reportOptions"
          @update:model-value="updateReportKey"
        />
        <FilterPanel :active-count="activeFilterCount()">
          <ReportFilters
            v-model="filters"
            :accounts="accounts"
            :categories="categories"
            :envelopes="envelopes"
            @update:model-value="updateFilters"
          />
        </FilterPanel>
      </template>
      <template #content>
        <p v-if="error" role="alert" class="analytics-page__error">
          {{ error }} <UiButton variant="tertiary" @click="load">Повторить</UiButton>
        </p>
        <p v-if="loading">Загрузка отчёта…</p>
        <UiEmptyState
          v-else-if="report && report.rows.length === 0"
          title="Нет данных"
          description="Измените фильтры или добавьте подтверждённые операции."
        />
        <PlanVsActualReport v-else-if="isPlanVsActualReport(report)" :rows="report.rows" />
        <GoalProgressReport v-else-if="isGoalProgressReport(report)" :rows="report.rows" />
        <ReportTable
          v-else-if="report && report.key === 'assignment-movements'"
          :rows="report.rows"
          hide-journal
        />
        <ReportChart v-else-if="isGenericReport(report)" :report="report" />
        <ExportPanelV2 v-if="budget" :budget-id="budget.id" :is-owner="isOwner" />
      </template>
    </ReferencePageLayout>
  </div>
</template>

<style scoped>
.analytics-page__error {
  margin: 0;
  color: var(--hf-color-text-danger);
}
</style>
