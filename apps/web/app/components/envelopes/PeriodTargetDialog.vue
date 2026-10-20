<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { AlertTriangle } from '@lucide/vue';

import UiButton from '../ui/Button.vue';
import UiModal from '../ui/Modal.vue';
import { type EnvelopePlanDto, useEnvelopePlanV2 } from '../../composables/useEnvelopePlanV2.js';
import { ApiRequestError } from '../../composables/useApiClient.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import { formatPlainDate } from '../obligations/format-plain-date.js';

defineOptions({ name: 'PeriodTargetDialog' });

// Explicit, confirmed change of one concrete period's target. Never assigns or
// moves money. The server owns every rule and answers with field errors.

const props = defineProps<{
  open: boolean;
  budgetId: string;
  envelope: EnvelopePlanDto | null;
  /** Start date of the envelope's current period; null when the data does not give it. */
  periodStart: string | null;
}>();
const emit = defineEmits<{ close: []; changed: [message: string] }>();

const v2 = useEnvelopePlanV2();

const AMOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;
const TARGET_TEXT = 'Укажите сумму от нуля, не более двух знаков после запятой.';

const value = ref('');
const fieldError = ref('');
const formError = ref('');
const pending = ref(false);
let attempt: { fingerprint: string; key: string } | null = null;

function attemptKey(payload: unknown): string {
  const fingerprint = JSON.stringify(payload);
  if (attempt?.fingerprint !== fingerprint) attempt = { fingerprint, key: crypto.randomUUID() };
  return attempt.key;
}

function focusInput(): void {
  // Runs after UiModal's own mount-time focus (queued in its onMounted, which
  // fires after this watcher's immediate run queues its own tick).
  void nextTick(() =>
    nextTick(() => document.querySelector<HTMLElement>('[data-testid="target-input"]')?.focus()),
  );
}

watch(
  () => [props.open, props.envelope?.id] as const,
  ([open]) => {
    if (!open) return;
    value.value = '';
    fieldError.value = '';
    formError.value = '';
    attempt = null;
    if (props.periodStart !== null) focusInput();
  },
  { immediate: true },
);

async function confirm(): Promise<void> {
  const envelope = props.envelope;
  const periodStart = props.periodStart;
  if (pending.value || !envelope || periodStart === null) return;
  const text = value.value.trim();
  fieldError.value = '';
  formError.value = '';
  if (!AMOUNT_PATTERN.test(text)) {
    fieldError.value = TARGET_TEXT;
    focusInput();
    return;
  }
  const body = { target: text.replace(',', '.') };
  pending.value = true;
  try {
    await v2.updatePeriodTarget(
      props.budgetId,
      envelope.id,
      periodStart,
      body,
      attemptKey({ periodStart, body }),
    );
    attempt = null;
    emit('changed', 'Цель текущего периода изменена.');
  } catch (error) {
    if (error instanceof ApiRequestError && (error.problem.fieldErrors ?? []).length > 0) {
      fieldError.value = TARGET_TEXT;
      focusInput();
    } else {
      formError.value = v2ErrorMessage(
        error,
        'Не удалось изменить цель. Повторите попытку: дубль не создастся.',
      );
    }
  } finally {
    pending.value = false;
  }
}

function requestClose(): void {
  if (!pending.value) emit('close');
}
</script>

<template>
  <UiModal :open="open" title="Цель текущего периода" size="sm" @close="requestClose">
    <div v-if="envelope" class="target-dialog">
      <p class="target-dialog__muted target-dialog__name">{{ envelope.name }}</p>
      <p v-if="periodStart === null" class="target-dialog__muted" data-testid="target-unavailable">
        Текущая цель периода недоступна для изменения здесь: период этого конверта не определён.
        Новое правило начнёт действовать со следующего периода.
      </p>
      <template v-else>
        <p class="target-dialog__warning" role="note" data-testid="target-consequence">
          <AlertTriangle :size="16" aria-hidden="true" />
          Внимание: подтверждённая цель периода с {{ formatPlainDate(periodStart) }} изменится на
          указанную сумму. Распределения и остаток конверта не изменятся.
        </p>
        <label class="target-dialog__field">
          <span>Новая цель периода, ₽</span>
          <input
            v-model="value"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            class="target-dialog__input"
            data-testid="target-input"
            :aria-invalid="fieldError ? 'true' : undefined"
            :aria-describedby="
              fieldError ? 'target-input-error target-input-hint' : 'target-input-hint'
            "
          />
        </label>
        <p id="target-input-hint" class="target-dialog__muted">
          Сумма от нуля, не более двух знаков после запятой.
        </p>
        <p
          v-if="fieldError"
          id="target-input-error"
          class="target-dialog__error"
          data-testid="target-error"
        >
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ fieldError }}
        </p>
        <p
          v-if="formError"
          class="target-dialog__error"
          role="alert"
          data-testid="target-form-error"
        >
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ formError }}
        </p>
      </template>
    </div>

    <template #footer>
      <UiButton
        v-if="periodStart !== null"
        :loading="pending"
        data-testid="target-confirm"
        @click="confirm"
      >
        Подтвердить изменение цели
      </UiButton>
      <UiButton
        variant="tertiary"
        :disabled="pending"
        data-testid="target-cancel"
        @click="requestClose"
      >
        Отмена
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.target-dialog {
  display: grid;
  gap: var(--hf-space-3);
  min-width: 0;
}

.target-dialog__name {
  font-weight: var(--hf-font-weight-semibold);
  overflow-wrap: anywhere;
}

.target-dialog__muted {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.target-dialog__field {
  display: grid;
  gap: var(--hf-space-1);
  font-size: var(--hf-font-size-small);
}

.target-dialog__input {
  min-width: 0;
  min-height: 44px;
  padding: 0 var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
  font-variant-numeric: tabular-nums;
}

.target-dialog__input:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.target-dialog__input[aria-invalid='true'] {
  border-color: var(--hf-color-border-danger);
}

.target-dialog__error,
.target-dialog__warning {
  display: flex;
  align-items: center;
  gap: var(--hf-space-1);
  margin: 0;
  font-size: var(--hf-font-size-small);
}

.target-dialog__error {
  color: var(--hf-color-text-danger);
}

.target-dialog__warning {
  padding: var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text);
}
</style>
