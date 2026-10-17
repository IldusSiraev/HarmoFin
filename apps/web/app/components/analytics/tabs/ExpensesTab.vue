<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';

import { useAnalyticsReport } from '../../../composables/useAnalyticsReport.js';
import type { ReportV2Filters } from '../../../composables/useEnvelopePlanV2.js';
import ColumnChart from '../charts/ColumnChart.vue';
import ShareBar from '../charts/ShareBar.vue';
import { journalHref } from '../journal-href.js';
import { periodLabel } from '../period-label.js';
import ReportCard from '../ReportCard.vue';

const props = defineProps<{ budgetId: string; filters: ReportV2Filters }>();
const byCategory = useAnalyticsReport('expenses-by-category');
const byPeriod = useAnalyticsReport('expenses-by-period');

function load() {
  void byCategory.load(props.budgetId, props.filters);
  void byPeriod.load(props.budgetId, props.filters);
}
onMounted(load);
watch(() => props.filters, load, { deep: true });

const shareItems = computed(() =>
  byCategory.rows.value.map((row) => ({
    id: row.categoryId,
    label: row.categoryName,
    amountMinor: row.expenseMinor,
    shareBasisPoints: row.shareBasisPoints,
    href: journalHref(row as unknown as Record<string, unknown>),
  })),
);
const periodColumns = computed(() =>
  byPeriod.rows.value.map((row) => ({
    id: `${row.periodStart}:${row.periodEnd}`,
    label: periodLabel(row.periodStart, row.periodEnd),
    values: [{ seriesId: 'expense', amountMinor: row.expenseMinor }],
    href: journalHref(row as unknown as Record<string, unknown>),
  })),
);
</script>

<template>
  <div class="analytics-tab">
    <ReportCard
      title="Структура расходов"
      :loading="byCategory.loading.value"
      :error="byCategory.error.value"
      :empty="byCategory.rows.value.length === 0"
      @retry="byCategory.load(budgetId, filters)"
    >
      <ShareBar :items="shareItems" />
    </ReportCard>
    <ReportCard
      title="Расходы по периодам"
      :loading="byPeriod.loading.value"
      :error="byPeriod.error.value"
      :empty="byPeriod.rows.value.length === 0"
      @retry="byPeriod.load(budgetId, filters)"
    >
      <ColumnChart
        label="Расходы за период"
        :columns="periodColumns"
        :series="[{ id: 'expense', label: 'Расходы', tone: 1 }]"
      />
    </ReportCard>
  </div>
</template>

<style scoped>
.analytics-tab {
  display: grid;
  gap: var(--hf-space-5);
}
</style>
