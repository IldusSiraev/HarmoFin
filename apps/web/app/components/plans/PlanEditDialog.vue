<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';

import type { UpdatePlanRequest } from '../../composables/useEnvelopePlanV2.js';
import { formatPlainDateShort } from '../obligations/format-plain-date.js';
import OperationAmountField from '../operations/OperationAmountField.vue';
import UiButton from '../ui/Button.vue';
import UiConfirmDialog from '../ui/ConfirmDialog.vue';
import UiInput from '../ui/Input.vue';
import UiModal from '../ui/Modal.vue';
import {
  buildUpdatePlanRequest,
  createPlanEditModel,
  hasPlanEditChanges,
  isAmountChanged,
  recurrenceLabel,
  validatePlanEdit,
  type PlanCatalogEntry,
  type PlanEditErrors,
  type PlanEditModel,
} from './plan-edit.js';

defineOptions({ name: 'PlanEditDialog' });

// Presentational: the page owns the request, the Idempotency-Key and the
// status. The dialog validates by pattern and builds the PATCH body; the
// amount stays text and is never computed on.

const props = withDefaults(
  defineProps<{
    open: boolean;
    entry: PlanCatalogEntry | null;
    pending?: boolean;
    error?: string | null;
    fieldErrors?: PlanEditErrors;
  }>(),
  { pending: false, error: null, fieldErrors: () => ({}) },
);

const emit = defineEmits<{
  close: [];
  save: [request: UpdatePlanRequest];
  stop: [];
}>();

const EMPTY_MODEL: PlanEditModel = { name: '', amount: '', applyToCurrentOpen: false };

const model = reactive<PlanEditModel>({ ...EMPTY_MODEL });
const localErrors = ref<PlanEditErrors>({});
const stopConfirmOpen = ref(false);

watch(
  () => [props.open, props.entry?.id] as const,
  () => {
    if (!props.open || !props.entry) return;
    Object.assign(model, createPlanEditModel(props.entry));
    localErrors.value = {};
    stopConfirmOpen.value = false;
  },
  { immediate: true },
);

watch(model, () => {
  localErrors.value = {};
});

const isObligation = computed(() => props.entry?.kind !== 'income');
const accent = computed<'danger' | 'success'>(() => (isObligation.value ? 'danger' : 'success'));
const changed = computed(() => (props.entry ? hasPlanEditChanges(model, props.entry) : false));
const amountChanged = computed(() => (props.entry ? isAmountChanged(model, props.entry) : false));
const applyLabel = computed(() =>
  isObligation.value
    ? 'Применить к текущим открытым платежам, включая просроченные'
    : 'Применить к текущим ожидаемым поступлениям',
);
const stopDescription = computed(() =>
  isObligation.value
    ? 'Будущие неоплаченные платежи будут отменены. Текущие и просроченные останутся: оплатите или пропустите их.'
    : 'Будущие ожидаемые поступления будут отменены. Текущие останутся: запишите их или оставьте как есть.',
);

function errorFor(field: 'name' | 'amount'): string | undefined {
  return localErrors.value[field] ?? props.fieldErrors[field];
}

function submit(): void {
  if (!props.entry || !changed.value || props.pending) return;
  const errors = validatePlanEdit(model);
  localErrors.value = errors;
  if (Object.keys(errors).length > 0) {
    const targetId = errors.amount ? 'operation-amount-input' : 'planEditName-input';
    void nextTick(() => document.getElementById(targetId)?.focus());
    return;
  }
  emit('save', buildUpdatePlanRequest(model, props.entry));
}

function confirmStop(): void {
  stopConfirmOpen.value = false;
  emit('stop');
}
</script>

<template>
  <UiModal :open="open && entry !== null" title="Изменить план" @close="emit('close')">
    <p v-if="error" class="plan-edit__error" role="alert">{{ error }}</p>

    <form v-if="entry" class="plan-edit__body" novalidate @submit.prevent="submit">
      <OperationAmountField
        v-model="model.amount"
        :accent="accent"
        :error="errorFor('amount')"
        hide-stepper
      />

      <UiInput
        v-model="model.name"
        name="planEditName"
        label="Название"
        autocomplete="off"
        required
        :error="errorFor('name')"
      />

      <p class="plan-edit__readonly" data-testid="plan-edit-readonly">
        Начало: {{ formatPlainDateShort(entry.scheduledOn) }} · Повторение:
        {{ recurrenceLabel(entry.recurrence, entry.intervalMonths) }}. Чтобы изменить их, остановите
        план и создайте новый.
      </p>

      <label v-if="amountChanged" class="plan-edit__apply">
        <input
          v-model="model.applyToCurrentOpen"
          type="checkbox"
          data-testid="plan-edit-apply-current"
          aria-describedby="plan-edit-apply-hint"
        />
        <span>{{ applyLabel }}</span>
      </label>
      <p v-if="amountChanged" id="plan-edit-apply-hint" class="plan-edit__hint">
        Будущие платежи изменятся в любом случае. Текущие и просроченные изменятся только с этой
        галкой.
      </p>

      <UiButton
        type="submit"
        class="plan-edit__submit"
        full-width
        data-testid="plan-edit-submit"
        :disabled="!changed || pending"
        :loading="pending"
      >
        Сохранить
      </UiButton>

      <UiButton
        v-if="entry.active"
        type="button"
        variant="tertiary"
        class="plan-edit__stop"
        full-width
        data-testid="plan-edit-stop"
        :disabled="pending"
        @click="stopConfirmOpen = true"
      >
        Остановить план
      </UiButton>
    </form>

    <UiConfirmDialog
      :open="stopConfirmOpen"
      :title="`Остановить план «${entry?.name ?? ''}»?`"
      :description="stopDescription"
      confirm-label="Остановить"
      cancel-label="Отмена"
      variant="danger"
      :loading="pending"
      @confirm="confirmStop"
      @cancel="stopConfirmOpen = false"
    />
  </UiModal>
</template>

<style scoped>
.plan-edit__body {
  display: grid;
  gap: var(--hf-space-5);
}
.plan-edit__readonly,
.plan-edit__hint {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
.plan-edit__apply {
  display: flex;
  align-items: flex-start;
  gap: var(--hf-space-2);
  min-height: 2.75rem;
}
.plan-edit__error {
  margin: 0 0 var(--hf-space-4);
  color: var(--hf-color-text-danger);
}
.plan-edit__submit,
.plan-edit__stop {
  min-height: 2.75rem;
}
</style>
