<script setup lang="ts">
import { Check } from '@lucide/vue';

import GoalProgressReport from '../../analytics/GoalProgressReport.vue';
import PlanVsActualReport from '../../analytics/PlanVsActualReport.vue';
import LandingSection from '../ui/LandingSection.vue';
import LandingShowcase from '../ui/LandingShowcase.vue';
import { demoGoalRows, demoPlanRows } from '../../../data/landing-demo.js';
import { reportNames } from '../../../data/landing.js';

defineOptions({ name: 'SavingsReportsSection' });
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
        caption="Цели накоплений: ремонт — 70 000 ₽ из 120 000 ₽, отпуск — 42 000 ₽ из 100 000 ₽."
      >
        <GoalProgressReport :rows="demoGoalRows" />
      </LandingShowcase>
      <LandingShowcase
        caption="План и факт: зарплата и ипотека совпали с планом, коммунальные платежи вышли на 620 ₽ больше."
      >
        <PlanVsActualReport :rows="demoPlanRows" />
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

/*
 * The plan-vs-actual table is wide (min-width ~50rem) and scrolls horizontally in the
 * app. Inside an inert showcase that scroll cannot be used, so the reports are
 * stacked full width (wide enough on desktop) and, on narrow screens, the table
 * is clipped with a fade instead of showing a dead scrollbar. The figcaption
 * carries the full numbers.
 */
.reports__layout :deep(.plan-vs-actual__table-wrap) {
  overflow: hidden;
  mask-image: linear-gradient(to right, #000 85%, transparent);
}

@media (min-width: 1024px) {
  .reports__layout :deep(.plan-vs-actual__table-wrap) {
    mask-image: none;
  }
}
</style>
