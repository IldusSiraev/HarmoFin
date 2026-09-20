<script setup lang="ts">
import { CATEGORY_ICON_OPTIONS } from '../operations/category-icon.js';

defineOptions({ name: 'CategoryIconPicker' });

const props = defineProps<{ modelValue: string | null }>();
const emit = defineEmits<{ 'update:modelValue': [string | null] }>();

function select(key: string): void {
  emit('update:modelValue', props.modelValue === key ? null : key);
}
</script>

<template>
  <fieldset class="category-icon-picker">
    <legend>Иконка</legend>
    <div class="category-icon-picker__grid">
      <button
        v-for="option in CATEGORY_ICON_OPTIONS"
        :key="option.key"
        type="button"
        class="category-icon-picker__item"
        :aria-pressed="option.key === modelValue"
        :aria-label="option.label"
        @click="select(option.key)"
      >
        <component :is="option.component" :size="18" aria-hidden="true" />
      </button>
    </div>
  </fieldset>
</template>

<style scoped>
.category-icon-picker {
  border: none;
  padding: 0;
  margin: 0 0 var(--hf-space-3);
}

.category-icon-picker legend {
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: var(--hf-space-2);
  padding: 0;
}

.category-icon-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  gap: 6px;
}

.category-icon-picker__item {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  min-width: 40px;
  border-radius: var(--hf-radius-md);
  border: 1px solid var(--hf-color-border);
  background: var(--hf-color-surface);
  color: var(--hf-color-text-muted);
  cursor: pointer;
  transition: all var(--hf-transition-fast);
}

.category-icon-picker__item:hover {
  border-color: var(--hf-color-action-primary);
  color: var(--hf-color-action-primary);
}

.category-icon-picker__item[aria-pressed='true'] {
  border-color: var(--hf-color-action-primary);
  color: var(--hf-color-action-primary);
  background: var(--hf-color-brand-soft);
}
</style>
