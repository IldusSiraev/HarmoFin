<script setup lang="ts">
import { onMounted, watch } from 'vue';

import { useAnalyticsReport } from '../../../composables/useAnalyticsReport.js';
import type { ReportV2Filters } from '../../../composables/useEnvelopePlanV2.js';
import type { GoalProgressRowDto } from '../../../composables/useBudgetReferenceData.js';
import GoalProgressReport from '../GoalProgressReport.vue';
import ReportCard from '../ReportCard.vue';

const props = defineProps<{ budgetId: string; filters: ReportV2Filters }>();
const goals = useAnalyticsReport('savings-goals');

function load() {
  void goals.load(props.budgetId, props.filters);
}
onMounted(load);
watch(() => props.filters, load, { deep: true });
</script>

<template>
  <div class="analytics-tab">
    <ReportCard
      title="Прогресс накоплений"
      :loading="goals.loading.value"
      :error="goals.error.value"
      :empty="false"
      @retry="load"
    >
      <GoalProgressReport :rows="goals.rows.value as unknown as GoalProgressRowDto[]" />
    </ReportCard>
  </div>
</template>

<style scoped>
.analytics-tab {
  display: grid;
  gap: var(--hf-space-5);
}
</style>
