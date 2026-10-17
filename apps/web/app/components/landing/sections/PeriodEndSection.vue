<script setup lang="ts">
import { ArrowRight, PiggyBank, Clock } from '@lucide/vue';

import PeriodDecisionCard from '../../dashboard/PeriodDecisionCard.vue';
import LandingCard from '../ui/LandingCard.vue';
import LandingSection from '../ui/LandingSection.vue';
import LandingShowcase from '../ui/LandingShowcase.vue';
import { demoDashboard } from '../../../data/landing-demo.js';
import { periodEndActions } from '../../../data/landing.js';

defineOptions({ name: 'PeriodEndSection' });

const icons = [ArrowRight, PiggyBank, Clock];
</script>

<template>
  <LandingSection
    section-id="period-end"
    tone="muted"
    eyebrow="Периоды и лимит"
    title="Остаток в конце периода не исчезает"
    description="Финансовый цикл делится на два периода — например, от аванса до зарплаты. На каждый период вы задаёте лимит на текущие траты. Если что-то осталось, вы решаете, куда это направить."
  >
    <div class="period-end__layout">
      <div class="period-end__cards">
        <LandingCard
          v-for="(action, index) in periodEndActions"
          :key="action.title"
          :title="action.title"
        >
          <template #icon>
            <component :is="icons[index]" :size="20" />
          </template>
          {{ action.text }}
        </LandingCard>
      </div>
      <LandingShowcase
        caption="Остаток прошлого периода 4 300 ₽ ждёт решения: в следующий период, в накопления или оставить."
      >
        <PeriodDecisionCard
          budget-id="demo-budget"
          :warnings="demoDashboard.warnings"
          :suggested-target="null"
          :period-id="demoDashboard.period.periodId"
          :protected-assignments="demoDashboard.protectedAssignments"
        />
      </LandingShowcase>
    </div>
  </LandingSection>
</template>

<style scoped>
.period-end__layout {
  display: grid;
  gap: var(--hf-space-8);
}

.period-end__cards {
  display: grid;
  gap: var(--hf-space-4);
  align-content: start;
}

@media (min-width: 1024px) {
  .period-end__layout {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
  }
}
</style>
