<script setup lang="ts">
import { computed } from 'vue';

import { formatLandingMoney } from '../format-money.js';

defineOptions({ name: 'LandingProgress' });

const props = withDefaults(
  defineProps<{
    label: string;
    valueMinor: string;
    targetMinor: string;
    tone?: 'brand' | 'primary' | 'warning';
  }>(),
  { tone: 'brand' },
);

// This value is read from the template only; no-useless-assignment's control-flow analysis
// does not see reads inside <template> expression containers, so it misreports this as dead.
// eslint-disable-next-line no-useless-assignment
const percent = computed(() => {
  const value = Number(BigInt(props.valueMinor));
  const target = Number(BigInt(props.targetMinor));
  if (target <= 0) return 0;
  return Math.min(100, Math.round((value / target) * 100));
});

const formattedValue = computed(() => formatLandingMoney(props.valueMinor));
const formattedTarget = computed(() => formatLandingMoney(props.targetMinor));
// eslint-disable-next-line no-useless-assignment -- read from the template only; see above.
const summary = computed(
  () => `${props.label}: ${formattedValue.value} из ${formattedTarget.value}`,
);
</script>

<template>
  <div class="landing-progress">
    <div class="landing-progress__head">
      <span class="landing-progress__label">{{ label }}</span>
      <span class="landing-progress__amounts">{{ formattedValue }} из {{ formattedTarget }}</span>
    </div>
    <div
      class="landing-progress__track"
      role="progressbar"
      :aria-label="summary"
      :aria-valuenow="percent"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div
        class="landing-progress__fill"
        :class="`landing-progress__fill--${tone}`"
        :style="{ width: `${percent}%` }"
      />
    </div>
  </div>
</template>

<style scoped>
.landing-progress {
  display: grid;
  gap: var(--hf-space-2);
}

.landing-progress__head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--hf-space-2);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}

.landing-progress__amounts {
  color: var(--hf-color-text-muted);
  font-variant-numeric: tabular-nums;
}

.landing-progress__track {
  height: 0.5rem;
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-slate-200);
  overflow: hidden;
}

.landing-progress__fill {
  height: 100%;
  border-radius: inherit;
  transition: width var(--hf-transition-base);
}

.landing-progress__fill--brand {
  background: var(--hf-color-brand-bright);
}

.landing-progress__fill--primary {
  background: var(--hf-color-primary-bright);
}

.landing-progress__fill--warning {
  background: var(--hf-color-status-warning-bright);
}
</style>
