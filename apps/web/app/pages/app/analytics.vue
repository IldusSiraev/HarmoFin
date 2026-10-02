<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { definePageMeta, navigateTo, useRoute } from '#imports';

import ExportPanelV2 from '../../components/analytics/ExportPanelV2.vue';
import GoalProgressReport from '../../components/analytics/GoalProgressReport.vue';
import LegacyAssignmentsArchive from '../../components/analytics/LegacyAssignmentsArchive.vue';
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
  type ReportKey,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'BudgetAnalyticsPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const auth = useAuth();
const route = useRoute();
const api = useBudgetReferenceData();
const v2 = useEnvelopePlanV2();
const loading = ref(true);
const error = ref('');
const report = ref<ReportDto | null>(null);
type AnyReportKey = ReportKey | ReportV2Key;
const reportKey = ref<AnyReportKey>(reportKeyFromQuery(route.query.report));
const filters = ref<AnalyticsFilters>(filtersFromQuery(route.query));
const accounts = ref<Array<{ value: string; label: string }>>([]);
const categories = ref<Array<{ value: string; label: string }>>([]);
const envelopes = ref<Array<{ value: string; label: string }>>([]);
const budget = computed(() => auth.currentData.value?.workspaces[0]?.budgets[0] ?? null);
// The budget decides the model: v2 reads v2 reports/exports only (v1 ones answer 409).
const isV2 = computed(() => budget.value?.planModelVersion === 2);
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
  // A shared link may carry a key of the other model; fall back to the default.
  if (
    isV2.value ? !V2_KEYS.includes(reportKey.value) : reportKey.value === 'assignment-movements'
  ) {
    reportKey.value = 'expenses-by-category';
  }
  loading.value = true;
  error.value = '';
  try {
    if (isV2.value) {
      await loadV2(budget.value.id);
      return;
    }
    const [reportData, accountData, categoryData, envelopeData] = await Promise.all([
      api.getReport(budget.value.id, reportKey.value as ReportKey, reportFilters()),
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

async function loadV2(budgetId: string) {
  const [reportData, accountData, categoryData, envelopeData] = await Promise.all([
    v2.getReport(budgetId, reportKey.value as ReportV2Key, reportFilters()),
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
}

function updateFilters(value: AnalyticsFilters) {
  filters.value = value;
  updateUrlAndLoad();
}

function updateReportKey(value: string) {
  reportKey.value = value as AnyReportKey;
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
    ...(filters.value.type && !isV2.value ? { type: filters.value.type } : {}),
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

const V2_KEYS: ReadonlyArray<string> = REPORT_V2_KEYS;

function reportKeyFromQuery(value: string | null | Array<string | null> | undefined): AnyReportKey {
  const keys: AnyReportKey[] = [
    'assignment-movements',
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
  return typeof value === 'string' && keys.includes(value as AnyReportKey)
    ? (value as AnyReportKey)
    : 'expenses-by-category';
}

const V1_OPTIONS = [
  { value: 'expenses-by-category', label: 'Расходы по категориям' },
  { value: 'expenses-by-period', label: 'Расходы по периодам' },
  { value: 'expenses-by-cycle', label: 'Расходы по циклам' },
  { value: 'incomes-by-cycle', label: 'Доходы по циклам' },
  { value: 'savings-reallocation-by-cycle', label: 'Перераспределения накоплений' },
  { value: 'net-cash-flow', label: 'Доходы минус расходы' },
  { value: 'account-balances', label: 'Остатки счетов' },
  { value: 'envelope-balances', label: 'Остатки конвертов' },
  { value: 'savings-goals', label: 'Цели накоплений' },
  { value: 'plan-vs-actual', label: 'План и факт' },
];
// v2 has no physical envelope balance report: savings goals show the assigned balance.
const V2_OPTIONS = [
  { value: 'expenses-by-category', label: 'Расходы по категориям' },
  { value: 'expenses-by-period', label: 'Расходы по периодам' },
  { value: 'expenses-by-cycle', label: 'Расходы по циклам' },
  { value: 'incomes-by-cycle', label: 'Доходы по циклам' },
  { value: 'net-cash-flow', label: 'Доходы минус расходы' },
  { value: 'account-balances', label: 'Остатки счетов' },
  { value: 'savings-goals', label: 'Цели накоплений (назначено)' },
  { value: 'plan-vs-actual', label: 'План и факт' },
  { value: 'assignment-movements', label: 'Назначения и переносы' },
];
const reportOptions = computed(() => (isV2.value ? V2_OPTIONS : V1_OPTIONS));

function activeFilterCount() {
  const advanced: Array<string> = [
    filters.value.from,
    filters.value.to,
    filters.value.type,
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
            :hide-type="isV2"
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
        <GoalProgressReport
          v-else-if="isGoalProgressReport(report)"
          :rows="report.rows"
          :v2="isV2"
        />
        <ReportTable
          v-else-if="isV2 && report && report.key === 'assignment-movements'"
          :rows="report.rows"
          hide-journal
        />
        <ReportChart v-else-if="isGenericReport(report)" :report="report" />
        <template v-if="isV2 && budget">
          <ExportPanelV2 :budget-id="budget.id" :is-owner="isOwner" />
          <LegacyAssignmentsArchive :budget-id="budget.id" :is-owner="isOwner" />
        </template>
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
