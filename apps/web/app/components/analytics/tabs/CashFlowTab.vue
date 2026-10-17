<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';

import { useAnalyticsReport } from '../../../composables/useAnalyticsReport.js';
import type { ReportV2Filters } from '../../../composables/useEnvelopePlanV2.js';
import { formatMinorUnits } from '../../finance/money-format.js';
import ColumnChart from '../charts/ColumnChart.vue';
import { journalHref } from '../journal-href.js';
import { periodLabel } from '../period-label.js';
import PlanVsActualReport from '../PlanVsActualReport.vue';
import ReportCard from '../ReportCard.vue';

const props = defineProps<{ budgetId: string; filters: ReportV2Filters }>();
const flow = useAnalyticsReport('net-cash-flow');
const plans = useAnalyticsReport('plan-vs-actual');

function load() {
  void flow.load(props.budgetId, props.filters);
  void plans.load(props.budgetId, props.filters);
}
onMounted(load);
watch(() => props.filters, load, { deep: true });

function signed(minor: string) {
  const negative = minor.startsWith('-');
  const amount = formatMinorUnits(negative ? minor.slice(1) : minor, 'RUB', 2);
  return minor === '0' ? amount : `${negative ? '−' : '+'}${amount}`;
}

const cycleColumns = computed(() =>
  flow.rows.value.map((row) => ({
    id: row.cycleStart,
    label: periodLabel(row.cycleStart, row.cycleEnd),
    values: [
      { seriesId: 'income', amountMinor: row.incomeMinor },
      { seriesId: 'expense', amountMinor: row.expenseMinor },
    ],
    caption: signed(row.netCashFlowMinor),
    href: journalHref(row as unknown as Record<string, unknown>),
  })),
);
</script>

<template>
  <div class="analytics-tab">
    <ReportCard
      title="Доходы и расходы по циклам"
      :loading="flow.loading.value"
      :error="flow.error.value"
      :empty="flow.rows.value.length === 0"
      @retry="flow.load(budgetId, filters)"
    >
      <ColumnChart
        label="Доходы и расходы"
        :columns="cycleColumns"
        :series="[
          { id: 'income', label: 'Доходы', tone: 2 },
          { id: 'expense', label: 'Расходы', tone: 1 },
        ]"
      />
      <p class="cash-flow__hint">Под каждым циклом — доходы минус расходы.</p>
    </ReportCard>
    <ReportCard
      title="Регулярные платежи: план и факт"
      :loading="plans.loading.value"
      :error="plans.error.value"
      :empty="plans.rows.value.length === 0"
      @retry="plans.load(budgetId, filters)"
    >
      <p class="cash-flow__range">
        {{ filters.from && filters.to ? 'За выбранные даты.' : 'За текущий финансовый цикл.' }}
      </p>
      <PlanVsActualReport :rows="plans.rows.value" />
    </ReportCard>
  </div>
</template>

<style scoped>
.analytics-tab {
  display: grid;
  gap: var(--hf-space-5);
}
.cash-flow__hint,
.cash-flow__range {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
</style>
