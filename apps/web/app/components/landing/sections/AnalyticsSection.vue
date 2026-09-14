<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

import LandingSection from '../ui/LandingSection.vue';
import { useRevealOnScroll } from '../../../composables/useRevealOnScroll.js';

defineOptions({ name: 'AnalyticsSection' });

const DonutChart = defineAsyncComponent(() => import('../mockups/DonutChart.vue'));
const CashFlowChart = defineAsyncComponent(() => import('../mockups/CashFlowChart.vue'));
const PlanVsFactBars = defineAsyncComponent(() => import('../mockups/PlanVsFactBars.vue'));

const { target, revealed } = useRevealOnScroll();
</script>

<template>
  <LandingSection
    section-id="analytics"
    tone="muted"
    eyebrow="Аналитика"
    title="Понимайте не только сегодня, но и всю картину."
    description="Смотрите расходы по категориям, периодам, циклам, счетам и конвертам — и переходите от показателя к исходным операциям."
  >
    <div ref="target" class="analytics__grid">
      <template v-if="revealed">
        <div class="analytics__card">
          <h3 class="analytics__card-title">Расходы по категориям</h3>
          <DonutChart />
        </div>
        <div class="analytics__card">
          <h3 class="analytics__card-title">Денежный поток</h3>
          <CashFlowChart />
        </div>
        <div class="analytics__card analytics__card--wide">
          <h3 class="analytics__card-title">План и факт</h3>
          <PlanVsFactBars />
        </div>
      </template>
    </div>
  </LandingSection>
</template>

<style scoped>
.analytics__grid {
  display: grid;
  gap: var(--hf-space-4);
  min-height: 18rem;
}

.analytics__card {
  display: grid;
  gap: var(--hf-space-4);
  align-content: start;
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-xs);
}

.analytics__card-title {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
  font-weight: var(--hf-font-weight-semibold);
}

@media (min-width: 1024px) {
  .analytics__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .analytics__card--wide {
    grid-column: 1 / -1;
  }
}
</style>
