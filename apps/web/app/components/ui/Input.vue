<script setup lang="ts">
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
    required?: boolean;
    disabled?: boolean;
    readonly?: boolean;
  }>(),
  {
    id: undefined,
    type: 'text',
    autocomplete: undefined,
    inputmode: undefined,
    placeholder: undefined,
    hint: undefined,
    error: undefined,
    required: false,
    disabled: false,
    readonly: false,
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
    | 'none'
    | 'text'
    | 'tel'
    | 'url'
    | 'email'
    | 'numeric'
    | 'decimal'
    | 'search'
    | undefined;
}

function getHintId() {
  return `${getInputId()}-hint`;
}

function getErrorId() {
  return `${getInputId()}-error`;
}

function getDescribedBy() {
  return [props.hint ? getHintId() : undefined, props.error ? getErrorId() : undefined]
    .filter(Boolean)
    .join(' ') || undefined;
}

function handleInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="ui-field">
    <label class="ui-field__label" :for="getInputId()">
      {{ label }}<span v-if="required" aria-hidden="true"> *</span>
    </label>
    <input
      :id="getInputId()"
      class="ui-field__control"
      :class="{ 'ui-field__control--error': error }"
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
    >
    <p v-if="hint" :id="getHintId()" class="ui-field__hint">{{ hint }}</p>
    <p v-if="error" :id="getErrorId()" class="ui-field__error">{{ error }}</p>
  </div>
</template>

<style scoped>
.ui-field {
  display: grid;
  gap: var(--hf-space-2);
}

.ui-field__label {
  font-weight: var(--hf-font-weight-medium);
  color: var(--hf-color-text);
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

.ui-field__control::placeholder {
  color: var(--hf-color-text-subtle);
}

.ui-field__control--error {
  border-color: var(--hf-color-border-danger);
}

.ui-field__control:disabled,
.ui-field__control:readonly {
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
