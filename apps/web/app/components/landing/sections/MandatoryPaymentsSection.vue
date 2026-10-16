<script setup lang="ts">
import { CalendarClock, CreditCard, BellRing } from '@lucide/vue';

import UpcomingObligations from '../../dashboard/UpcomingObligations.vue';
import LandingCard from '../ui/LandingCard.vue';
import LandingSection from '../ui/LandingSection.vue';
import LandingShowcase from '../ui/LandingShowcase.vue';
import { demoDashboard } from '../../../data/landing-demo.js';
import { mandatoryPoints } from '../../../data/landing.js';

defineOptions({ name: 'MandatoryPaymentsSection' });

const icons = [CalendarClock, CreditCard, BellRing];
</script>

<template>
  <LandingSection
    section-id="mandatory"
    eyebrow="Обязательные платежи"
    title="Деньги на ипотеку и садик не потратятся случайно"
    description="Отложенное на обязательные платежи не входит в сумму «Можно потратить»."
  >
    <div class="mandatory__layout">
      <div class="mandatory__cards">
        <LandingCard
          v-for="(point, index) in mandatoryPoints"
          :key="point.title"
          :title="point.title"
        >
          <template #icon>
            <component :is="icons[index]" :size="20" />
          </template>
          {{ point.text }}
        </LandingCard>
      </div>
      <LandingShowcase
        caption="Ближайшие платежи: ипотека 36 000 ₽ 5 октября, интернет 900 ₽ 7 октября, детский сад 11 100 ₽ 8 октября."
      >
        <UpcomingObligations :items="demoDashboard.nearestObligations" />
      </LandingShowcase>
    </div>
  </LandingSection>
</template>

<style scoped>
.mandatory__layout {
  display: grid;
  gap: var(--hf-space-8);
}

.mandatory__cards {
  display: grid;
  gap: var(--hf-space-4);
  align-content: start;
}

@media (min-width: 1024px) {
  .mandatory__layout {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
  }
}
</style>
