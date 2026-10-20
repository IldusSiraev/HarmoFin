<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { AlertTriangle } from '@lucide/vue';

import { formatMinorUnits } from '../finance/money-format.js';
import { formatPlainDateShort } from './format-plain-date.js';
import UiButton from '../ui/Button.vue';
import UiDatePicker from '../ui/DatePicker.vue';
import UiModal from '../ui/Modal.vue';
import UiPillSelect from '../ui/PillSelect.vue';

defineOptions({ name: 'IncomeRecordSheet' });

// Presentational: the parent owns the server call. The sheet turns typed text
// into a decimal string and keeps one Idempotency-Key per unchanged attempt.
// BigInt is used only to reject a zero amount; no total or balance is derived.

export interface IncomeRecordOccurrence {
  id: string;
  name: string;
  scheduledOn: string;
  expectedMinor: string;
  categoryId: string | null;
}

export interface IncomeRecordSubmit {
  amount: string;
  accountId: string;
  categoryId: string;
  occurredOn: string;
  idempotencyKey: string;
}

type FieldName = 'amount' | 'accountId' | 'occurredOn' | 'categoryId';

const props = withDefaults(
  defineProps<{
    open: boolean;
    occurrence: IncomeRecordOccurrence;
    categoryName: string;
    accounts: ReadonlyArray<{ value: string; label: string }>;
    today: string;
    pending: boolean;
    error: string | null;
    fieldErrors?: Partial<Record<FieldName, string>>;
    currency?: string;
    scale?: number;
  }>(),
  { fieldErrors: () => ({}), currency: 'RUB', scale: 2 },
);

const emit = defineEmits<{ submit: [payload: IncomeRecordSubmit]; close: [] }>();

const AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;

// Minor-units string -> decimal text ("8700000" -> "87000.00").
function toDecimalText(minor: string): string {
  if (!/^\d+$/.test(minor)) return '';
  const padded = minor.padStart(props.scale + 1, '0');
  const cut = padded.length - props.scale;
  const whole = padded.slice(0, cut).replace(/^0+(?=\d)/, '');
  return props.scale === 0 ? whole : `${whole}.${padded.slice(cut)}`;
}

function normalize(text: string): string | null {
  const value = text.trim().replace(',', '.');
  if (!AMOUNT_PATTERN.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

function isPositive(decimal: string): boolean {
  return BigInt(decimal.replace('.', '')) > 0n;
}

const amount = ref('');
const accountId = ref('');
const occurredOn = ref(props.today);
const localErrors = ref<Partial<Record<FieldName, string>>>({});
const locked = ref(false);
let key = '';

function reset(): void {
  amount.value = toDecimalText(props.occurrence.expectedMinor);
  accountId.value = '';
  occurredOn.value = props.today;
  localErrors.value = {};
  locked.value = false;
  key = '';
}

watch(() => [props.open, props.occurrence.id] as const, reset, { immediate: true });

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    void nextTick(() => {
      setTimeout(() => document.getElementById('income-record-amount')?.focus(), 0);
    });
  },
  { immediate: true, flush: 'post' },
);

// Any edit makes this a different attempt: the next submit gets a new key.
watch([amount, accountId, occurredOn], () => {
  key = '';
});

watch(
  () => props.pending,
  (pending) => {
    if (!pending) locked.value = false;
  },
);

const normalizedAmount = computed(() => normalize(amount.value));

const currencySymbol = computed(() => {
  try {
    const parts = new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: props.currency,
    }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? props.currency;
  } catch {
    return props.currency;
  }
});

function money(minor: string): string {
  try {
    return formatMinorUnits(minor, props.currency, props.scale);
  } catch {
    return minor;
  }
}

function fieldError(field: FieldName): string | undefined {
  return localErrors.value[field] ?? props.fieldErrors[field];
}

function handleSubmit(): void {
  if (props.pending || locked.value) return;
  const errors: Partial<Record<FieldName, string>> = {};
  const value = normalizedAmount.value;
  if (value === null || !isPositive(value)) errors.amount = 'Введите сумму больше нуля';
  if (accountId.value === '') errors.accountId = 'Выберите счёт';
  if (props.occurrence.categoryId === null) {
    errors.categoryId = 'У плана нет категории. Укажите её в плане и повторите.';
  }
  if (occurredOn.value === '') errors.occurredOn = 'Укажите дату';
  localErrors.value = errors;
  if (Object.keys(errors).length > 0 || value === null || props.occurrence.categoryId === null) {
    return;
  }
  key ||= crypto.randomUUID();
  locked.value = true;
  emit('submit', {
    amount: value,
    accountId: accountId.value,
    categoryId: props.occurrence.categoryId,
    occurredOn: occurredOn.value,
    idempotencyKey: key,
  });
}
</script>

