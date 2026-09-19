<script setup lang="ts">
import { computed } from 'vue';

import type { DashboardSummaryDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'FinancialMonthTimeline' });

const props = defineProps<{
  cycle: DashboardSummaryDto['cycle'];
  period: DashboardSummaryDto['period'];
}>();

const dayFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const shortDayFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

function toDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

function formatDate(iso: string): string {
  return dayFormatter.format(toDate(iso));
}

function formatDateShort(iso: string): string {
  return shortDayFormatter.format(toDate(iso));
}

function dayOffset(from: Date, to: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / msPerDay);
}

const totalSpan = computed(() => {
  const span = dayOffset(toDate(props.cycle.start), toDate(props.cycle.end));
  return span > 0 ? span : 1;
});

// The boundary is the day the current period hands off to the other one: the
// day after the FIRST period's last day, or the SECOND period's first day.
const boundaryOffset = computed(() => {
  const start = toDate(props.cycle.start);
  return props.period.id === 'FIRST'
    ? dayOffset(start, toDate(props.period.end)) + 1
    : dayOffset(start, toDate(props.period.start));
});

const todayOffset = computed(() => {
  const raw = dayOffset(toDate(props.cycle.start), new Date());
  return Math.min(Math.max(raw, 0), totalSpan.value);
});

function toPercent(offset: number): number {
  return (offset / totalSpan.value) * 100;
}

const todayPercent = computed(() => toPercent(todayOffset.value));
const boundaryPercent = computed(() => toPercent(boundaryOffset.value));

// Keep marker labels off the track's edges so they don't clip outside the card
// or collide with the start/end labels below the track.
function clampLabelPercent(percent: number): number {
  return Math.min(Math.max(percent, 6), 94);
}

const todayLabelPercent = computed(() => clampLabelPercent(todayPercent.value));
const boundaryLabelPercent = computed(() => clampLabelPercent(boundaryPercent.value));

const startLabel = computed(() => formatDate(props.cycle.start));
const endLabel = computed(() => formatDate(props.cycle.end));

// Read straight off the clock instead of re-deriving from todayOffset: offset is
// a rounded day count, so late-in-the-day it can round up to tomorrow's date.
const todayDateLabel = computed(() => shortDayFormatter.format(new Date()));
const boundaryDateLabel = computed(() => formatDateShort(toIso(boundaryOffset.value)));

function toIso(offset: number): string {
  const date = toDate(props.cycle.start);
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const summaryLabel = computed(
  () =>
    `Финансовый месяц: с ${startLabel.value} по ${endLabel.value}. ` +
    `Сегодня — день ${todayOffset.value + 1} из ${totalSpan.value + 1}.`,
);
</script>

<template>
  <div class="fm-timeline">
    <p class="fm-timeline__title">Ваш финансовый месяц</p>
    <div class="fm-timeline__marks" aria-hidden="true">
      <span class="fm-timeline__mark fm-timeline__mark--start">{{ startLabel }}</span>
      <span class="fm-timeline__mark fm-timeline__mark--boundary" :style="{ left: `${boundaryLabelPercent}%` }">
        {{ boundaryDateLabel }}
      </span>
      <span class="fm-timeline__mark fm-timeline__mark--today" :style="{ left: `${todayLabelPercent}%` }">
        {{ todayDateLabel }}
      </span>
      <span class="fm-timeline__mark fm-timeline__mark--end">{{ endLabel }}</span>
    </div>
    <div class="fm-timeline__track" role="img" :aria-label="summaryLabel">
      <div class="fm-timeline__fill" :style="{ width: `${todayPercent}%` }" />
      <div class="fm-timeline__boundary" :style="{ left: `${boundaryPercent}%` }" />
      <div class="fm-timeline__today" :style="{ left: `${todayPercent}%` }" />
    </div>
  </div>
</template>

<style scoped>
.fm-timeline {
  display: grid;
  gap: var(--hf-space-2);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

.fm-timeline__title {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
}

.fm-timeline__track {
  position: relative;
  height: 0.5rem;
  border-radius: var(--hf-radius-xl);
  background: var(--hf-color-slate-200);
}

.fm-timeline__fill {
  height: 100%;
  border-radius: var(--hf-radius-xl);
  background: var(--hf-color-brand);
}

.fm-timeline__boundary {
  position: absolute;
  top: -0.1875rem;
  width: 2px;
  height: 0.875rem;
  background: var(--hf-color-text);
  opacity: 0.35;
  transform: translateX(-50%);
}

.fm-timeline__today {
  position: absolute;
  top: 50%;
  width: 0.75rem;
  height: 0.75rem;
  border: 2px solid var(--hf-color-white);
  border-radius: 50%;
  background: var(--hf-color-brand-active);
  box-shadow: var(--hf-shadow-sm);
  transform: translate(-50%, -50%);
}

.fm-timeline__marks {
  position: relative;
  height: 1rem;
}

.fm-timeline__mark {
  position: absolute;
  top: 0;
  white-space: nowrap;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  transform: translateX(-50%);
}

.fm-timeline__mark--start {
  left: 0;
  transform: none;
}

.fm-timeline__mark--end {
  left: 100%;
  transform: translateX(-100%);
}

.fm-timeline__mark--today {
  color: var(--hf-color-brand-active);
  font-weight: var(--hf-font-weight-medium);
}
</style>
