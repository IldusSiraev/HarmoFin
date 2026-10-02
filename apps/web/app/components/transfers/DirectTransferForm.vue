<script setup lang="ts">
import { reactive, watch } from 'vue';

import {
  toDirectTransferInput,
  type TransferFormModel,
} from '../../composables/useTransferForm.js';
import type { CreateDirectTransferRequest } from '../../composables/useEnvelopePlanV2.js';
import FinanceMoneyInput from '../finance/FinanceMoneyInput.vue';
import UiButton from '../ui/Button.vue';
import UiDatePicker from '../ui/DatePicker.vue';
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
  }>(),
  { errors: () => ({}), pending: false },
);

const emit = defineEmits<{ submit: [input: CreateDirectTransferRequest] }>();
const form = reactive<TransferFormModel>({ ...props.model, parts: [] });

watch(
  () => props.model,
  (model) => Object.assign(form, { ...model, parts: [] }),
  { deep: true },
);

function submit(): void {
  if (props.pending) return;
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
      :error="errors.sourceAccountId"
      required
    />
    <UiSelect
      v-model="form.destinationAccountId"
      name="destinationAccountId"
      label="Счёт зачисления"
      :options="accounts"
      :error="errors.destinationAccountId"
      required
    />
    <UiButton type="submit" full-width :loading="pending" :disabled="pending"
      >Сохранить перевод</UiButton
    >
  </form>
</template>

<style scoped>
.direct-transfer-form {
  display: grid;
  gap: var(--hf-space-4);
}
</style>
