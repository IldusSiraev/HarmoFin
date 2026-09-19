<script setup lang="ts">
defineOptions({ name: 'UiPillSelect' });

const props = withDefaults(
  defineProps<{
    name: string;
    label: string;
    options: ReadonlyArray<{ value: string; label: string }>;
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
        {{ option.label }}
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

.pill-select__error {
  margin: 0;
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-small);
}
</style>
