<script setup lang="ts">
import type { Component } from 'vue';

export interface PillOption {
  value: string;
  label: string;
  /** Decorative icon before the label. */
  icon?: Component | undefined;
  /** CSS colour of the icon while the option is not selected, e.g. a type hue. */
  iconColor?: string | undefined;
  /** Short note shown as a dot and read by screen readers, e.g. "текущий период". */
  marker?: string | undefined;
}

defineOptions({ name: 'UiPillSelect' });

const props = withDefaults(
  defineProps<{
    name: string;
    label: string;
    options: ReadonlyArray<PillOption>;
    modelValue: string;
    accent?: 'danger' | 'success' | 'info';
    required?: boolean;
    error?: string | undefined;
  }>(),
  { accent: 'info', required: false, error: undefined },
);

defineEmits<{ 'update:modelValue': [value: string] }>();

// Written out in full (not interpolated) so the token-usage scan in
// tokens.test.ts can resolve each variable name statically.
const accentVar: Record<'danger' | 'success' | 'info', string> = {
  danger: 'var(--hf-color-status-danger)',
  success: 'var(--hf-color-status-success)',
  info: 'var(--hf-color-status-info)',
};
</script>

<template>
  <div class="pill-select" :style="{ '--pill-accent': accentVar[props.accent] }">
    <p class="pill-select__label">{{ label }}<span v-if="required" aria-hidden="true"> *</span></p>
    <div class="pill-select__options" role="radiogroup" :aria-label="label">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        role="radio"
        class="pill-select__option"
        :class="{ 'pill-select__option--active': modelValue === option.value }"
        :aria-checked="modelValue === option.value"
        :data-testid="`pill-${name}-${option.value}`"
        @click="$emit('update:modelValue', option.value)"
      >
        <component
          :is="option.icon"
          v-if="option.icon"
          class="pill-select__icon"
          :style="
            option.iconColor && modelValue !== option.value
              ? { color: option.iconColor }
              : undefined
          "
          :size="16"
          aria-hidden="true"
        />
        <span>{{ option.label }}</span>
        <span
          v-if="option.marker"
          class="pill-select__marker"
          :title="option.marker"
          :data-testid="`pill-${name}-${option.value}-marker`"
        >
          <span class="pill-select__marker-text">{{ option.marker }}</span>
        </span>
      </button>
    </div>
    <p v-if="error" class="pill-select__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.pill-select {
  display: grid;
  gap: var(--hf-space-2);
}

.pill-select__label {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
}

.pill-select__options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}

.pill-select__option {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-2);
  min-height: var(--hf-control-height-md);
  padding: 0 var(--hf-space-4);
  border: 1px solid var(--hf-color-border-strong);
  border-radius: var(--hf-radius-xl);
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
  cursor: pointer;
  transition:
    border-color var(--hf-transition-fast),
    color var(--hf-transition-fast);
}

.pill-select__option:hover {
  background: var(--hf-color-action-secondary-hover);
}

.pill-select__option:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.pill-select__option--active {
  border-color: var(--pill-accent);
  color: var(--pill-accent);
}

.pill-select__icon {
  flex-shrink: 0;
  color: var(--hf-color-text-muted);
}

.pill-select__option--active .pill-select__icon {
  color: var(--pill-accent);
}

.pill-select__marker {
  position: relative;
  width: 0.5rem;
  height: 0.5rem;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--hf-color-status-success);
}

.pill-select__marker-text {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.pill-select__error {
  margin: 0;
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-small);
}
</style>
