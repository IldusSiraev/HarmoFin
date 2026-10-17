<script setup lang="ts">
import { computed, onMounted, ref, watch, type Component } from 'vue';
import { definePageMeta, navigateTo, useRoute } from '#imports';

import ExportPanelV2 from '../../components/analytics/ExportPanelV2.vue';
import ReportFilters, { type AnalyticsFilters } from '../../components/analytics/ReportFilters.vue';
import CashFlowTab from '../../components/analytics/tabs/CashFlowTab.vue';
import EnvelopesTab from '../../components/analytics/tabs/EnvelopesTab.vue';
import ExpensesTab from '../../components/analytics/tabs/ExpensesTab.vue';
import OverviewTab from '../../components/analytics/tabs/OverviewTab.vue';
import SavingsTab from '../../components/analytics/tabs/SavingsTab.vue';
import FilterPanel from '../../components/ui/FilterPanel.vue';
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiTabs from '../../components/ui/Tabs.vue';
import { useAuth } from '../../composables/useAuth.js';
import { useBudgetReferenceData } from '../../composables/useBudgetReferenceData.js';
import { type ReportV2Filters, useEnvelopePlanV2 } from '../../composables/useEnvelopePlanV2.js';

defineOptions({ name: 'BudgetAnalyticsPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

type TabId = 'overview' | 'expenses' | 'cash-flow' | 'envelopes' | 'savings';
type FilterName = keyof AnalyticsFilters;

const TABS: ReadonlyArray<{
  id: TabId;
  label: string;
  component: Component;
  filters: FilterName[];
}> = [
  { id: 'overview', label: 'Обзор', component: OverviewTab, filters: [] },
  {
    id: 'expenses',
    label: 'Расходы',
    component: ExpensesTab,
    filters: ['from', 'to', 'accountId', 'envelopeId'],
  },
  {
    id: 'cash-flow',
    label: 'Доходы и расходы',
    component: CashFlowTab,
    filters: ['from', 'to', 'accountId', 'categoryId'],
  },
  {
    id: 'envelopes',
    label: 'Конверты',
    component: EnvelopesTab,
    filters: ['from', 'to', 'envelopeId'],
  },
  { id: 'savings', label: 'Накопления', component: SavingsTab, filters: ['envelopeId', 'to'] },
];

// Shared links from the report-list page keep working: each old key opens its tab.
const LEGACY_REPORT_TABS: Record<string, TabId> = {
  'account-balances': 'overview',
  'expenses-by-category': 'expenses',
  'expenses-by-period': 'expenses',
  'expenses-by-cycle': 'expenses',
  'incomes-by-cycle': 'cash-flow',
  'net-cash-flow': 'cash-flow',
  'plan-vs-actual': 'cash-flow',
  'assignment-movements': 'envelopes',
  'savings-goals': 'savings',
};
const FILTER_NAMES: FilterName[] = ['from', 'to', 'accountId', 'categoryId', 'envelopeId'];

const auth = useAuth();
const route = useRoute();
const api = useBudgetReferenceData();
const v2 = useEnvelopePlanV2();
const loading = ref(true);
const legacy = typeof route.query.report === 'string';
const tab = ref<TabId>(tabFromQuery());
const filters = ref<AnalyticsFilters>(filtersFromQuery());
const accounts = ref<Array<{ value: string; label: string }>>([]);
const categories = ref<Array<{ value: string; label: string }>>([]);
const envelopes = ref<Array<{ value: string; label: string }>>([]);
const budget = computed(() => auth.currentData.value?.workspaces[0]?.budgets[0] ?? null);
const isOwner = computed(() => auth.currentData.value?.workspaces[0]?.role === 'OWNER');
const activeTab = computed(() => TABS.find((item) => item.id === tab.value) ?? TABS[0]!);

/** Only the filters of the active tab reach its reports; the others stay in the URL. */
const tabFilters = computed<ReportV2Filters>(() => {
  const result: ReportV2Filters = {};
  for (const name of activeTab.value.filters) {
    if (filters.value[name]) result[name] = filters.value[name];
  }
  return result;
});
const activeFilterCount = computed(() => Object.keys(tabFilters.value).length);

function tabFromQuery(): TabId {
  const value = route.query.tab;
  if (typeof value === 'string' && TABS.some((item) => item.id === value)) return value as TabId;
  const report = route.query.report;
  if (typeof report === 'string' && report in LEGACY_REPORT_TABS)
    return LEGACY_REPORT_TABS[report]!;
  return 'overview';
}

function filtersFromQuery(): AnalyticsFilters {
  const value = (name: string) =>
    typeof route.query[name] === 'string' ? (route.query[name] as string) : '';
  return {
    from: value('from'),
    to: value('to'),
    accountId: value('accountId'),
    categoryId: value('categoryId'),
    envelopeId: value('envelopeId'),
  };
}

function syncUrl() {
  const query: Record<string, string> = { tab: tab.value };
  for (const name of FILTER_NAMES) if (filters.value[name]) query[name] = filters.value[name];
  void navigateTo({ query }, { replace: true });
}

function selectTab(value: string) {
  tab.value = value as TabId;
  syncUrl();
}

function updateFilters(value: AnalyticsFilters) {
  filters.value = value;
  syncUrl();
}

// A browser back/forward move or an in-app link (e.g. "Все категории" →
// ?tab=expenses) changes the URL without going through selectTab/
// updateFilters, so the page must also react to external query changes.
// Only assign a ref when its value actually changed, so this never fights
// syncUrl's own navigateTo with an extra, identical reactive update.
watch(
  () => route.query,
  () => {
    const nextTab = tabFromQuery();
    if (nextTab !== tab.value) tab.value = nextTab;
    const nextFilters = filtersFromQuery();
    if (FILTER_NAMES.some((name) => nextFilters[name] !== filters.value[name])) {
      filters.value = nextFilters;
    }
  },
);

onMounted(async () => {
  if (legacy) syncUrl();
  if (!budget.value) await auth.loadMe();
  if (!budget.value) {
    loading.value = false;
    return;
  }
  const budgetId = budget.value.id;
  try {
    const [accountData, categoryData, envelopeData] = await Promise.all([
      api.listAccounts(budgetId, 'active'),
      api.listCategories(budgetId, undefined, 'active'),
      v2.listEnvelopes(budgetId),
    ]);
    accounts.value = accountData.map((item) => ({ value: item.id, label: item.name }));
    categories.value = categoryData.map((item) => ({ value: item.id, label: item.name }));
    envelopes.value = envelopeData.items
      .filter((item) => item.archivedAt === null)
      .map((item) => ({ value: item.id, label: item.name }));
  } catch {
    // Filter options are optional: reports still load, the selects only offer "Все …".
  } finally {
    loading.value = false;
  }
});
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
      <template v-if="activeTab.filters.length > 0" #filters>
        <FilterPanel :active-count="activeFilterCount">
          <ReportFilters
            :model-value="filters"
            :fields="activeTab.filters"
            :accounts="accounts"
            :categories="categories"
            :envelopes="envelopes"
            @update:model-value="updateFilters"
          />
        </FilterPanel>
      </template>
      <template #content>
        <UiTabs
          v-if="budget"
          :model-value="tab"
          :tabs="TABS"
          label="Разделы аналитики"
          @update:model-value="selectTab"
        >
          <component
            :is="activeTab.component"
            :key="activeTab.id"
            :budget-id="budget.id"
            :filters="tabFilters"
          />
        </UiTabs>
        <ExportPanelV2 v-if="budget" :budget-id="budget.id" :is-owner="isOwner" />
      </template>
    </ReferencePageLayout>
  </div>
</template>
