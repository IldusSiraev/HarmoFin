<script setup lang="ts">
import { ref } from 'vue';

import { DEMO_STEP_COUNT } from '../../data/demo-scenario.js';

defineOptions({ name: 'DemoStepCard' });

defineProps<{
  step: number;
  title: string;
  body: string;
  choices?: Array<{ value: string; label: string; hint: string }> | undefined;
  selected?: string | null | undefined;
}>();
const emit = defineEmits<{ choose: [value: string] }>();

const heading = ref<HTMLElement | null>(null);
defineExpose({ focusHeading: () => heading.value?.focus() });
</script>

<template>
  <section class="demo-step">
    <p class="demo-step__progress" aria-live="polite">
      Шаг {{ step + 1 }} из {{ DEMO_STEP_COUNT }}
    </p>
    <h2 ref="heading" class="demo-step__title" tabindex="-1">{{ title }}</h2>
    <p class="demo-step__body">{{ body }}</p>
    <div
      v-if="choices?.length"
      class="demo-step__choices"
      role="radiogroup"
      aria-label="Выберите вариант"
    >
      <button
        v-for="choice in choices"
        :key="choice.value"
        type="button"
        role="radio"
        class="demo-step__choice"
        :class="{ 'demo-step__choice--selected': selected === choice.value }"
        :aria-checked="selected === choice.value ? 'true' : 'false'"
        @click="emit('choose', choice.value)"
      >
        <span class="demo-step__choice-label">{{ choice.label }}</span>
        <span class="demo-step__choice-hint">{{ choice.hint }}</span>
        <span v-if="selected === choice.value" class="demo-step__choice-mark">Выбрано</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.demo-step {
  display: grid;
  gap: var(--hf-space-3);
}

.demo-step__progress {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.demo-step__title {
  margin: 0;
}

.demo-step__body {
  margin: 0;
  color: var(--hf-color-text);
  line-height: 1.55;
}

.demo-step__choices {
  display: grid;
  gap: var(--hf-space-3);
  margin-top: var(--hf-space-2);
}

.demo-step__choice {
  display: grid;
  gap: var(--hf-space-1);
  min-height: 2.75rem;
  padding: var(--hf-space-3) var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  text-align: left;
  cursor: pointer;
}

.demo-step__choice--selected {
  border-color: var(--hf-color-action-primary);
  box-shadow: inset 0 0 0 1px var(--hf-color-action-primary);
}

.demo-step__choice-label {
  font-weight: var(--hf-font-weight-semibold);
}

.demo-step__choice-hint,
.demo-step__choice-mark {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
</style>
