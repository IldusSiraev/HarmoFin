<script setup lang="ts">
import { computed } from 'vue';

import UiButtonGroup, { type ButtonGroupOption } from '../ui/ButtonGroup.vue';
import UiSelect from '../ui/Select.vue';

defineOptions({ name: 'OwnerFilter' });

const props = defineProps<{
  /** None: single-member family, control is hidden. */
  kind: 'none' | 'toggle' | 'chip';
  options: ReadonlyArray<ButtonGroupOption>;
  modelValue: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

// The Calm Fintech filter pattern keeps a segmented group on one row only;
// beyond five owner options the same choice moves to the labelled select.
const MAX_GROUP_OPTIONS = 5;

const useGroup = computed(() => props.options.length <= MAX_GROUP_OPTIONS);
</script>

<template>
  <UiButtonGroup
    v-if="kind !== 'none' && useGroup"
    :options="options"
    :model-value="modelValue"
    label="Владелец"
    testid-prefix="owner-filter"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <UiSelect
    v-else-if="kind === 'chip'"
    name="owner-filter"
    :options="options"
    :model-value="modelValue"
    label="Владелец"
    data-testid="owner-filter-select"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
