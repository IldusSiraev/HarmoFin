<script setup lang="ts">
import { computed, ref } from 'vue';

import UiInput from '../ui/Input.vue';

defineOptions({ name: 'SettingsCyclePreview' });

export interface TransitionDecision {
  target: string;
  noTarget: boolean;
}

const props = defineProps<{
  cycleStartDay: number;
  periodBoundaryOffset: number;
  // Future-action block (Envelope Plan v2.2): every date is the API value.
  effectiveOn?: string | undefined;
  transitionRanges?: { start: string; end: string }[] | undefined;
  decisions?: Record<string, TransitionDecision> | undefined;
  errors?: Record<string, string> | undefined;
}>();

const emit = defineEmits<{
  decision: [periodStart: string, value: TransitionDecision];
}>();

const heading = ref<HTMLElement | null>(null);

// YYYY-MM-DD -> DD.MM.YYYY by string slicing only; no Date, so no timezone drift.
function formatDate(value: string): string {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function decisionOf(start: string): TransitionDecision {
  return props.decisions?.[start] ?? { target: '', noTarget: false };
}

function onTarget(start: string, value: string) {
  emit('decision', start, { target: value, noTarget: false });
}

function onNoTarget(start: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  emit('decision', start, { target: '', noTarget: checked });
}

defineExpose({ focusHeading: () => heading.value?.focus() });

const secondPeriodStart = computed(() => props.cycleStartDay + props.periodBoundaryOffset);

// Purely illustrative proportions against a 28-day reference month — not used
// for any date math, so a boundary past day 28 just clamps the bar's width,
// it never distorts the printed day numbers.
const firstSegmentPercent = computed(() =>
  Math.min(Math.max((props.periodBoundaryOffset / 28) * 100, 8), 92),
);
const secondSegmentPercent = computed(() => 100 - firstSegmentPercent.value);

const firstLabel = computed(() => `${props.cycleStartDay}–${secondPeriodStart.value}`);
const secondLabel = computed(() => `${secondPeriodStart.value}–${props.cycleStartDay}`);
const summaryLabel = computed(
  () => `Пример разбивки: первый период ${firstLabel.value}, второй период ${secondLabel.value}.`,
);
</script>

<template>
  <div class="cycle-preview">
    <p class="cycle-preview__caption">Пример разбивки</p>
    <div class="cycle-preview__track" role="img" :aria-label="summaryLabel">
      <div
        class="cycle-preview__segment cycle-preview__segment--first"
        :style="{ width: `${firstSegmentPercent}%` }"
      >
        {{ firstLabel }}
      </div>
      <div
        class="cycle-preview__segment cycle-preview__segment--second"
        :style="{ width: `${secondSegmentPercent}%` }"
      >
        {{ secondLabel }}
      </div>
    </div>
    <div class="cycle-preview__labels" aria-hidden="true">
      <span>первый период</span>
      <span>второй период</span>
    </div>
    <section
      v-if="effectiveOn"
      class="cycle-preview__effect"
      aria-labelledby="cycle-effect-title"
      data-testid="cycle-effect"
    >
      <h3
        id="cycle-effect-title"
        ref="heading"
        class="cycle-preview__effect-title"
        tabindex="-1"
        data-testid="cycle-effect-heading"
      >
        Действует с {{ formatDate(effectiveOn) }}
      </h3>
      <p class="cycle-preview__effect-note">
        Изменение действует только с будущего периода. Прошлые периоды остаются без изменений.
      </p>
      <div
        v-for="range in transitionRanges ?? []"
        :key="range.start"
        class="cycle-preview__transition"
      >
        <p class="cycle-preview__transition-title">
          Переходный период {{ formatDate(range.start) }} – {{ formatDate(range.end) }}: действуют
          прежние границы.
        </p>
        <UiInput
          :model-value="decisionOf(range.start).target"
          :name="`transitionTarget-${range.start}`"
          label="Целевая сумма на переходный период, ₽"
          inputmode="decimal"
          hint="Необязательно. Например, 1500.50"
          :disabled="decisionOf(range.start).noTarget"
          :error="errors?.[range.start]"
          @update:model-value="onTarget(range.start, $event)"
        />
        <label class="cycle-preview__checkbox">
          <input
            type="checkbox"
            :name="`transitionNoTarget-${range.start}`"
            :checked="decisionOf(range.start).noTarget"
            @change="onNoTarget(range.start, $event)"
          />
          <span>Без фиксированной цели</span>
        </label>
      </div>
    </section>
  </div>
</template>

<style scoped>
.cycle-preview {
  display: grid;
  gap: var(--hf-space-2);
}

.cycle-preview__caption {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.cycle-preview__track {
  display: flex;
  overflow: hidden;
  border-radius: var(--hf-radius-md);
}

.cycle-preview__segment {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 2.5rem;
  padding: 0 var(--hf-space-2);
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
  white-space: nowrap;
}

.cycle-preview__segment--first {
  background: var(--hf-color-brand-soft);
  box-shadow: inset 0 -3px 0 var(--hf-color-brand);
}

.cycle-preview__segment--second {
  background: var(--hf-color-surface-subtle);
  box-shadow: inset 0 -3px 0 var(--hf-color-brand-bright);
}

.cycle-preview__labels {
  display: flex;
  justify-content: space-between;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}

.cycle-preview__effect {
  display: grid;
  gap: var(--hf-space-3);
  margin-top: var(--hf-space-3);
  padding: var(--hf-card-padding);
  border: 1px dashed var(--hf-color-border);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface-subtle);
}

.cycle-preview__effect-title {
  margin: 0;
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-body);
}

.cycle-preview__effect-note,
.cycle-preview__transition-title {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.cycle-preview__transition {
  display: grid;
  gap: var(--hf-space-3);
}

.cycle-preview__checkbox {
  display: flex;
  align-items: center;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  color: var(--hf-color-text);
}

.cycle-preview__checkbox input {
  width: 1.25rem;
  height: 1.25rem;
}
</style>
