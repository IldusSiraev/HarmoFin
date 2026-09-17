<script setup lang="ts">
import { computed } from 'vue';

import type { DashboardSummaryDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'FinancialMonthTimeline' });

const props = defineProps<{
  cycle: DashboardSummaryDto['cycle'];
  period: DashboardSummaryDto['period'];
}>();

const dayFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

function toDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

function formatDate(iso: string): string {
  return dayFormatter.format(toDate(iso));
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

const startLabel = computed(() => formatDate(props.cycle.start));
const endLabel = computed(() => formatDate(props.cycle.end));

const summaryLabel = computed(
  () =>
    `Финансовый месяц: с ${startLabel.value} по ${endLabel.value}. ` +
    `Сегодня — день ${todayOffset.value + 1} из ${totalSpan.value + 1}.`,
);
</script>

<template>
  <div class="fm-timeline">
    <p class="fm-timeline__title">Ваш финансовый месяц</p>
    <div class="fm-timeline__track" role="img" :aria-label="summaryLabel">
      <div class="fm-timeline__fill" :style="{ width: `${todayPercent}%` }" />
      <div class="fm-timeline__boundary" :style="{ left: `${boundaryPercent}%` }" />
      <div class="fm-timeline__today" :style="{ left: `${todayPercent}%` }" />
    </div>
    <div class="fm-timeline__labels">
      <span>{{ startLabel }}</span>
      <span>{{ endLabel }}</span>
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

.fm-timeline__labels {
  display: flex;
  justify-content: space-between;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}
</style>
