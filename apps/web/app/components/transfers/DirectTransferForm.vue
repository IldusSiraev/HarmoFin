<script setup lang="ts">
import { reactive, ref, watch } from 'vue';

import {
  toDirectTransferInput,
  type TransferFormModel,
} from '../../composables/useTransferForm.js';
import type { CreateDirectTransferRequest } from '../../composables/useEnvelopePlanV2.js';
import FinanceMoneyInput from '../finance/FinanceMoneyInput.vue';
import UiButton from '../ui/Button.vue';
import UiDatePicker from '../ui/DatePicker.vue';
import UiInput from '../ui/Input.vue';
import UiSelect from '../ui/Select.vue';

// Envelope Plan v2.2 transfer: account to account only. No envelopes, parts or
// draft status — the money simply moves between two accounts.
defineOptions({ name: 'DirectTransferForm' });

const props = withDefaults(
  defineProps<{
    model: TransferFormModel;
    accounts: ReadonlyArray<{ value: string; label: string }>;
    errors?: Partial<Record<string, string>>;
    pending?: boolean;
    submitLabel?: string;
  }>(),
  { errors: () => ({}), pending: false, submitLabel: 'Сохранить перевод' },
);

const emit = defineEmits<{ submit: [input: CreateDirectTransferRequest] }>();
const form = reactive<TransferFormModel>({ ...props.model });

watch(
  () => props.model,
  (model) => Object.assign(form, model),
  { deep: true },
);

// The custom UiSelect has no native `required` blocking, so an unchosen
// account is caught here before the request; the server still validates.
type AccountField = 'sourceAccountId' | 'destinationAccountId';
const accountRequiredMessages: Record<AccountField, string> = {
  sourceAccountId: 'Выберите счёт списания',
  destinationAccountId: 'Выберите счёт зачисления',
};
const localErrors = ref<Partial<Record<AccountField, string>>>({});

watch(
  () => [form.sourceAccountId, form.destinationAccountId],
  () => {
    const next = { ...localErrors.value };
    if (form.sourceAccountId) delete next.sourceAccountId;
    if (form.destinationAccountId) delete next.destinationAccountId;
    localErrors.value = next;
  },
);

function fieldError(field: AccountField): string | undefined {
  return localErrors.value[field] ?? props.errors[field];
}

function submit(): void {
  if (props.pending) return;
  const missing: Partial<Record<AccountField, string>> = {};
  for (const field of ['sourceAccountId', 'destinationAccountId'] as const) {
    if (!form[field]) missing[field] = accountRequiredMessages[field];
  }
  localErrors.value = missing;
  if (Object.keys(missing).length > 0) return;
  emit('submit', toDirectTransferInput(form));
}
</script>

<template>
  <form class="direct-transfer-form" data-testid="direct-transfer-form" @submit.prevent="submit">
    <UiDatePicker
      v-model="form.occurredOn"
      name="occurredOn"
      label="Дата перевода"
      :error="errors.occurredOn"
      required
      quick-dates
    />
    <FinanceMoneyInput
      v-model="form.total"
      name="total"
      label="Сумма"
      :error="errors.amount ?? errors.total"
      required
    />
    <UiSelect
      v-model="form.sourceAccountId"
      name="sourceAccountId"
      label="Счёт списания"
      :options="accounts"
      :error="fieldError('sourceAccountId')"
      required
    />
    <UiSelect
      v-model="form.destinationAccountId"
      name="destinationAccountId"
      label="Счёт зачисления"
      :options="accounts"
      :error="fieldError('destinationAccountId')"
      required
    />
    <UiInput
      v-model="form.comment"
      name="comment"
      label="Комментарий"
      :error="errors.comment"
      :maxlength="500"
    />
    <UiButton type="submit" full-width :loading="pending" :disabled="pending"
      >{{ submitLabel }}</UiButton
    >
  </form>
</template>

<style scoped>
.direct-transfer-form {
  display: grid;
  gap: var(--hf-space-4);
}
</style>
