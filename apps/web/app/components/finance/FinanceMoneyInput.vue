<script setup lang="ts">
import UiInput from '../ui/Input.vue';

defineOptions({ name: 'FinanceMoneyInput' });

withDefaults(
  defineProps<{
    modelValue: string;
    id?: string | undefined;
    name: string;
    label: string;
    autocomplete?: string | undefined;
    placeholder?: string | undefined;
    tooltip?: string | undefined;
    hint?: string | undefined;
    error?: string | undefined;
    required?: boolean;
    disabled?: boolean;
    readonly?: boolean;
  }>(),
  {
    id: undefined,
    autocomplete: undefined,
    placeholder: undefined,
    tooltip: undefined,
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

function handleModelValue(value: string) {
  emit('update:modelValue', value);
}

function handleBlur(event: FocusEvent) {
  emit('blur', event);
}
</script>

<template>
  <UiInput
    :id="id"
    :model-value="modelValue"
    :name="name"
    :label="label"
    type="text"
    inputmode="decimal"
    :autocomplete="autocomplete"
    :placeholder="placeholder"
    :tooltip="tooltip"
    :hint="hint"
    :error="error"
    :required="required"
    :disabled="disabled"
    :readonly="readonly"
    @update:model-value="handleModelValue"
    @blur="handleBlur"
  />
</template>
