<script setup lang="ts">
import { computed } from 'vue';
import { ru } from 'date-fns/locale';
import { VueDatePicker } from '@vuepic/vue-datepicker';

import UiTooltip from './Tooltip.vue';
import { useColorScheme } from '../../composables/useColorScheme.js';

import '@vuepic/vue-datepicker/dist/main.css';

defineOptions({ name: 'UiDatePicker' });

const props = withDefaults(
  defineProps<{
    modelValue: string;
    id?: string | undefined;
    name: string;
    label: string;
    hint?: string | undefined;
    error?: string | undefined;
    tooltip?: string | undefined;
    required?: boolean;
    disabled?: boolean;
    hideLabel?: boolean;
  }>(),
  {
    id: undefined,
    hint: undefined,
    error: undefined,
    tooltip: undefined,
    required: false,
    disabled: false,
    hideLabel: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { resolved } = useColorScheme();
const isDark = computed(() => resolved() === 'dark');

function getInputId(): string {
  return props.id ?? `${props.name}-input`;
}

function getHintId(): string {
  return `${getInputId()}-hint`;
}

function getErrorId(): string {
  return `${getInputId()}-error`;
}

function getDescribedBy(): string | undefined {
  return (
    [props.hint ? getHintId() : undefined, props.error ? getErrorId() : undefined]
      .filter(Boolean)
      .join(' ') || undefined
  );
}

// The trigger stays a real, library-owned <input> (not a custom slot
// replacement) — VueDatePicker positions its popover relative to that
// element internally, and a fully custom trigger loses that anchor.
const inputAttrs = computed(() => ({
  id: getInputId(),
  name: props.name,
  required: props.required,
  clearable: !props.required,
  'aria-describedby': getDescribedBy(),
  ...(props.error ? { state: false } : {}),
}));

const ariaLabels = {
  input: 'Дата',
  clearInput: 'Очистить дату',
  calendarIcon: 'Открыть календарь',
  menu: 'Календарь',
  nextMonth: 'Следующий месяц',
  prevMonth: 'Предыдущий месяц',
  nextYear: 'Следующий год',
  prevYear: 'Предыдущий год',
  toggleOverlay: 'Переключить вид',
};

function handleUpdate(value: unknown): void {
  emit('update:modelValue', typeof value === 'string' ? value : '');
}
</script>

<template>
  <div class="ui-field ui-date-field">
    <div
      class="ui-field__label-row"
      :class="{ 'ui-field__label-row--empty': hideLabel && !tooltip }"
    >
      <label
        class="ui-field__label"
        :class="{ 'ui-field__label--visually-hidden': hideLabel }"
        :for="getInputId()"
      >
        {{ label }}<span v-if="required" aria-hidden="true"> *</span>
      </label>
      <UiTooltip v-if="tooltip" v-slot="{ describedby }" :text="tooltip">
        <button
          type="button"
          class="ui-field__tooltip-trigger"
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

    <VueDatePicker
      :model-value="modelValue || null"
      model-type="yyyy-MM-dd"
      :formats="{ input: 'dd.MM.yyyy' }"
      :locale="ru"
      :week-start="1"
      :time-config="{ enableTimePicker: false }"
      :input-attrs="inputAttrs"
      :aria-labels="ariaLabels"
      :disabled="disabled"
      :dark="isDark"
      auto-apply
      teleport="body"
      @update:model-value="handleUpdate"
    />

    <p v-if="hint" :id="getHintId()" class="ui-field__hint">{{ hint }}</p>
    <p v-if="error" :id="getErrorId()" class="ui-field__error">{{ error }}</p>
  </div>
</template>

<style scoped>
.ui-field {
  display: grid;
  gap: var(--hf-space-2);
}

.ui-field__label-row {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
}

.ui-field__label-row--empty {
  display: contents;
}

.ui-field__label {
  font-weight: var(--hf-font-weight-medium);
  color: var(--hf-color-text);
}

.ui-field__label--visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.ui-field__tooltip-trigger {
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

.ui-field__tooltip-trigger:hover,
.ui-field__tooltip-trigger:focus-visible {
  color: var(--hf-color-action-primary);
}

.ui-field__tooltip-trigger:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}

.ui-field__hint,
.ui-field__error {
  margin: 0;
  font-size: 0.875rem;
}

.ui-field__hint {
  color: var(--hf-color-text-muted);
}

.ui-field__error {
  color: var(--hf-color-text-danger);
}
</style>

<style>
/* VueDatePicker is themed globally (not scoped): its trigger input renders
   inline here, but the calendar popover teleports to <body>, outside this
   component's scoped-style subtree. Values map the library's own CSS
   variables and input classes onto our design tokens so both pieces still
   read as one field, styled like every other UiInput. */
.dp--theme-light,
.dp--theme-dark {
  --dp-font-family: inherit;
  --dp-border-radius: var(--hf-control-radius);
  --dp-cell-border-radius: var(--hf-radius-sm);
  --dp-background-color: var(--hf-color-surface);
  --dp-text-color: var(--hf-color-text);
  --dp-hover-color: var(--hf-color-action-secondary-hover);
  --dp-hover-text-color: var(--hf-color-text);
  --dp-hover-icon-color: var(--hf-color-text);
  --dp-primary-color: var(--hf-color-action-primary);
  --dp-primary-text-color: var(--hf-color-white);
  --dp-secondary-color: var(--hf-color-text-subtle);
  --dp-border-color: var(--hf-color-border-strong);
  --dp-menu-border-color: var(--hf-color-border);
  --dp-border-color-hover: var(--hf-color-border-strong);
  --dp-icon-color: var(--hf-color-text-muted);
  --dp-danger-color: var(--hf-color-status-danger);
  --dp-highlight-color: var(--hf-color-brand-soft);
  --dp-font-size: 1rem;
  --dp-input-padding: 0 var(--hf-control-padding-inline);
}

.ui-date-field .dp__input_wrap,
.ui-date-field .dp--input-wrap {
  width: 100%;
}

.ui-date-field .dp--input {
  min-height: var(--hf-control-height-md);
  cursor: pointer;
}
</style>
