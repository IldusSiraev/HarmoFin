<script setup lang="ts">
import { ShieldCheck, Lock, RotateCcwClock } from '@lucide/vue';

import LandingCard from '../ui/LandingCard.vue';
import LandingSection from '../ui/LandingSection.vue';
import { securityCards } from '../../../data/landing.js';

defineOptions({ name: 'SecuritySection' });

const icons = [ShieldCheck, Lock, RotateCcwClock];
</script>

<template>
  <LandingSection
    section-id="security"
    eyebrow="Безопасность"
    title="Ваши финансовые данные — только ваши."
  >
    <div class="security__grid">
      <LandingCard v-for="(card, index) in securityCards" :key="card.title" :title="card.title">
        <template #icon>
          <component :is="icons[index]" :size="20" />
        </template>
        {{ card.text }}
      </LandingCard>
    </div>
  </LandingSection>
</template>

<style scoped>
.security__grid {
  display: grid;
  gap: var(--hf-space-4);
}

@media (min-width: 768px) {
  .security__grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
