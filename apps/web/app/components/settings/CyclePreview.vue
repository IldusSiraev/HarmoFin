<script setup lang="ts">
import { computed } from 'vue';

defineOptions({ name: 'SettingsCyclePreview' });

const props = defineProps<{
  cycleStartDay: number;
  periodBoundaryOffset: number;
}>();

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
  color: var(--hf-color-white);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
  white-space: nowrap;
}

.cycle-preview__segment--first {
  background: var(--hf-color-brand);
}

.cycle-preview__segment--second {
  background: var(--hf-color-brand-bright);
}

.cycle-preview__labels {
  display: flex;
  justify-content: space-between;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}
</style>
