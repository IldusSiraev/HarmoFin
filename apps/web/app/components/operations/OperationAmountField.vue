<script setup lang="ts">
import { ChevronDown, ChevronUp } from '@lucide/vue';

defineOptions({ name: 'OperationAmountField' });

const props = withDefaults(
  defineProps<{
    modelValue: string;
    accent?: 'danger' | 'success' | 'info';
    currencySymbol?: string;
    error?: string | undefined;
  }>(),
  { accent: 'info', currencySymbol: '₽', error: undefined },
);

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

// Written out in full (not interpolated) so the token-usage scan in
// tokens.test.ts can resolve each variable name statically.
const accentVar: Record<'danger' | 'success' | 'info', string> = {
  danger: 'var(--hf-color-status-danger)',
  success: 'var(--hf-color-status-success)',
  info: 'var(--hf-color-status-info)',
};

function handleInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}

// A quick nudge for the common "round the amount up/down" adjustment — the
// server re-validates the final decimal string, so this only needs to avoid
// drifting through float rounding while the user taps the stepper.
function step(delta: 1 | -1): void {
  const cents = Math.round((Number.parseFloat(props.modelValue.replace(',', '.')) || 0) * 100);
  const next = Math.max(0, cents + delta * 100);
  emit('update:modelValue', (next / 100).toFixed(2));
}
</script>

<template>
  <div class="amount-field" :style="{ '--amount-accent': accentVar[accent] }">
    <p class="amount-field__label">Сумма</p>
    <div class="amount-field__row">
      <input
        class="amount-field__input"
        type="text"
        inputmode="decimal"
        name="amount"
        :value="modelValue"
        :aria-invalid="error ? 'true' : undefined"
        @input="handleInput"
      >
      <span class="amount-field__currency" aria-hidden="true">{{ currencySymbol }}</span>
      <span class="amount-field__steppers">
        <button type="button" aria-label="Увеличить сумму" @click="step(1)">
          <ChevronUp :size="16" aria-hidden="true" />
        </button>
        <button type="button" aria-label="Уменьшить сумму" @click="step(-1)">
          <ChevronDown :size="16" aria-hidden="true" />
        </button>
      </span>
    </div>
    <p v-if="error" class="amount-field__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.amount-field {
  display: grid;
  justify-items: center;
  gap: var(--hf-space-2);
}

.amount-field__label {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.amount-field__row {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  padding-bottom: var(--hf-space-2);
  border-bottom: 2px solid var(--amount-accent);
}

.amount-field__input {
  width: 8rem;
  border: none;
  background: transparent;
  color: var(--amount-accent);
  font-family: inherit;
  font-size: clamp(2rem, 6vw, 2.75rem);
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.amount-field__input:focus-visible {
  outline: none;
}

.amount-field__currency {
  color: var(--amount-accent);
  font-size: clamp(1.5rem, 4vw, 2rem);
  font-weight: var(--hf-font-weight-medium);
}

.amount-field__steppers {
  display: grid;
  margin-left: var(--hf-space-1);
}

.amount-field__steppers button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.25rem;
  border: none;
  background: transparent;
  color: var(--hf-color-text-muted);
  cursor: pointer;
}

.amount-field__steppers button:hover {
  color: var(--amount-accent);
}

.amount-field__steppers button:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 1px;
}

.amount-field__error {
  margin: 0;
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-small);
}
</style>
