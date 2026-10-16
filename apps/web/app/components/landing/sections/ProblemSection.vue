<script setup lang="ts">
import { Wallet, CalendarClock, PiggyBank } from '@lucide/vue';

import LandingCallout from '../ui/LandingCallout.vue';
import LandingCard from '../ui/LandingCard.vue';
import LandingSection from '../ui/LandingSection.vue';
import { problemCards } from '../../../data/landing.js';

defineOptions({ name: 'ProblemSection' });

const icons = [Wallet, CalendarClock, PiggyBank];
</script>

<template>
  <LandingSection
    section-id="problem"
    tone="muted"
    eyebrow="Знакомая проблема"
    title="Деньги вроде есть. Но сколько из них действительно можно потратить?"
    description="Обычный учёт расходов показывает прошлое. Но для управления бюджетом важно понимать, что происходит с деньгами сейчас."
  >
    <div class="problem__grid">
      <LandingCard v-for="(card, index) in problemCards" :key="card.title" :title="card.title">
        <template #icon>
          <component :is="icons[index]" :size="20" />
        </template>
        {{ card.text }}
      </LandingCard>
    </div>

    <LandingCallout
      text="HarmoFin делит деньги не только по счетам, но и по конвертам: на что они отложены."
    />
  </LandingSection>
</template>

<style scoped>
.problem__grid {
  display: grid;
  gap: var(--hf-space-4);
  margin-bottom: var(--hf-space-6);
}

@media (min-width: 768px) {
  .problem__grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
