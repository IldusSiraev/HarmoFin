<script setup lang="ts">
import { howItWorksSteps } from '../../../data/landing.js';

defineOptions({ name: 'StepStrip' });
</script>

<template>
  <ol class="step-strip">
    <li v-for="step in howItWorksSteps" :key="step.index" class="step-strip__item">
      <span class="step-strip__index">{{ step.index }}</span>
      <h3 class="step-strip__title">{{ step.title }}</h3>
      <p class="step-strip__caption">{{ step.caption }}</p>
    </li>
  </ol>
</template>

<style scoped>
.step-strip {
  display: grid;
  gap: var(--hf-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: step;
}

.step-strip__item {
  display: grid;
  gap: var(--hf-space-2);
  align-content: start;
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-xs);
}

.step-strip__index {
  color: var(--hf-color-brand);
  font-size: var(--hf-font-size-caption);
  font-weight: var(--hf-font-weight-semibold);
  letter-spacing: 0.08em;
}

.step-strip__title {
  margin: 0;
  font-size: var(--hf-font-size-body);
  line-height: var(--hf-line-height-body);
  font-weight: var(--hf-font-weight-semibold);
}

.step-strip__caption {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
  font-variant-numeric: tabular-nums;
}

@media (min-width: 768px) {
  .step-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1280px) {
  .step-strip {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}
</style>
