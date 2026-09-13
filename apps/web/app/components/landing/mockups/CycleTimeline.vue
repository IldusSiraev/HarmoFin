<script setup lang="ts">
import { cycleMilestones } from '../../../data/landing.js';

defineOptions({ name: 'CycleTimeline' });

const periods = [
  { label: 'Период 1', range: '10–24' },
  { label: 'Период 25–9', range: '25–9' },
];
</script>

<template>
  <div class="cycle-timeline">
    <ol class="cycle-timeline__list">
      <li
        v-for="milestone in cycleMilestones"
        :key="milestone.dateLabel"
        class="cycle-timeline__item"
      >
        <span class="cycle-timeline__dot" aria-hidden="true" />
        <span class="cycle-timeline__date">{{ milestone.dateLabel }}</span>
        <span class="cycle-timeline__caption">{{ milestone.caption }}</span>
      </li>
    </ol>

    <ul class="cycle-timeline__periods">
      <li v-for="period in periods" :key="period.label" class="cycle-timeline__period">
        <strong>{{ period.label }}</strong>
        <span>{{ period.range }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.cycle-timeline {
  display: grid;
  gap: var(--hf-space-8);
}

.cycle-timeline__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--hf-space-4);
}

.cycle-timeline__item {
  position: relative;
  display: grid;
  gap: var(--hf-space-1);
  padding-left: var(--hf-space-6);
  border-left: 2px solid var(--hf-color-border);
}

.cycle-timeline__dot {
  position: absolute;
  top: 0.25rem;
  left: -0.375rem;
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;
  background: var(--hf-color-brand-bright);
}

.cycle-timeline__date {
  font-weight: var(--hf-font-weight-semibold);
  color: var(--hf-color-text);
}

.cycle-timeline__caption {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}

.cycle-timeline__periods {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
}

.cycle-timeline__period {
  display: flex;
  flex-direction: column;
  gap: var(--hf-space-1);
  padding: var(--hf-space-3) var(--hf-space-4);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-brand-soft);
  font-size: var(--hf-font-size-small);
}

@media (min-width: 768px) {
  .cycle-timeline__list {
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
  }

  .cycle-timeline__item {
    padding-left: 0;
    padding-top: var(--hf-space-6);
    border-left: none;
    border-top: 2px solid var(--hf-color-border);
  }

  .cycle-timeline__dot {
    top: -0.375rem;
    left: 0.25rem;
  }
}
</style>
