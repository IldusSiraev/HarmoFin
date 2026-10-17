<script setup lang="ts">
import { Check } from '@lucide/vue';

import ColumnChart from '../../analytics/charts/ColumnChart.vue';
import LimitBar from '../../analytics/charts/LimitBar.vue';
import ShareBar from '../../analytics/charts/ShareBar.vue';
import GoalProgressReport from '../../analytics/GoalProgressReport.vue';
import { periodLabel } from '../../analytics/period-label.js';
import type { EnvelopeLimitV2Row } from '../../../composables/useEnvelopePlanV2.js';
import { formatMinorUnits } from '../../finance/money-format.js';
import LandingSection from '../ui/LandingSection.vue';
import LandingShowcase from '../ui/LandingShowcase.vue';
import {
  demoCashFlowRows,
  demoExpenseByCategoryRows,
  demoGoalRows,
  demoLimitRows,
} from '../../../data/landing-demo.js';
import { reportNames } from '../../../data/landing.js';

defineOptions({ name: 'SavingsReportsSection' });

// Demo rows are only re-shaped for the charts: no money is computed here, and
// no journal links are passed because the showcases are inert.
const shareItems = demoExpenseByCategoryRows.map((row) => ({
  id: row.categoryId,
  label: row.categoryName,
  amountMinor: row.expenseMinor,
  shareBasisPoints: row.shareBasisPoints,
}));

const limitPeriod = (row: EnvelopeLimitV2Row) =>
  periodLabel(row.periodStart, row.periodEnd) + (row.isCurrent ? ' · текущий период' : '');

const cycleSeries = [
  { id: 'income', label: 'Доходы', tone: 2 as const },
  { id: 'expense', label: 'Расходы', tone: 1 as const },
];

// Same wording as the analytics cash-flow tab: the sign comes from the row.
function signed(minor: string) {
  const negative = minor.startsWith('-');
  const amount = formatMinorUnits(negative ? minor.slice(1) : minor, 'RUB', 2);
  return minor === '0' ? amount : `${negative ? '−' : '+'}${amount}`;
}

const cycleColumns = demoCashFlowRows.map((row) => ({
  id: row.cycleStart,
  label: periodLabel(row.cycleStart, row.cycleEnd),
  values: [
    { seriesId: 'income', amountMinor: row.incomeMinor },
    { seriesId: 'expense', amountMinor: row.expenseMinor },
  ],
  caption: signed(row.netCashFlowMinor),
}));
</script>

<template>
  <LandingSection
    section-id="reports"
    eyebrow="Накопления и отчёты"
    title="Копите на цели и смотрите, куда уходят деньги"
    description="Накопления не сбрасываются при смене периода. Отчёты строятся только по подтверждённым операциям."
  >
    <div class="reports__layout">
      <LandingShowcase
        caption="Расходы по категориям за период 25.09–09.10: 33 500 ₽, больше всего — продукты, 14 500 ₽."
      >
        <ShareBar :items="shareItems" />
      </LandingShowcase>
      <LandingShowcase
        caption="Лимит на период: в текущем потрачено 33 500 ₽ из 65 000 ₽, в прошлом осталось 4 300 ₽, в позапрошлом перерасход 2 400 ₽."
      >
        <div v-for="row in demoLimitRows" :key="row.periodId" class="reports__limit">
          <p class="reports__period">{{ limitPeriod(row) }}</p>
          <LimitBar :row="row" />
        </div>
      </LandingShowcase>
      <LandingShowcase
        caption="Доходы и расходы по финансовым циклам: в текущем цикле доходы на 68 200 ₽ больше расходов."
      >
        <ColumnChart label="Доходы и расходы" :columns="cycleColumns" :series="cycleSeries" />
      </LandingShowcase>
      <LandingShowcase
        caption="Цели накоплений: ремонт — 70 000 ₽ из 120 000 ₽, отпуск — 42 000 ₽ из 100 000 ₽."
      >
        <GoalProgressReport :rows="demoGoalRows" />
      </LandingShowcase>
    </div>
    <ul class="reports__list" aria-label="Отчёты в HarmoFin">
      <li v-for="name in reportNames" :key="name" class="reports__item">
        <Check :size="16" aria-hidden="true" />
        <span>{{ name }}</span>
      </li>
    </ul>
  </LandingSection>
</template>

<style scoped>
.reports__layout {
  display: grid;
  gap: var(--hf-space-6);
}

@media (min-width: 1024px) {
  .reports__layout {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
  }
}

.reports__limit {
  display: grid;
  gap: var(--hf-space-2);
}

.reports__period {
  margin: 0;
  font-size: var(--hf-font-size-small);
  color: var(--hf-color-text-muted);
}

.reports__list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3) var(--hf-space-6);
  margin: var(--hf-space-6) 0 0;
  padding: 0;
  list-style: none;
}

.reports__item {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  color: var(--hf-color-text-muted);
}

.reports__item svg {
  color: var(--hf-color-brand);
}
</style>
