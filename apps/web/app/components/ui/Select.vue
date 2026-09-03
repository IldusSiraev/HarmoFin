<script setup lang="ts">
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
    required?: boolean;
    disabled?: boolean;
  }>(),
  {
    id: undefined,
    placeholder: undefined,
    hint: undefined,
    error: undefined,
    required: false,
    disabled: false,
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

function getDescribedBy() {
  return [props.hint ? getHintId() : undefined, props.error ? getErrorId() : undefined]
    .filter(Boolean)
    .join(' ') || undefined;
}

function handleChange(event: Event) {
  emit('update:modelValue', (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <div class="ui-select">
    <label class="ui-select__label" :for="getSelectId()">
      {{ label }}<span v-if="required" aria-hidden="true"> *</span>
    </label>
    <select
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

.ui-select__label {
  font-weight: var(--hf-font-weight-medium);
  color: var(--hf-color-text);
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
</style>
