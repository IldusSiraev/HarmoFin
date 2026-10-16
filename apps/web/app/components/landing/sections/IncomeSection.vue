<script setup lang="ts">
import { Banknote, ListChecks, MousePointerClick, ArrowLeftRight } from '@lucide/vue';

import IncomePreview from '../ui/IncomePreview.vue';
import LandingCard from '../ui/LandingCard.vue';
import LandingSection from '../ui/LandingSection.vue';
import LandingShowcase from '../ui/LandingShowcase.vue';
import { incomeSteps } from '../../../data/landing.js';

defineOptions({ name: 'IncomeSection' });

const icons = [Banknote, ListChecks, MousePointerClick, ArrowLeftRight];
</script>

<template>
  <LandingSection
    section-id="how-it-works"
    tone="muted"
    eyebrow="Как это работает"
    title="Пришла зарплата — разложите её по конвертам за одно действие"
    description="HarmoFin предлагает суммы по вашим правилам. Вы проверяете и подтверждаете."
  >
    <div class="income__layout">
      <div class="income__cards">
        <LandingCard v-for="(step, index) in incomeSteps" :key="step.title" :title="step.title">
          <template #icon>
            <component :is="icons[index]" :size="20" />
          </template>
          {{ step.text }}
        </LandingCard>
      </div>
      <LandingShowcase
        caption="Предложение после зарплаты 106 000 ₽: 65 000 ₽ на текущие траты, 30 000 ₽ на обязательные платежи, 11 000 ₽ на ремонт."
      >
        <IncomePreview />
      </LandingShowcase>
    </div>
  </LandingSection>
</template>

<style scoped>
.income__layout {
  display: grid;
  gap: var(--hf-space-8);
}

.income__cards {
  display: grid;
  gap: var(--hf-space-4);
  align-content: start;
}

@media (min-width: 1024px) {
  .income__layout {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
  }
}
</style>
