<script setup lang="ts">
import UiTooltip from './Tooltip.vue';

defineOptions({ name: 'UiInfoTooltip' });

defineProps<{ text: string }>();
</script>

<template>
  <UiTooltip v-slot="{ describedby }" :text="text">
    <button
      type="button"
      class="ui-info-tooltip"
      aria-label="Подсказка"
      :aria-describedby="describedby"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5" />
        <path d="M8 7v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <circle cx="8" cy="5.2" r="0.9" fill="currentColor" />
      </svg>
    </button>
  </UiTooltip>
</template>

<style scoped>
.ui-info-tooltip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  color: var(--hf-color-text-subtle);
  border: none;
  background: none;
  cursor: pointer;
}

.ui-info-tooltip:hover,
.ui-info-tooltip:focus-visible {
  color: var(--hf-color-action-primary);
}

.ui-info-tooltip:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}
</style>