<template>
  <UiModal :open="open" title="Записать доход" @close="emit('close')">
    <form id="income-record-form" class="income-sheet" novalidate @submit.prevent="handleSubmit">
      <section class="income-sheet__head" aria-label="План дохода">
        <p class="income-sheet__name">{{ occurrence.name }}</p>
        <p class="income-sheet__muted">
          Ожидалось
          <strong data-testid="income-expected">{{ money(occurrence.expectedMinor) }}</strong>
          на {{ formatPlainDateShort(occurrence.scheduledOn) }}
        </p>
      </section>

      <div class="income-sheet__amount">
        <label class="income-sheet__label" for="income-record-amount">Фактическая сумма</label>
        <div class="income-sheet__amount-row">
          <input
            id="income-record-amount"
            v-model="amount"
            class="income-sheet__amount-input"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            name="amount"
            data-testid="income-amount"
            :aria-invalid="fieldError('amount') ? 'true' : undefined"
            :aria-describedby="fieldError('amount') ? 'income-record-amount-error' : undefined"
          />
          <span class="income-sheet__currency" aria-hidden="true">{{ currencySymbol }}</span>
        </div>
        <p
          v-if="fieldError('amount')"
          id="income-record-amount-error"
          class="income-sheet__field-error"
          role="alert"
        >
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ fieldError('amount') }}
        </p>
      </div>

      <UiPillSelect
        v-model="accountId"
        name="accountId"
        label="Счёт зачисления"
        :options="accounts"
        :error="fieldError('accountId')"
        required
      />

      <UiDatePicker
        v-model="occurredOn"
        name="occurredOn"
        label="Дата"
        :error="fieldError('occurredOn')"
        required
        quick-dates
      />

      <dl class="income-sheet__readonly">
        <div>
          <dt>Категория</dt>
          <dd data-testid="income-category">{{ categoryName }}</dd>
        </div>
      </dl>
      <p v-if="fieldError('categoryId')" class="income-sheet__field-error" role="alert">
        <AlertTriangle :size="14" aria-hidden="true" />
        {{ fieldError('categoryId') }}
      </p>

      <p v-if="error" class="income-sheet__notice" role="alert" data-testid="income-error">
        <AlertTriangle :size="18" aria-hidden="true" />
        <span>{{ error }}</span>
      </p>
    </form>

    <template #footer>
      <div class="income-sheet__footer">
        <UiButton
          variant="secondary"
          :disabled="pending"
          data-testid="income-cancel"
          @click="emit('close')"
        >
          Отмена
        </UiButton>
        <UiButton
          variant="primary"
          :loading="pending"
          :disabled="pending"
          data-testid="income-submit"
          @click="handleSubmit"
        >
          Записать доход
        </UiButton>
      </div>
    </template>
  </UiModal>
</template>

<style scoped>
.income-sheet {
  display: grid;
  gap: var(--hf-space-4);
  min-width: 0;
}

.income-sheet__name {
  margin: 0;
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-body);
  font-weight: var(--hf-font-weight-semibold);
  overflow-wrap: anywhere;
}

.income-sheet__muted {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.income-sheet__amount {
  display: grid;
  justify-items: center;
  gap: var(--hf-space-2);
}

.income-sheet__label {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
}

.income-sheet__amount-row {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  max-width: 100%;
  padding-bottom: var(--hf-space-2);
  border-bottom: 2px solid var(--hf-color-status-success);
}

.income-sheet__amount-input {
  width: 9ch;
  max-width: 100%;
  min-height: 44px;
  border: none;
  background: transparent;
  color: var(--hf-color-status-success);
  font: inherit;
  font-size: clamp(2rem, 6vw, 2.75rem);
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.income-sheet__amount-input:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.income-sheet__currency {
  color: var(--hf-color-status-success);
  font-size: clamp(1.5rem, 4vw, 2rem);
}

.income-sheet__readonly {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
}

.income-sheet__readonly div {
  display: flex;
  justify-content: space-between;
  gap: var(--hf-space-3);
}

.income-sheet__readonly dt {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.income-sheet__readonly dd {
  margin: 0;
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
  text-align: right;
}

.income-sheet__field-error {
  display: flex;
  align-items: center;
  gap: var(--hf-space-1);
  margin: 0;
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-small);
}

.income-sheet__notice {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  margin: 0;
  padding: var(--hf-space-3);
  border: 1px solid var(--hf-color-border-danger);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text);
}

.income-sheet__footer {
  display: flex;
  flex: 1 1 100%;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--hf-space-2);
}
</style>
