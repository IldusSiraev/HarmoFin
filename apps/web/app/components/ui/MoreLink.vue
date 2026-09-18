<script setup lang="ts">
import { ArrowRight } from '@lucide/vue';

defineOptions({ name: 'UiMoreLink' });

defineProps<{ to: string }>();
</script>

<template>
  <NuxtLink :to="to" class="ui-more-link">
    <slot />
    <ArrowRight :size="14" aria-hidden="true" />
  </NuxtLink>
</template>

<style scoped>
.ui-more-link {
  display: inline-flex;
  flex-shrink: 0;
  gap: var(--hf-space-1);
  align-items: center;
  color: var(--hf-color-action-primary-hover);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
  text-decoration: none;
  white-space: nowrap;
}

.ui-more-link:hover {
  color: var(--hf-color-action-primary-active);
  text-decoration: underline;
}

.ui-more-link svg {
  transition: transform var(--hf-transition-fast);
}

.ui-more-link:hover svg {
  transform: translateX(2px);
}

.ui-more-link:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}
</style>
