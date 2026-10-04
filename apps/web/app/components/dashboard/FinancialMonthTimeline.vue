<script setup lang="ts">
import { computed } from 'vue';

defineOptions({ name: 'FinancialMonthTimeline' });

// Dates only: the server decides the cycle, the current period and "today" (asOf).
const props = defineProps<{
  cycle: { start: string; end: string };
  period: { start: string; end: string };
  asOf: string;
}>();

const dayFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const shortDayFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function dayOffset(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS);
}

function addDays(iso: string, amount: number): string {
  return new Date(toDate(iso).getTime() + amount * DAY_MS).toISOString().slice(0, 10);
}

const totalSpan = computed(() => Math.max(dayOffset(props.cycle.start, props.cycle.end), 1));

// The boundary is the day the periods hand off: the day after the first period's last day,
// or the second period's first day.
const boundaryDate = computed(() =>
  props.period.start === props.cycle.start ? addDays(props.period.end, 1) : props.period.start,
);
const boundaryOffset = computed(() => dayOffset(props.cycle.start, boundaryDate.value));
const boundaryVisible = computed(
  () => boundaryOffset.value > 0 && boundaryOffset.value < totalSpan.value,
);

const todayOffset = computed(() =>
  Math.min(Math.max(dayOffset(props.cycle.start, props.asOf), 0), totalSpan.value),
);

const toPercent = (offset: number) => (offset / totalSpan.value) * 100;
const todayPercent = computed(() => toPercent(todayOffset.value));
const boundaryPercent = computed(() => toPercent(boundaryOffset.value));

// The "today" label sits above the track alone; start, end and boundary labels share the row
// below it. The boundary label is kept clear of the start and end labels, so no two labels collide
// at narrow widths (the tick on the track still marks the exact day).
const clamp = (percent: number, min: number, max: number) => Math.min(Math.max(percent, min), max);
const todayLabelPercent = computed(() => clamp(todayPercent.value, 8, 92));
const boundaryLabelPercent = computed(() => clamp(boundaryPercent.value, 34, 66));
const asOfInCycle = computed(
  () => props.asOf >= props.cycle.start && props.asOf <= props.cycle.end,
);

const startLabel = computed(() => dayFormatter.format(toDate(props.cycle.start)));
const endLabel = computed(() => dayFormatter.format(toDate(props.cycle.end)));
const todayDateLabel = computed(() => shortDayFormatter.format(toDate(props.asOf)));
const boundaryDateLabel = computed(() => shortDayFormatter.format(toDate(boundaryDate.value)));

const summaryLabel = computed(() => {
  const parts = [`Финансовый месяц: с ${startLabel.value} по ${endLabel.value}.`];
  if (asOfInCycle.value) {
    parts.push(`Сегодня — день ${todayOffset.value + 1} из ${totalSpan.value + 1}.`);
  }
  if (boundaryVisible.value)
    parts.push(`Смена периода: ${boundaryDateLabel.value.replace(/\.$/, '')}.`);
  return parts.join(' ');
});
</script>

<template>
  <div class="fm-timeline">
    <p class="fm-timeline__title">Ваш финансовый месяц</p>
    <div class="fm-timeline__marks" aria-hidden="true">
      <span
        v-if="asOfInCycle"
        class="fm-timeline__mark fm-timeline__mark--today"
        :style="{ left: `${todayLabelPercent}%` }"
      >
        {{ todayDateLabel }}
      </span>
    </div>
    <div class="fm-timeline__track" role="img" :aria-label="summaryLabel">
      <div class="fm-timeline__fill" :style="{ width: `${todayPercent}%` }" />
      <div
        v-if="boundaryVisible"
        class="fm-timeline__boundary"
        :style="{ left: `${boundaryPercent}%` }"
      />
      <div v-if="asOfInCycle" class="fm-timeline__today" :style="{ left: `${todayPercent}%` }" />
    </div>
    <div class="fm-timeline__marks" aria-hidden="true">
      <span class="fm-timeline__mark fm-timeline__mark--start">{{ startLabel }}</span>
      <span
        v-if="boundaryVisible"
        class="fm-timeline__mark fm-timeline__mark--boundary"
        :style="{ left: `${boundaryLabelPercent}%` }"
      >
        {{ boundaryDateLabel }}
      </span>
      <span class="fm-timeline__mark fm-timeline__mark--end">{{ endLabel }}</span>
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
  opacity: 0.6;
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
