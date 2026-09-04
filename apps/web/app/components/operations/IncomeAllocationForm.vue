<script setup lang="ts">
import { computed, ref } from 'vue';

import type { AllocationProposal } from '../../composables/useBudgetReferenceData.js';
import FinanceMoneyInput from '../finance/FinanceMoneyInput.vue';
import UiButton from '../ui/Button.vue';
import UiSelect from '../ui/Select.vue';

defineOptions({ name: 'IncomeAllocationForm' });

const props = withDefaults(
  defineProps<{
    proposal: AllocationProposal | null;
    remainingMinor: string;
    accounts: ReadonlyArray<{ value: string; label: string }>;
    envelopes: ReadonlyArray<{ value: string; label: string }>;
    pending?: boolean;
    errors?: Partial<Record<'amount' | 'accountId' | 'envelopeId', string>>;
  }>(),
  { pending: false, errors: () => ({}) },
);

const emit = defineEmits<{
  submit: [input: { amount: string; occurredOn: string; accountId: string; envelopeId: string }];
  reject: [];
}>();
const editing = ref(false);
const amount = ref(props.proposal ? minorToDecimal(props.proposal.amountMinor) : '');
const accountId = ref(props.accounts[0]?.value ?? '');
const envelopeId = ref(props.proposal?.targetEnvelopeId ?? '');
const occurredOn = ref(new Date().toISOString().slice(0, 10));
const actionLabel = computed(() =>
  editing.value ? 'Сохранить распределение' : 'Применить предложение',
);

function apply() {
  emit('submit', {
    amount: amount.value,
    occurredOn: occurredOn.value,
    accountId: accountId.value,
    envelopeId: envelopeId.value,
  });
}

function minorToDecimal(value: string): string {
  const parsed = BigInt(value);
  const sign = parsed < 0n ? '-' : '';
  const digits = (parsed < 0n ? -parsed : parsed).toString().padStart(3, '0');
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
</script>

<template>
  <section class="allocation-form" aria-label="Распределение дохода">
    <p class="allocation-form__lead">
      Предложить распределение: доступно {{ remainingMinor }} минимальных единиц.
    </p>
    <div v-if="proposal && !editing" class="allocation-form__actions">
      <UiButton
        data-action="apply-proposal"
        :disabled="pending"
        :loading="pending"
        @click="apply"
        >{{ actionLabel }}</UiButton
      >
      <UiButton variant="secondary" :disabled="pending" @click="editing = true">Изменить</UiButton>
      <UiButton variant="tertiary" :disabled="pending" @click="emit('reject')"
        >Не распределять</UiButton
      >
    </div>
    <form v-else class="allocation-form__fields" @submit.prevent="apply">
      <FinanceMoneyInput
        v-model="amount"
        name="allocation-amount"
        label="Сумма распределения"
        :error="errors.amount"
        required
      />
      <UiSelect
        v-model="accountId"
        name="allocation-account"
        label="Счёт хранения"
        :options="accounts"
        :error="errors.accountId"
        required
      />
      <UiSelect
        v-model="envelopeId"
        name="allocation-envelope"
        label="Конверт"
        :options="envelopes"
        :error="errors.envelopeId"
        required
      />
      <UiButton data-action="apply-proposal" type="submit" :disabled="pending" :loading="pending">{{
        actionLabel
      }}</UiButton>
    </form>
  </section>
</template>

<style scoped>
.allocation-form {
  display: grid;
  gap: var(--hf-space-4);
  padding: var(--hf-space-4);
  border-left: 3px solid var(--hf-color-action-primary);
  background: var(--hf-color-surface-subtle);
}
.allocation-form__lead {
  margin: 0;
  color: var(--hf-color-text-muted);
}
.allocation-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
}
.allocation-form__fields {
  display: grid;
  gap: var(--hf-space-4);
}
</style>
