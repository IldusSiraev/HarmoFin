<script setup lang="ts">
import { computed, ref } from 'vue';
import { Info } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import FinanceMoneyInput from '../finance/FinanceMoneyInput.vue';
import UiButton from '../ui/Button.vue';
import UiModal from '../ui/Modal.vue';
import UiSelect from '../ui/Select.vue';
import type {
  CreateEnvelopeReallocationInput,
  DashboardSummaryDto,
} from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'PeriodLeftoverPrompt' });

type Leftover = DashboardSummaryDto['previousPeriodLeftover'];

const props = defineProps<{
  leftover: Leftover;
  budgetId: string;
  envelopes: ReadonlyArray<{ id: string; name: string }>;
  createReallocation: (
    budgetId: string,
    input: CreateEnvelopeReallocationInput,
    idempotencyKey: string,
  ) => Promise<unknown>;
}>();

const emit = defineEmits<{ reallocated: [] }>();

const pickerOpen = ref(false);
const pickerDestinationId = ref('');
const pickerAmount = ref('');
const pending = ref(false);
const error = ref('');

const destinationOptions = computed(() =>
  props.envelopes
    .filter((envelope) => envelope.id !== props.leftover?.envelopeId)
    .map((envelope) => ({ value: envelope.id, label: envelope.name })),
);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDecimal(value: string): string {
  return value.replaceAll(/(?:\s|\xA0)/g, '').replace(',', '.');
}

function minorToDecimal(value: string): string {
  const parsed = BigInt(value);
  const sign = parsed < 0n ? '-' : '';
  const digits = (parsed < 0n ? -parsed : parsed).toString().padStart(3, '0');
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

async function moveAll() {
  if (!props.leftover) return;
  pending.value = true;
  error.value = '';
  try {
    await props.createReallocation(
      props.budgetId,
      {
        sourceEnvelopeId: props.leftover.envelopeId,
        destinationEnvelopeId: props.leftover.currentPeriodEnvelopeId,
        amount: minorToDecimal(props.leftover.balanceMinor),
        occurredOn: today(),
      },
      crypto.randomUUID(),
    );
    emit('reallocated');
  } catch {
    error.value = 'Не удалось перенести остаток. Повторите попытку.';
  } finally {
    pending.value = false;
  }
}

function openPicker() {
  if (!props.leftover) return;
  pickerDestinationId.value = '';
  pickerAmount.value = minorToDecimal(props.leftover.balanceMinor);
  error.value = '';
  pickerOpen.value = true;
}

function closePicker() {
  pickerOpen.value = false;
}

async function submitPicker() {
  if (!props.leftover || !pickerDestinationId.value) return;
  pending.value = true;
  error.value = '';
  try {
    await props.createReallocation(
      props.budgetId,
      {
        sourceEnvelopeId: props.leftover.envelopeId,
        destinationEnvelopeId: pickerDestinationId.value,
        amount: normalizeDecimal(pickerAmount.value),
        occurredOn: today(),
      },
      crypto.randomUUID(),
    );
    pickerOpen.value = false;
    emit('reallocated');
  } catch {
    error.value = 'Не удалось распределить остаток. Повторите попытку.';
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <section
    v-if="leftover"
    class="period-leftover-prompt"
    data-testid="period-leftover-prompt"
    aria-labelledby="period-leftover-prompt-title"
  >
    <Info class="period-leftover-prompt__icon" :size="20" aria-hidden="true" />
    <div class="period-leftover-prompt__body">
      <p id="period-leftover-prompt-title" class="period-leftover-prompt__text">
        У вас остались средства в конверте «{{ leftover.envelopeName }}» —
        <FinanceMoney :minor-units="leftover.balanceMinor" currency="RUB" :scale="2" />. Перенести
        их в «{{ leftover.currentPeriodEnvelopeName }}» или распределить в другой конверт?
      </p>
      <p v-if="error" role="alert" class="period-leftover-prompt__error">{{ error }}</p>
      <div class="period-leftover-prompt__actions">
        <UiButton data-action="move-all" :disabled="pending" @click="moveAll">
          Перенести остаток
        </UiButton>
        <UiButton
          data-action="open-picker"
          variant="tertiary"
          :disabled="pending"
          @click="openPicker"
        >
          Распределить в другой конверт
        </UiButton>
      </div>
    </div>

    <UiModal :open="pickerOpen" title="Распределить остаток" @close="closePicker">
      <FinanceMoneyInput v-model="pickerAmount" name="amount" label="Сумма" />
      <UiSelect
        v-model="pickerDestinationId"
        name="destinationEnvelopeId"
        label="Конверт назначения"
        placeholder="Выберите конверт"
        :options="destinationOptions"
      />
      <template #footer>
        <UiButton variant="tertiary" :disabled="pending" @click="closePicker">Отмена</UiButton>
        <UiButton
          data-action="submit-picker"
          :disabled="pending || !pickerDestinationId"
          @click="submitPicker"
        >
          Распределить
        </UiButton>
      </template>
    </UiModal>
  </section>
</template>

<style scoped>
.period-leftover-prompt {
  display: flex;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

.period-leftover-prompt__icon {
  flex-shrink: 0;
  color: var(--hf-color-status-info);
}

.period-leftover-prompt__body {
  display: grid;
  flex: 1;
  gap: var(--hf-space-3);
}

.period-leftover-prompt__text {
  margin: 0;
}

.period-leftover-prompt__error {
  margin: 0;
  color: var(--hf-color-text-danger);
}

.period-leftover-prompt__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}
</style>
