<script setup lang="ts">
import { computed } from 'vue';

import { analyticsData } from '../../../data/landing.js';

defineOptions({ name: 'DonutChart' });

const RADIUS = 60;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const TONES = [
  'var(--hf-color-brand-bright)',
  'var(--hf-color-primary-bright)',
  'var(--hf-color-status-warning-bright)',
  'var(--hf-color-brand)',
  'var(--hf-color-action-primary)',
  'var(--hf-color-text-muted)',
];

const arcs = computed(() => {
  let cumulative = 0;

  return analyticsData.categories.map((category, index) => {
    const length = ((category.share / 100) * CIRCUMFERENCE).toFixed(2);
    const offset = cumulative === 0 ? '0' : `-${((cumulative / 100) * CIRCUMFERENCE).toFixed(2)}`;
    cumulative += category.share;

    return {
      name: category.name,
      share: category.share,
      color: TONES[index % TONES.length] ?? TONES[0],
      dasharray: `${length} ${CIRCUMFERENCE.toFixed(2)}`,
      dashoffset: offset,
    };
  });
});

const summary = computed(
  () =>
    `Расходы по категориям: ${analyticsData.categories
      .map((category) => `${category.name} ${category.share} %`)
      .join(', ')}`,
);
</script>

<template>
  <figure class="donut-chart">
    <svg class="donut-chart__svg" viewBox="0 0 160 160" role="img" :aria-label="summary">
      <g transform="rotate(-90 80 80)">
        <circle
          v-for="arc in arcs"
          :key="arc.name"
          data-testid="donut-arc"
          cx="80"
          cy="80"
          :r="RADIUS"
          fill="none"
          stroke-width="20"
          :stroke="arc.color"
          :stroke-dasharray="arc.dasharray"
          :stroke-dashoffset="arc.dashoffset"
        />
      </g>
    </svg>

    <figcaption class="donut-chart__legend">
      <ul class="donut-chart__list">
        <li
          v-for="arc in arcs"
          :key="arc.name"
          class="donut-chart__item"
          data-testid="donut-legend-item"
        >
          <span class="donut-chart__swatch" :style="{ background: arc.color }" aria-hidden="true" />
          <span class="donut-chart__name">{{ arc.name }}</span>
          <span class="donut-chart__share">{{ arc.share }} %</span>
        </li>
      </ul>
    </figcaption>
  </figure>
</template>

<style scoped>
.donut-chart {
  display: grid;
  grid-template-columns: 1fr;
  align-items: center;
  gap: var(--hf-space-6);
  margin: 0;
}

.donut-chart__svg {
  width: 10rem;
  height: 10rem;
}

.donut-chart__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--hf-space-2);
}

.donut-chart__item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--hf-space-2);
}

.donut-chart__swatch {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 2px;
}

.donut-chart__share {
  font-variant-numeric: tabular-nums;
  color: var(--hf-color-text-muted);
}

@media (min-width: 768px) {
  .donut-chart {
    grid-template-columns: auto minmax(0, 1fr);
  }
}
</style>
