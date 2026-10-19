<script setup lang="ts">
import { computed } from 'vue';

import UiInput from '../ui/Input.vue';
import { cycleErrors } from './demo-cycle.js';

defineOptions({ name: 'DemoCycleStep' });

const props = defineProps<{ start: string; offset: string }>();
const emit = defineEmits<{ 'update:start': [value: string]; 'update:offset': [value: string] }>();

const errors = computed(() => cycleErrors(props.start, props.offset));
</script>

<template>
  <div class="demo-cycle">
    <div class="demo-cycle__fields">
      <UiInput
        :model-value="start"
        name="demo-cycle-start"
        label="Начало первого периода"
        inputmode="numeric"
        :error="errors.start"
        @update:model-value="emit('update:start', String($event))"
      />
      <UiInput
        :model-value="offset"
        name="demo-cycle-offset"
        label="Граница второго периода (дней от начала первого)"
        inputmode="numeric"
        :error="errors.offset"
        @update:model-value="emit('update:offset', String($event))"
      />
    </div>
  </div>
</template>

<style scoped>
.demo-cycle {
  display: grid;
  gap: var(--hf-space-5);
}

.demo-cycle__fields {
  display: grid;
  gap: var(--hf-space-4);
  max-width: 28rem;
}
</style>
