<script setup lang="ts">
import { computed } from 'vue';

import { formatMinorUnits } from '../../finance/money-format.js';
import { ratioPercent } from './chart-scale.js';

defineOptions({ name: 'AnalyticsColumnChart' });

export type ColumnSeries = { id: string; label: string; tone: 1 | 2 | 3 };
export type Column = {
  id: string;
  label: string;
  values: ReadonlyArray<{ seriesId: string; amountMinor: string }>;
  caption?: string | undefined;
  /** Journal link for this column's period/cycle, same filters as the server row. */
  href?: string | undefined;
};

const props = defineProps<{
  columns: ReadonlyArray<Column>;
  series: ReadonlyArray<ColumnSeries>;
  label: string;
}>();

const max = computed(() => {
  let value = 0n;
  for (const column of props.columns) {
    for (const item of column.values) {
      const amount = BigInt(item.amountMinor);
      if (amount > value) value = amount;
    }
  }
  return value.toString();
});

const toneOf = (seriesId: string) => props.series.find((item) => item.id === seriesId)?.tone ?? 1;
const labelOf = (seriesId: string) =>
  props.series.find((item) => item.id === seriesId)?.label ?? '';
const money = (minor: string) => formatMinorUnits(minor, 'RUB', 2);
</script>

<template>
  <figure class="column-chart">
    <figcaption class="column-chart__legend">
      <span class="column-chart__title">{{ label }}</span>
      <span v-for="item in series" :key="item.id" class="column-chart__legend-item">
        <span :class="`column-chart__swatch column-chart__tone--${item.tone}`" aria-hidden="true" />
        {{ item.label }}
      </span>
    </figcaption>
    <ol class="column-chart__columns">
      <li v-for="column in columns" :key="column.id" class="column-chart__column">
        <svg
          class="column-chart__plot"
          :viewBox="`0 0 ${column.values.length * 10} 100`"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <rect
            v-for="(item, index) in column.values"
            :key="item.seriesId"
            data-bar
            :data-percent="String(ratioPercent(item.amountMinor, max))"
            :class="`column-chart__tone--${toneOf(item.seriesId)}`"
            :x="index * 10 + 1"
            :y="100 - ratioPercent(item.amountMinor, max)"
            width="8"
            :height="ratioPercent(item.amountMinor, max)"
          />
        </svg>
        <NuxtLink
          v-if="column.href"
          :to="column.href"
          class="column-chart__label column-chart__label--link"
          :aria-label="`Операции за ${column.label}`"
          >{{ column.label }}</NuxtLink
        >
        <span v-else class="column-chart__label">{{ column.label }}</span>
        <span v-for="item in column.values" :key="item.seriesId" class="column-chart__value">
          <span
            :class="`column-chart__value-swatch column-chart__tone--${toneOf(item.seriesId)}`"
            aria-hidden="true"
          />
          <span class="column-chart__value-label">{{ labelOf(item.seriesId) }}</span>
          {{ money(item.amountMinor) }}
        </span>
        <span v-if="column.caption" class="column-chart__caption">{{ column.caption }}</span>
      </li>
    </ol>
  </figure>
</template>

<style scoped>
.column-chart {
  display: grid;
  gap: var(--hf-space-4);
  margin: 0;
}
.column-chart__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hf-space-4);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
.column-chart__title {
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-semibold);
}
.column-chart__legend-item {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-2);
}
.column-chart__swatch {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 2px;
}
.column-chart__columns {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(5.5rem, 1fr);
  gap: var(--hf-space-3);
  margin: 0;
  padding: 0 0 var(--hf-space-2);
  overflow-x: auto;
  list-style: none;
}
.column-chart__column {
  display: grid;
  gap: var(--hf-space-1);
  font-size: var(--hf-font-size-caption);
  font-variant-numeric: tabular-nums;
}
.column-chart__plot {
  width: 100%;
  height: 10rem;
  border-bottom: 1px solid var(--hf-color-border-strong);
}
.column-chart__tone--1 {
  fill: var(--hf-color-chart-1);
  background: var(--hf-color-chart-1);
}
.column-chart__tone--2 {
  fill: var(--hf-color-chart-2);
  background: var(--hf-color-chart-2);
}
.column-chart__tone--3 {
  fill: var(--hf-color-chart-3);
  background: var(--hf-color-chart-3);
}
.column-chart__label {
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
}
.column-chart__label--link {
  display: inline-flex;
  align-items: center;
  min-height: var(--hf-control-height-sm);
  color: var(--hf-color-action-primary-text);
  text-decoration: none;
}
.column-chart__label--link:hover {
  text-decoration: underline;
}
.column-chart__label--link:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}
.column-chart__value {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  color: var(--hf-color-text-muted);
}
.column-chart__value-swatch {
  width: 0.5rem;
  height: 0.5rem;
  flex-shrink: 0;
  border-radius: 2px;
}
.column-chart__value-label {
  color: var(--hf-color-text);
}
.column-chart__caption {
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-semibold);
}
</style>
