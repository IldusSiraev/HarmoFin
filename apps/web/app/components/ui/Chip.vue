<script setup lang="ts">
import { ChevronDown } from '@lucide/vue';

defineOptions({ name: 'UiChip' });

withDefaults(defineProps<{ label: string; value?: string | undefined; active?: boolean }>(), {
  value: undefined,
  active: false,
});

defineEmits<{ click: [] }>();
</script>

<template>
  <button
    type="button"
    class="ui-chip"
    :class="{ 'ui-chip--active': active }"
    :aria-pressed="active ? 'true' : 'false'"
    @click="$emit('click')"
  >
    <span class="ui-chip__label">{{ label }}</span>
    <span v-if="value" class="ui-chip__value">{{ value }}</span>
    <ChevronDown :size="16" aria-hidden="true" />
  </button>
</template>

<style scoped>
.ui-chip {
  display: inline-flex;
  gap: var(--hf-space-1);
  align-items: center;
  min-height: var(--hf-control-height-md);
  padding: 0 var(--hf-space-3);
  border: 1px solid var(--hf-color-border-strong);
  border-radius: var(--hf-radius-xl);
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}

.ui-chip:hover {
  background: var(--hf-color-action-secondary-hover);
}

.ui-chip:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.ui-chip--active {
  border-color: var(--hf-color-brand);
  background: var(--hf-color-brand-soft);
  color: var(--hf-color-brand);
}

.ui-chip__value {
  font-weight: var(--hf-font-weight-semibold);
}
</style>
