<script setup lang="ts">
import { computed } from 'vue';

import { formatMinorUnits } from '../../finance/money-format.js';
import { ratioPercent } from './chart-scale.js';

defineOptions({ name: 'AnalyticsLineChart' });

export type LineSeries = { id: string; label: string; tone: 'income' | 'expense' };
export type LinePoint = {
  id: string;
  label: string;
  values: ReadonlyArray<{ seriesId: string; amountMinor: string }>;
  caption?: string | undefined;
  /** Journal link for this point's period/cycle, same filters as the server row. */
  href?: string | undefined;
};

const props = defineProps<{
  points: ReadonlyArray<LinePoint>;
  series: ReadonlyArray<LineSeries>;
  label: string;
}>();

// Geometry only: positions are shares of server sums, amounts are shown as server strings.
const WIDTH = 640;
const HEIGHT = 280;
const PAD_LEFT = 84;
const PAD_RIGHT = 20;
const INSET = 56;
const PAD_TOP = 30;
const PAD_BOTTOM = 60;
const MAX_LABELLED = 7;
const plotBottom = HEIGHT - PAD_BOTTOM;

const max = computed(() => {
  let value = 0n;
  for (const point of props.points) {
    for (const item of point.values) {
      const amount = BigInt(item.amountMinor);
      if (amount > value) value = amount;
    }
  }
  return value.toString();
});

const money = (minor: string) => formatMinorUnits(minor, 'RUB', 2);
const toneOf = (seriesId: string) =>
  props.series.find((item) => item.id === seriesId)?.tone ?? 'expense';
const labelOf = (seriesId: string) =>
  props.series.find((item) => item.id === seriesId)?.label ?? '';

function xAt(index: number) {
  if (props.points.length <= 1) return (PAD_LEFT + WIDTH - PAD_RIGHT) / 2;
  return (
    PAD_LEFT +
    INSET +
    (index * (WIDTH - PAD_LEFT - PAD_RIGHT - INSET * 2)) / (props.points.length - 1)
  );
}
function yFor(amountMinor: string) {
  return plotBottom - (ratioPercent(amountMinor, max.value) / 100) * (plotBottom - PAD_TOP);
}

// Labels on points and axis only while they fit; the list below always carries every value.
const labelled = computed(() => props.points.length <= MAX_LABELLED);
const xStep = computed(() => Math.ceil(props.points.length / MAX_LABELLED));

const lines = computed(() =>
  props.series.map((item) => {
    const dots = props.points.map((point, index) => {
      const amount = BigInt(
        point.values.find((entry) => entry.seriesId === item.id)?.amountMinor ?? '0',
      );
      // With several series the higher value is labelled above its dot, the others below,
      // so close values do not overprint each other.
      const ownIndex = point.values.findIndex((entry) => entry.seriesId === item.id);
      const below = point.values.some(
        (entry, entryIndex) =>
          BigInt(entry.amountMinor) > amount ||
          (BigInt(entry.amountMinor) === amount && entryIndex < ownIndex),
      );
      const y = yFor(amount.toString());
      return {
        id: point.id,
        x: xAt(index),
        y,
        text: money(amount.toString()),
        textY: below ? y + 17 : y - 10,
      };
    });
    const path = dots.map((dot, index) => `${index === 0 ? 'M' : 'L'}${dot.x} ${dot.y}`).join(' ');
    const first = dots[0];
    const last = dots[dots.length - 1];
    const area =
      first && last && dots.length > 1
        ? `${path} L${last.x} ${plotBottom} L${first.x} ${plotBottom} Z`
        : '';
    return { id: item.id, tone: item.tone, dots, path, area };
  }),
);

const ticks = computed(() => [
  { y: PAD_TOP, text: money(max.value) },
  { y: (PAD_TOP + plotBottom) / 2, text: money((BigInt(max.value) / 2n).toString()) },
  { y: plotBottom, text: money('0') },
]);
const xLabels = computed(() =>
  props.points
    .map((point, index) => ({ id: point.id, text: point.label, x: xAt(index), index }))
    .filter((item) => item.index % xStep.value === 0),
);
</script>

