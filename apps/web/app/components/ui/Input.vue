<script setup lang="ts">
import UiTooltip from './Tooltip.vue';

defineOptions({ name: 'UiInput' });

const props = withDefaults(
  defineProps<{
    modelValue: string;
    id?: string | undefined;
    name: string;
    label: string;
    type?: 'text' | 'email' | 'password' | 'search' | 'date';
    autocomplete?: string | undefined;
    inputmode?: string | undefined;
    placeholder?: string | undefined;
    hint?: string | undefined;
    error?: string | undefined;
    tooltip?: string | undefined;
    required?: boolean;
    disabled?: boolean;
    readonly?: boolean;
    hideLabel?: boolean;
  }>(),
  {
    id: undefined,
    type: 'text',
    autocomplete: undefined,
    inputmode: undefined,
    placeholder: undefined,
    hint: undefined,
    error: undefined,
    tooltip: undefined,
    required: false,
    disabled: false,
    readonly: false,
    hideLabel: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  blur: [event: FocusEvent];
}>();

function getInputId() {
  return props.id ?? `${props.name}-input`;
}

function getInputMode() {
  return props.inputmode as
    'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search' | undefined;
}

function getHintId() {
  return `${getInputId()}-hint`;
}

function getErrorId() {
  return `${getInputId()}-error`;
}

function getDescribedBy() {
  return (
    [props.hint ? getHintId() : undefined, props.error ? getErrorId() : undefined]
      .filter(Boolean)
      .join(' ') || undefined
  );
}

function handleInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="ui-field">
    <div class="ui-field__label-row">
      <label
        class="ui-field__label"
        :class="{ 'ui-field__label--visually-hidden': hideLabel }"
        :for="getInputId()"
      >
        {{ label }}<span v-if="required" aria-hidden="true"> *</span>
      </label>
      <UiTooltip v-if="tooltip" :text="tooltip" v-slot="{ describedby }">
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
    <div class="ui-field__control-shell">
      <span v-if="$slots.icon" class="ui-field__icon" aria-hidden="true"><slot name="icon" /></span>
      <input
        :id="getInputId()"
        class="ui-field__control"
        :class="{
          'ui-field__control--error': error,
          'ui-field__control--with-icon': Boolean($slots.icon),
        }"
        :value="modelValue"
        :name="name"
        :type="type"
        :autocomplete="autocomplete"
        :inputmode="getInputMode()"
        :placeholder="placeholder"
        :aria-describedby="getDescribedBy()"
        :aria-invalid="error ? 'true' : undefined"
        :aria-required="required || undefined"
        :required="required"
        :disabled="disabled"
        :readonly="readonly"
        @input="handleInput"
        @blur="emit('blur', $event)"
      />
    </div>
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

/* The icon belongs inside the control, not next to the label: otherwise it
   centres against the whole field block and drifts away from the input. */
.ui-field__control-shell {
  position: relative;
  display: grid;
}

.ui-field__icon {
  position: absolute;
  top: 50%;
  left: var(--hf-control-padding-inline);
  display: inline-flex;
  align-items: center;
  transform: translateY(-50%);
  color: var(--hf-color-text-muted);
  pointer-events: none;
}

.ui-field__label {
  font-weight: var(--hf-font-weight-medium);
  color: var(--hf-color-text);
}

/* Visually hidden but still readable by assistive tech — the accessible
   name a label provides doesn't require it to occupy visual space, e.g. a
   search box whose placeholder plus surrounding context already say what
   it's for. */
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

.ui-field__control {
  width: 100%;
  min-height: var(--hf-control-height-md);
  padding-inline: var(--hf-control-padding-inline);
  color: var(--hf-color-text);
  border: 1px solid var(--hf-color-border-strong);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
}

/* After .ui-field__control: its padding-inline shorthand would win otherwise. */
.ui-field__control--with-icon {
  padding-left: calc(var(--hf-control-padding-inline) + var(--hf-space-3) + 1.125rem);
}

.ui-field__control::placeholder {
  color: var(--hf-color-text-subtle);
}

.ui-field__control--error {
  border-color: var(--hf-color-border-danger);
}

.ui-field__control:disabled,
.ui-field__control:read-only {
  background: var(--hf-color-surface-subtle);
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
