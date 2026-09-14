<script setup lang="ts">
import { computed } from 'vue';

defineOptions({ name: 'UiProgress' });

const props = defineProps<{ value: string; max: string; label: string }>();

// A share of two server-computed sums, not a money value of its own: the
// component never shows a derived amount.
const percent = computed(() => {
  let value = 0n;
  let max = 0n;
  try {
    value = BigInt(props.value);
    max = BigInt(props.max);
  } catch {
    return 0;
  }
  if (max <= 0n || value <= 0n) return 0;
  if (value >= max) return 100;
  return Number((value * 100n) / max);
});
</script>

<template>
  <div
    class="ui-progress"
    role="progressbar"
    :aria-label="label"
    :aria-valuetext="label"
    :aria-valuenow="percent"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <div class="ui-progress__fill" :style="{ width: `${percent}%` }" />
  </div>
</template>

<style scoped>
.ui-progress {
  overflow: hidden;
  width: 100%;
  height: 0.5rem;
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-surface-subtle);
}

.ui-progress__fill {
  height: 100%;
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-brand);
}
</style>
