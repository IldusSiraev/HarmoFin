<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next';

defineOptions({ name: 'LandingCallout' });

defineProps<{ text: string }>();
</script>

<template>
  <div class="landing-callout">
    <ArrowRight class="landing-callout__icon" aria-hidden="true" />
    <p class="landing-callout__text">{{ text }}</p>
  </div>
</template>

<style scoped>
.landing-callout {
  display: flex;
  align-items: center;
  gap: var(--hf-space-3);
  padding: var(--hf-space-5);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-brand-soft);
  color: var(--hf-color-text);
}

.landing-callout__icon {
  flex-shrink: 0;
  width: 1.25rem;
  height: 1.25rem;
  color: var(--hf-color-brand);
}

.landing-callout__text {
  margin: 0;
  font-size: var(--hf-font-size-body);
  line-height: var(--hf-line-height-body);
}
</style>
