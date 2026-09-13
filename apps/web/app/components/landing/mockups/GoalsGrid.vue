<script setup lang="ts">
import LandingProgress from '../ui/LandingProgress.vue';
import { goalData } from '../../../data/landing.js';

defineOptions({ name: 'GoalsGrid' });

const tones = ['brand', 'primary', 'warning'] as const;

const toneFor = (index: number): (typeof tones)[number] => tones[index % tones.length] ?? 'brand';
</script>

<template>
  <ul class="goals-grid">
    <li v-for="(goal, index) in goalData" :key="goal.name" class="goals-grid__item">
      <LandingProgress
        :label="goal.name"
        :value-minor="goal.savedMinor"
        :target-minor="goal.targetMinor"
        :tone="toneFor(index)"
      />
    </li>
  </ul>
</template>

<style scoped>
.goals-grid {
  display: grid;
  gap: var(--hf-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.goals-grid__item {
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-xs);
}

@media (min-width: 768px) {
  .goals-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