<template>
  <figure class="line-chart">
    <figcaption class="line-chart__legend">
      <span class="line-chart__title">{{ label }}</span>
      <span v-for="item in series" :key="item.id" class="line-chart__legend-item">
        <span :class="`line-chart__swatch line-chart__tone--${item.tone}`" aria-hidden="true" />
        {{ item.label }}
      </span>
    </figcaption>
    <div class="line-chart__scroll">
      <svg
        class="line-chart__plot"
        :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
        aria-hidden="true"
        focusable="false"
      >
        <g v-for="tick in ticks" :key="tick.y">
          <line
            class="line-chart__grid"
            :x1="PAD_LEFT"
            :x2="WIDTH - PAD_RIGHT"
            :y1="tick.y"
            :y2="tick.y"
          />
          <text
            data-axis-y
            class="line-chart__axis-text"
            :x="PAD_LEFT - 10"
            :y="tick.y + 4"
            text-anchor="end"
          >
            {{ tick.text }}
          </text>
        </g>
        <text
          v-for="item in xLabels"
          :key="item.id"
          data-axis-x
          class="line-chart__axis-text"
          :x="item.x"
          :y="HEIGHT - 10"
          text-anchor="middle"
        >
          {{ item.text }}
        </text>
        <g v-for="line in lines" :key="line.id" :class="`line-chart__tone--${line.tone}`">
          <path v-if="line.area" class="line-chart__area" :d="line.area" />
          <path v-if="line.dots.length > 1" class="line-chart__line" :d="line.path" />
          <circle
            v-for="dot in line.dots"
            :key="dot.id"
            data-dot
            class="line-chart__dot"
            :cx="dot.x"
            :cy="dot.y"
            r="4.5"
          />
          <template v-if="labelled">
            <text
              v-for="dot in line.dots"
              :key="`${dot.id}:label`"
              data-dot-label
              class="line-chart__dot-label"
              :x="dot.x"
              :y="dot.textY"
              text-anchor="middle"
            >
              {{ dot.text }}
            </text>
          </template>
        </g>
      </svg>
    </div>
    <ol class="line-chart__points">
      <li v-for="point in points" :key="point.id" class="line-chart__point">
        <NuxtLink
          v-if="point.href"
          :to="point.href"
          class="line-chart__label line-chart__label--link"
          :aria-label="`Операции за ${point.label}`"
          >{{ point.label }}</NuxtLink
        >
        <span v-else class="line-chart__label">{{ point.label }}</span>
        <span v-for="item in point.values" :key="item.seriesId" class="line-chart__value">
          <span
            :class="`line-chart__value-swatch line-chart__tone--${toneOf(item.seriesId)}`"
            aria-hidden="true"
          />
          <span class="line-chart__value-label">{{ labelOf(item.seriesId) }}</span>
          {{ money(item.amountMinor) }}
        </span>
        <span v-if="point.caption" class="line-chart__caption">{{ point.caption }}</span>
      </li>
    </ol>
  </figure>
</template>

<style scoped>
.line-chart {
  display: grid;
  gap: var(--hf-space-4);
  margin: 0;
}
.line-chart__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hf-space-4);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
.line-chart__title {
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-semibold);
}
.line-chart__legend-item {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-2);
}
.line-chart__swatch {
  width: 1rem;
  height: 0.25rem;
  border-radius: 2px;
}
.line-chart__scroll {
  overflow-x: auto;
}
.line-chart__plot {
  width: 100%;
  min-width: 30rem;
  height: auto;
}
.line-chart__axis-text {
  fill: var(--hf-color-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.line-chart__dot-label {
  fill: var(--hf-color-text);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.line-chart__grid {
  stroke: var(--hf-color-border);
  stroke-width: 1;
}
.line-chart__line {
  fill: none;
  stroke: currentcolor;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.line-chart__area {
  fill: currentcolor;
  opacity: 0.08;
}
.line-chart__dot {
  fill: currentcolor;
  stroke: var(--hf-color-surface);
  stroke-width: 2;
}
.line-chart__tone--income {
  color: var(--hf-color-status-success);
  background: var(--hf-color-status-success);
}
.line-chart__tone--expense {
  color: var(--hf-color-danger-strong);
  background: var(--hf-color-danger-strong);
}
g.line-chart__tone--income,
g.line-chart__tone--expense {
  background: none;
}
.line-chart__points {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(5.5rem, 1fr);
  gap: var(--hf-space-3);
  margin: 0;
  padding: 0 0 var(--hf-space-2);
  overflow-x: auto;
  list-style: none;
}
.line-chart__point {
  display: grid;
  gap: var(--hf-space-1);
  font-size: var(--hf-font-size-caption);
  font-variant-numeric: tabular-nums;
}
.line-chart__label {
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
}
.line-chart__label--link {
  display: inline-flex;
  align-items: center;
  min-height: var(--hf-control-height-sm);
  color: var(--hf-color-action-primary-text);
  text-decoration: none;
}
.line-chart__label--link:hover {
  text-decoration: underline;
}
.line-chart__label--link:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}
.line-chart__value {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  color: var(--hf-color-text-muted);
}
.line-chart__value-swatch {
  width: 0.5rem;
  height: 0.5rem;
  flex-shrink: 0;
  border-radius: 50%;
}
.line-chart__value-label {
  color: var(--hf-color-text);
}
.line-chart__caption {
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-semibold);
}
</style>
