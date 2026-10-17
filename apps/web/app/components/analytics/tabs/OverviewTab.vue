<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';

import { useAnalyticsReport } from '../../../composables/useAnalyticsReport.js';
import type { ReportV2Filters } from '../../../composables/useEnvelopePlanV2.js';
import FinanceMoney from '../../finance/FinanceMoney.vue';
import { formatMinorUnits } from '../../finance/money-format.js';
import UiMoreLink from '../../ui/MoreLink.vue';
import UiProgress from '../../ui/Progress.vue';
import ShareBar from '../charts/ShareBar.vue';
import { journalHref } from '../journal-href.js';
import { periodLabel } from '../period-label.js';
import ReportCard from '../ReportCard.vue';
import { comparisonText } from './comparison-text.js';

// The overview is always about the current period and today: tab filters do not apply.
const props = defineProps<{ budgetId: string; filters: ReportV2Filters }>();
const comparison = useAnalyticsReport('period-comparison');
const categories = useAnalyticsReport('expenses-by-category');
const accounts = useAnalyticsReport('account-balances');

const period = computed(() => comparison.rows.value[0] ?? null);

async function loadCategories() {
  const row = period.value;
  if (!row) return;
  await categories.load(props.budgetId, { from: row.periodStart, to: row.periodEnd });
}

async function load() {
  void accounts.load(props.budgetId);
  await comparison.load(props.budgetId);
  await loadCategories();
}
onMounted(() => void load());
watch(
  () => props.budgetId,
  () => void load(),
);

// The categories card depends on the period from `comparison`: while that is
// loading or failed, the card must show a skeleton/alert, never "no data" —
// an empty state here would misreport the financial status. Once comparison
// has resolved with no current period, there is nothing to load for
// categories (loadCategories never calls categories.load), so its own
// (permanently-true) loading flag must not be read in that case.
const categoriesLoading = computed(() => {
  if (comparison.loading.value) return true;
  if (comparison.error.value || period.value === null) return false;
  return categories.loading.value;
});
const categoriesError = computed(() =>
  comparison.error.value ? 'Не удалось загрузить отчёт.' : categories.error.value,
);
function retryCategories() {
  if (period.value === null) {
    void load();
  } else {
    void loadCategories();
  }
}

const money = (minor: string) => formatMinorUnits(minor, 'RUB', 2);
const topCategories = computed(() =>
  categories.rows.value.slice(0, 5).map((row) => ({
    id: row.categoryId,
    label: row.categoryName,
    amountMinor: row.expenseMinor,
    shareBasisPoints: row.shareBasisPoints,
    href: journalHref(row as unknown as Record<string, unknown>),
  })),
);
</script>

<template>
  <div class="analytics-tab">
    <ReportCard
      title="Текущий период"
      :loading="comparison.loading.value"
      :error="comparison.error.value"
      :empty="period === null"
      @retry="load"
    >
      <div v-if="period" class="overview-period">
        <p class="overview-period__dates">
          {{ periodLabel(period.periodStart, period.periodEnd) }}
        </p>
        <p class="overview-period__label">Потрачено</p>
        <FinanceMoney
          class="overview-period__amount"
          :minor-units="period.spentMinor"
          currency="RUB"
          :scale="2"
        />
        <template v-if="period.limitTotalMinor !== null">
          <UiProgress
            :value="period.spentMinor"
            :max="period.limitTotalMinor"
            :label="`Потрачено ${money(period.spentMinor)} из лимита ${money(period.limitTotalMinor)}`"
          />
          <p class="overview-period__muted">
            из лимита на период {{ money(period.limitTotalMinor) }}
          </p>
        </template>
        <p v-else class="overview-period__muted">Лимит на период не задан</p>
        <p class="overview-period__compare">{{ comparisonText(period) }}</p>
      </div>
    </ReportCard>
    <ReportCard
      title="Куда уходят деньги"
      :loading="categoriesLoading"
      :error="categoriesError"
      :empty="categories.rows.value.length === 0"
      empty-text="В этом периоде подтверждённых расходов пока нет."
      @retry="retryCategories"
    >
      <ShareBar :items="topCategories" />
      <UiMoreLink to="/app/analytics?tab=expenses">Все категории</UiMoreLink>
    </ReportCard>
    <ReportCard
      title="На счетах"
      :loading="accounts.loading.value"
      :error="accounts.error.value"
      :empty="accounts.rows.value.length === 0"
      empty-text="Добавьте счёт, чтобы видеть остатки."
      @retry="accounts.load(budgetId)"
    >
      <ul class="overview-accounts">
        <li v-for="row in accounts.rows.value" :key="row.accountId">
          <span>{{ row.name }}</span>
          <FinanceMoney :minor-units="row.balanceMinor" currency="RUB" :scale="2" />
        </li>
      </ul>
    </ReportCard>
  </div>
</template>

<style scoped>
.analytics-tab {
  display: grid;
  gap: var(--hf-space-5);
}
.overview-period {
  display: grid;
  gap: var(--hf-space-2);
}
.overview-period__dates,
.overview-period__label,
.overview-period__muted,
.overview-period__compare {
  margin: 0;
}
.overview-period__dates,
.overview-period__label,
.overview-period__muted {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
.overview-period__amount {
  font-size: var(--hf-font-size-h2);
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}
.overview-accounts {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.overview-accounts li {
  display: flex;
  justify-content: space-between;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  align-items: center;
  font-variant-numeric: tabular-nums;
}
</style>
