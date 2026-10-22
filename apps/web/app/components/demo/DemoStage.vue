<script setup lang="ts">
import { computed } from 'vue';

import GoalProgressReport from '../analytics/GoalProgressReport.vue';
import AvailableBudgetCard from '../dashboard/AvailableBudgetCard.vue';
import UpcomingObligations from '../dashboard/UpcomingObligations.vue';
import EnvelopePlanRow from '../envelopes/EnvelopePlanRow.vue';
import LandingShowcase from '../landing/ui/LandingShowcase.vue';
import CyclePreview from '../settings/CyclePreview.vue';
import type { DemoPeriodDates } from '../../data/demo-period-dates.js';
import {
  toDashboard,
  toEnvelopeRows,
  toGoalRows,
  type DemoSnapshot,
} from '../../data/demo-scenario.js';

defineOptions({ name: 'DemoStage' });

const props = defineProps<{
  step: number;
  snapshot: DemoSnapshot;
  dates: DemoPeriodDates;
  asOf: string;
  caption: string;
  cycle: { start: number; offset: number };
}>();

const dashboard = computed(() => toDashboard(props.snapshot, props.dates, props.asOf));
const envelopes = computed(() => toEnvelopeRows(props.snapshot));
const goals = computed(() => toGoalRows(props.snapshot));
</script>

<template>
  <LandingShowcase :caption="caption">
    <div class="demo-stage">
      <CyclePreview
        v-if="step === 0"
        :cycle-start-day="cycle.start"
        :period-boundary-offset="cycle.offset"
      />
      <template v-else>
        <AvailableBudgetCard v-if="step <= 5" :dashboard="dashboard" show-free-money />
        <div v-if="step >= 2" class="demo-stage__envelopes">
          <EnvelopePlanRow v-for="envelope in envelopes" :key="envelope.id" :envelope="envelope" />
        </div>
        <UpcomingObligations
          v-if="step === 2 || step === 3"
          :items="dashboard.nearestObligations"
        />
        <GoalProgressReport v-if="step === 6" :rows="goals" />
      </template>
    </div>
  </LandingShowcase>
</template>

<style scoped>
.demo-stage,
.demo-stage__envelopes {
  display: grid;
  gap: var(--hf-space-4);
}
</style>
