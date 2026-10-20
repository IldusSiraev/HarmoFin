<script setup lang="ts">
import { ChevronDown, X } from '@lucide/vue';

defineOptions({ name: 'UiChip', inheritAttrs: false });

withDefaults(defineProps<{ label: string; value?: string | undefined }>(), {
  value: undefined,
});

defineEmits<{ click: []; clear: [] }>();
</script>

<template>
  <!-- Filter chip that opens a list of values. Once a value is chosen it shows
       that value plus its own clear button, so one filter is reset without
       opening the list or the "all filters" drawer. Attributes (data-testid,
       aria-expanded…) land on the trigger button, not on the wrapper. -->
  <span class="ui-chip" :class="{ 'ui-chip--active': Boolean(value) }">
    <button v-bind="$attrs" type="button" class="ui-chip__trigger" @click="$emit('click')">
      <span class="ui-chip__label">{{ label }}</span>
      <span v-if="value" class="ui-chip__value">{{ value }}</span>
      <ChevronDown v-else class="ui-chip__chevron" :size="16" aria-hidden="true" />
    </button>
    <button
      v-if="value"
      type="button"
      class="ui-chip__clear"
      :aria-label="`Сбросить фильтр «${label}»`"
      data-testid="chip-clear"
      @click="$emit('clear')"
    >
      <X :size="16" aria-hidden="true" />
    </button>
  </span>
</template>

<style scoped>
.ui-chip {
  display: inline-flex;
  align-items: stretch;
  max-width: 100%;
  min-height: 2.25rem;
  border: 1px solid var(--hf-color-border-strong);
  border-radius: 999px;
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-small);
}

.ui-chip:has(.ui-chip__trigger[aria-expanded='true']) {
  border-color: var(--hf-color-brand);
}

.ui-chip--active {
  border-color: var(--hf-color-brand);
  background: var(--hf-color-brand-soft);
  color: var(--hf-color-action-primary-text);
}

.ui-chip__trigger,
.ui-chip__clear {
  display: inline-flex;
  align-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.ui-chip__trigger {
  gap: var(--hf-space-1);
  min-width: 0;
  padding: 0 var(--hf-space-2) 0 var(--hf-space-3);
  white-space: nowrap;
}

.ui-chip--active .ui-chip__trigger {
  padding-right: var(--hf-space-1);
}

.ui-chip__clear {
  flex-shrink: 0;
  justify-content: center;
  width: 2.25rem;
  padding: 0;
}

.ui-chip__trigger:hover,
.ui-chip__clear:hover {
  background: var(--hf-color-action-secondary-hover);
}

.ui-chip__trigger:focus-visible,
.ui-chip__clear:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

/* Same 36px look on every screen; on touch screens the hit area still
   reaches 44px through this invisible vertical extension. */
.ui-chip__trigger,
.ui-chip__clear {
  position: relative;
}

.ui-chip__trigger::before,
.ui-chip__clear::before {
  content: '';
  position: absolute;
  inset: -5px 0;
}

.ui-chip__label {
  flex-shrink: 0;
}

/* A long chosen name ("Продукты и бытовая химия") must not stretch the chip
   past the row; the full value is still in the accessible name. */
.ui-chip__value {
  min-width: 0;
  max-width: 10rem;
  overflow: hidden;
  font-weight: var(--hf-font-weight-semibold);
  text-overflow: ellipsis;
}

.ui-chip__chevron {
  flex-shrink: 0;
  color: var(--hf-color-text-muted);
}
</style>
