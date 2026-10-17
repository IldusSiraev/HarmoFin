<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { useAnalyticsReport } from '../../../composables/useAnalyticsReport.js';
import type { ReportV2Filters } from '../../../composables/useEnvelopePlanV2.js';
import LimitBar from '../charts/LimitBar.vue';
import { periodLabel } from '../period-label.js';
import ReportCard from '../ReportCard.vue';
import ReportTable from '../ReportTable.vue';
import UiSelect from '../../ui/Select.vue';

const props = defineProps<{ budgetId: string; filters: ReportV2Filters }>();
const limits = useAnalyticsReport('envelope-limits');
const movements = useAnalyticsReport('assignment-movements');
const selected = ref('');

function load() {
  void limits.load(props.budgetId, props.filters);
  void movements.load(props.budgetId, props.filters);
}
onMounted(load);
watch(() => props.filters, load, { deep: true });

const periodOptions = computed(() => {
  const seen = new Map<string, { value: string; label: string }>();
  for (const row of limits.rows.value) {
    const value = `${row.periodStart}:${row.periodEnd}`;
    if (!seen.has(value)) {
      seen.set(value, {
        value,
        label: `${periodLabel(row.periodStart, row.periodEnd)}${row.isCurrent ? ' (текущий)' : ''}`,
      });
    }
  }
  return [...seen.values()];
});

watch(
  () => limits.rows.value,
  (rows) => {
    const current = rows.find((row) => row.isCurrent) ?? rows[0];
    selected.value = current ? `${current.periodStart}:${current.periodEnd}` : '';
  },
);

const visible = computed(() =>
  limits.rows.value.filter((row) => `${row.periodStart}:${row.periodEnd}` === selected.value),
);
</script>

<template>
  <div class="analytics-tab">
    <ReportCard
      title="Лимиты на период"
      :loading="limits.loading.value"
      :error="limits.error.value"
      :empty="limits.rows.value.length === 0"
      empty-text="Нет конвертов «На текущие траты» с периодами в выбранных датах."
      @retry="limits.load(budgetId, filters)"
    >
      <template v-if="periodOptions.length > 0" #actions>
        <UiSelect
          v-model="selected"
          name="limitPeriod"
          label="Период"
          :options="periodOptions"
          class="envelopes-tab__period"
        />
      </template>
      <LimitBar v-for="row in visible" :key="row.periodId" :row="row" />
    </ReportCard>
    <ReportCard
      title="Распределения и переносы"
      :loading="movements.loading.value"
      :error="movements.error.value"
      :empty="movements.rows.value.length === 0"
      @retry="movements.load(budgetId, filters)"
    >
      <ReportTable :rows="movements.rows.value" hide-journal />
    </ReportCard>
  </div>
</template>

<style scoped>
.analytics-tab {
  display: grid;
  gap: var(--hf-space-5);
}

.envelopes-tab__period {
  width: 14rem;
  max-width: 100%;
}
</style>
