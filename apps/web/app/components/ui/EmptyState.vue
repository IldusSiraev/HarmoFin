<script setup lang="ts">
import { useId } from 'vue';

const emptyStateId = useId();

function getTitleId() {
  return `ui-empty-state-${emptyStateId}-title`;
}

defineProps<{
  title: string;
  description: string;
}>();
</script>

<template>
  <section class="ui-empty-state" :aria-labelledby="getTitleId()">
    <div v-if="$slots.illustration" class="ui-empty-state__illustration" aria-hidden="true">
      <slot name="illustration" />
    </div>
    <div class="ui-empty-state__content">
      <h2 :id="getTitleId()" class="ui-empty-state__title">{{ title }}</h2>
      <p class="ui-empty-state__description">{{ description }}</p>
      <div v-if="$slots.action" class="ui-empty-state__action"><slot name="action" /></div>
    </div>
  </section>
</template>

<style scoped>
.ui-empty-state {
  display: grid;
  justify-items: center;
  gap: var(--hf-space-5);
  padding: var(--hf-space-10) var(--hf-space-5);
  text-align: center;
  border: 1px dashed var(--hf-color-border-strong);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
}

.ui-empty-state__illustration {
  color: var(--hf-color-text-subtle);
}

.ui-empty-state__content {
  display: grid;
  justify-items: center;
  gap: var(--hf-space-2);
  max-width: 36rem;
}

.ui-empty-state__title,
.ui-empty-state__description {
  margin: 0;
}

.ui-empty-state__title {
  font-size: 1.25rem;
  font-weight: var(--hf-font-weight-semibold);
}

.ui-empty-state__description {
  color: var(--hf-color-text-muted);
}

.ui-empty-state__action {
  margin-top: var(--hf-space-2);
}
</style>
