<script setup lang="ts">
import { computed } from 'vue';

defineOptions({ name: 'UiSkeleton' });

const props = withDefaults(defineProps<{ variant?: 'text' | 'card' | 'row'; count?: number }>(), {
  variant: 'text',
  count: 1,
});

const placeholders = computed(() => Array.from({ length: Math.max(1, props.count) }, (_, i) => i));
</script>

<template>
  <div class="ui-skeleton" aria-hidden="true">
    <span
      v-for="index in placeholders"
      :key="index"
      class="ui-skeleton__item"
      :class="`ui-skeleton__item--${variant}`"
      data-testid="skeleton-item"
    />
  </div>
</template>

<style scoped>
.ui-skeleton {
  display: grid;
  gap: var(--hf-space-3);
}

.ui-skeleton__item {
  display: block;
  border-radius: var(--hf-radius-md);
  background: linear-gradient(
    90deg,
    var(--hf-color-slate-200) 25%,
    var(--hf-color-page-background) 37%,
    var(--hf-color-slate-200) 63%
  );
  background-size: 400% 100%;
  animation: ui-skeleton-shimmer 1.4s ease infinite;
}

.ui-skeleton__item--text {
  height: 1rem;
}

.ui-skeleton__item--row {
  height: 3rem;
}

.ui-skeleton__item--card {
  height: 9rem;
  border-radius: var(--hf-radius-lg);
}

@keyframes ui-skeleton-shimmer {
  to {
    background-position: -400% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ui-skeleton__item {
    animation: none;
  }
}
</style>
