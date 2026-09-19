<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import UiTooltip from './Tooltip.vue';

defineOptions({ name: 'UiSelect' });

type SelectOption = Readonly<{
  value: string;
  label: string;
  disabled?: boolean;
}>;

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: ReadonlyArray<SelectOption>;
    id?: string | undefined;
    name: string;
    label: string;
    placeholder?: string | undefined;
    hint?: string | undefined;
    error?: string | undefined;
    tooltip?: string | undefined;
    required?: boolean;
    disabled?: boolean;
    searchable?: boolean;
  }>(),
  {
    id: undefined,
    placeholder: undefined,
    hint: undefined,
    error: undefined,
    tooltip: undefined,
    required: false,
    disabled: false,
    searchable: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  blur: [event: FocusEvent];
}>();

function getSelectId() {
  return props.id ?? `${props.name}-select`;
}

function getHintId() {
  return `${getSelectId()}-hint`;
}

function getErrorId() {
  return `${getSelectId()}-error`;
}

function getListboxId() {
  return `${getSelectId()}-listbox`;
}

function getDescribedBy() {
  return (
    [props.hint ? getHintId() : undefined, props.error ? getErrorId() : undefined]
      .filter(Boolean)
      .join(' ') || undefined
  );
}

function handleChange(event: Event) {
  emit('update:modelValue', (event.target as HTMLSelectElement).value);
}

// --- searchable combobox ---
function labelFor(value: string): string {
  return props.options.find((option) => option.value === value)?.label ?? '';
}

const query = ref('');
const open = ref(false);
const activeIndex = ref(0);

watch(
  () => props.modelValue,
  (value) => {
    query.value = labelFor(value);
  },
  { immediate: true },
);

const filteredOptions = computed(() => {
  const search = query.value.trim().toLowerCase();
  if (!search || search === labelFor(props.modelValue).toLowerCase()) return props.options;
  return props.options.filter((option) => option.label.toLowerCase().includes(search));
});

function getOptionId(index: number) {
  return `${getListboxId()}-option-${index}`;
}

function openList() {
  if (props.disabled) return;
  open.value = true;
  activeIndex.value = 0;
}

function closeList() {
  open.value = false;
  query.value = labelFor(props.modelValue);
}

function selectOption(option: SelectOption) {
  if (option.disabled) return;
  emit('update:modelValue', option.value);
  query.value = option.label;
  open.value = false;
}

function handleQueryInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value;
  open.value = true;
  activeIndex.value = 0;
}

function handleComboKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (!open.value) {
      openList();
      return;
    }
    activeIndex.value = Math.min(activeIndex.value + 1, filteredOptions.value.length - 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
  } else if (event.key === 'Enter') {
    const option = filteredOptions.value[activeIndex.value];
    if (open.value && option) {
      event.preventDefault();
      selectOption(option);
    }
  } else if (event.key === 'Escape') {
    closeList();
  }
}

function handleComboBlur(event: FocusEvent) {
  closeList();
  emit('blur', event);
}
</script>

<template>
  <div class="ui-select">
    <div class="ui-select__label-row">
      <label class="ui-select__label" :for="getSelectId()">
        {{ label }}<span v-if="required" aria-hidden="true"> *</span>
      </label>
      <UiTooltip v-if="tooltip" :text="tooltip" v-slot="{ describedby }">
        <button
          type="button"
          class="ui-select__tooltip-trigger"
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
    </div>

    <div v-if="searchable" class="ui-select__combobox">
      <input
        :id="getSelectId()"
        class="ui-select__control"
        :class="{ 'ui-select__control--error': error }"
        type="text"
        role="combobox"
        autocomplete="off"
        :name="name"
        :value="query"
        :placeholder="placeholder"
        aria-autocomplete="list"
        :aria-expanded="open"
        :aria-controls="getListboxId()"
        :aria-activedescendant="
          open && filteredOptions[activeIndex] ? getOptionId(activeIndex) : undefined
        "
        :aria-describedby="getDescribedBy()"
        :aria-invalid="error ? 'true' : undefined"
        :aria-required="required || undefined"
        :disabled="disabled"
        @focus="openList"
        @input="handleQueryInput"
        @keydown="handleComboKeydown"
        @blur="handleComboBlur"
      />
      <ul v-if="open" :id="getListboxId()" class="ui-select__listbox" role="listbox">
        <li
          v-for="(option, index) in filteredOptions"
          :id="getOptionId(index)"
          :key="option.value"
          role="option"
          class="ui-select__option"
          :class="{ 'ui-select__option--active': index === activeIndex }"
          :aria-selected="option.value === modelValue"
          @mousedown.prevent="selectOption(option)"
        >
          {{ option.label }}
        </li>
        <li v-if="filteredOptions.length === 0" class="ui-select__option ui-select__option--empty">
          Ничего не найдено
        </li>
      </ul>
    </div>
    <select
      v-else
      :id="getSelectId()"
      class="ui-select__control"
      :class="{ 'ui-select__control--error': error }"
      :value="modelValue"
      :name="name"
      :aria-describedby="getDescribedBy()"
      :aria-invalid="error ? 'true' : undefined"
      :aria-required="required || undefined"
      :required="required"
      :disabled="disabled"
      @change="handleChange"
      @blur="emit('blur', $event)"
    >
      <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
      <option
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        :disabled="option.disabled"
      >
        {{ option.label }}
      </option>
    </select>

    <p v-if="hint" :id="getHintId()" class="ui-select__hint">{{ hint }}</p>
    <p v-if="error" :id="getErrorId()" class="ui-select__error">{{ error }}</p>
  </div>
</template>

<style scoped>
.ui-select {
  display: grid;
  gap: var(--hf-space-2);
}

.ui-select__label-row {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
}

.ui-select__label {
  font-weight: var(--hf-font-weight-medium);
  color: var(--hf-color-text);
}

.ui-select__tooltip-trigger {
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

.ui-select__tooltip-trigger:hover,
.ui-select__tooltip-trigger:focus-visible {
  color: var(--hf-color-action-primary);
}

.ui-select__tooltip-trigger:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}

.ui-select__control {
  width: 100%;
  min-height: var(--hf-control-height-md);
  padding-inline: var(--hf-control-padding-inline);
  color: var(--hf-color-text);
  border: 1px solid var(--hf-color-border-strong);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
}

.ui-select__control--error {
  border-color: var(--hf-color-border-danger);
}

.ui-select__control:disabled {
  background: var(--hf-color-surface-subtle);
}

.ui-select__hint,
.ui-select__error {
  margin: 0;
  font-size: 0.875rem;
}

.ui-select__hint {
  color: var(--hf-color-text-muted);
}

.ui-select__error {
  color: var(--hf-color-text-danger);
}

.ui-select__combobox {
  position: relative;
}

.ui-select__listbox {
  position: absolute;
  z-index: var(--hf-z-index-tooltip);
  width: 100%;
  max-height: 16rem;
  margin: var(--hf-space-1) 0 0;
  padding: var(--hf-space-1);
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--hf-color-border-strong);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

.ui-select__option {
  padding: var(--hf-space-2) var(--hf-space-3);
  border-radius: var(--hf-radius-sm);
  cursor: pointer;
}

.ui-select__option--active {
  background: var(--hf-color-action-secondary-hover);
}

.ui-select__option--empty {
  color: var(--hf-color-text-muted);
  cursor: default;
}
</style>
