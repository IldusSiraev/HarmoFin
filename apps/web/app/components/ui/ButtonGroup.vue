<script setup lang="ts">
defineOptions({ name: 'UiButtonGroup' });

export interface ButtonGroupOption {
  value: string;
  label: string;
}

withDefaults(
  defineProps<{
    options: ReadonlyArray<ButtonGroupOption>;
    modelValue: string;
    /** Accessible name of the group, e.g. "Тип операций". */
    label: string;
    /** Each button gets `data-testid="<prefix>-<value or 'all'>"`. */
    testidPrefix?: string | undefined;
  }>(),
  { testidPrefix: undefined },
);

defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<template>
  <!-- Segmented control for a single choice among a few filter values: one
       outlined track instead of separate pills, so it takes one short row. -->
  <div class="ui-button-group" role="group" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="ui-button-group__button"
      :class="{ 'ui-button-group__button--active': modelValue === option.value }"
      :aria-pressed="modelValue === option.value ? 'true' : 'false'"
      :data-testid="testidPrefix ? `${testidPrefix}-${option.value || 'all'}` : undefined"
      @click="$emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.ui-button-group {
  display: inline-flex;
  max-width: 100%;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--hf-color-border-strong);
  border-radius: 999px;
  background: var(--hf-color-surface);
}

.ui-button-group__button {
  min-height: calc(2.25rem - 6px);
  padding: 0 var(--hf-space-3);
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--hf-color-text-muted);
  font: inherit;
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
  white-space: nowrap;
  cursor: pointer;
}

/* Same 36px look on every screen; on touch screens the hit area still
   reaches 44px through this invisible vertical extension. */
.ui-button-group__button {
  position: relative;
}

.ui-button-group__button::before {
  content: '';
  position: absolute;
  inset: -7px 0;
}

.ui-button-group__button:hover {
  color: var(--hf-color-text);
}

.ui-button-group__button:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.ui-button-group__button--active,
.ui-button-group__button--active:hover {
  background: var(--hf-color-brand-soft);
  color: var(--hf-color-action-primary-text);
}
</style>
