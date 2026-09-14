<script setup lang="ts">
defineOptions({ name: 'LandingMetric' });

withDefaults(
  defineProps<{
    label: string;
    value: string;
    caption?: string | undefined;
  }>(),
  { caption: undefined },
);
</script>

<template>
  <div class="landing-metric">
    <p class="landing-metric__label">{{ label }}</p>
    <p class="landing-metric__value">{{ value }}</p>
    <p v-if="caption" class="landing-metric__caption">{{ caption }}</p>
  </div>
</template>

<style scoped>
.landing-metric {
  display: grid;
  gap: var(--hf-space-2);
}

.landing-metric__label {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}

.landing-metric__value {
  margin: 0;
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-display);
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.landing-metric__caption {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}
</style>
