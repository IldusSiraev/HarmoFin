<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { AlertTriangle } from '@lucide/vue';

import { formatMinorUnits } from '../finance/money-format.js';
import { formatPlainDateShort } from './format-plain-date.js';
import UiButton from '../ui/Button.vue';
import UiDatePicker from '../ui/DatePicker.vue';
import UiModal from '../ui/Modal.vue';
import UiPillSelect from '../ui/PillSelect.vue';

defineOptions({ name: 'ObligationPaySheet' });

// Presentational: the parent owns the server call and every resulting
// status/remainder. The sheet turns typed text into a decimal string and keeps
// one Idempotency-Key per unchanged attempt. BigInt is used only to decide
// whether the "Будет доплата" switch is shown (typed < expected); no total,
// balance or remainder is ever derived here.

export interface ObligationPayOccurrence {
  id: string;
  name: string;
  scheduledOn: string;
  expectedMinor: string;
  categoryId: string | null;
}

export interface ObligationPaySubmit {
  amount: string;
  willPayMore: boolean;
  accountId: string;
  categoryId: string;
  occurredOn: string;
  idempotencyKey: string;
}

type FieldName = 'amount' | 'accountId' | 'occurredOn' | 'categoryId';

const props = withDefaults(
  defineProps<{
    open: boolean;
    occurrence: ObligationPayOccurrence;
    categoryName: string;
    accounts: ReadonlyArray<{ value: string; label: string }>;
    /** Default operation date (same source as the quick entry dialog). */
    today: string;
    pending: boolean;
    error: string | null;
    fieldErrors?: Partial<Record<FieldName, string>>;
    currency?: string;
    scale?: number;
  }>(),
  { fieldErrors: () => ({}), currency: 'RUB', scale: 2 },
);

const emit = defineEmits<{ submit: [payload: ObligationPaySubmit]; close: [] }>();

const AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;

// Minor-units string -> decimal text ("300000" -> "3000.00").
function toDecimalText(minor: string): string {
  if (!/^\d+$/.test(minor)) return '';
  const padded = minor.padStart(props.scale + 1, '0');
  const cut = padded.length - props.scale;
  const whole = padded.slice(0, cut).replace(/^0+(?=\d)/, '');
  return props.scale === 0 ? whole : `${whole}.${padded.slice(cut)}`;
}

// Typed text -> normalized decimal string, or null when it is not an amount.
function normalize(text: string): string | null {
  const value = text.trim().replace(',', '.');
  if (!AMOUNT_PATTERN.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

function toMinor(decimal: string): bigint {
  const [whole = '0', fraction = ''] = decimal.split('.');
  return BigInt(whole + fraction.padEnd(props.scale, '0').slice(0, props.scale));
}

const amount = ref('');
const accountId = ref('');
const occurredOn = ref(props.today);
const willPayMore = ref(false);
const localErrors = ref<Partial<Record<FieldName, string>>>({});
const locked = ref(false);
let key = '';

function reset(): void {
  amount.value = toDecimalText(props.occurrence.expectedMinor);
  accountId.value = '';
  occurredOn.value = props.today;
  willPayMore.value = false;
  localErrors.value = {};
  locked.value = false;
  key = '';
}

watch(() => [props.open, props.occurrence.id] as const, reset, { immediate: true });

// The dialog focuses itself on open; the amount is the field the user
// edits next, so move focus there once the dialog settled.
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    void nextTick(() => {
      setTimeout(() => document.getElementById('obligation-pay-amount')?.focus(), 0);
    });
  },
  { immediate: true, flush: 'post' },
);

// Any edit makes this a different attempt: the next submit gets a new key.
watch([amount, accountId, occurredOn, willPayMore], () => {
  key = '';
});

// A finished request (success or failure) re-enables the button; a retry of an
// unchanged form reuses the key.
watch(
  () => props.pending,
  (pending) => {
    if (!pending) locked.value = false;
  },
);

const normalizedAmount = computed(() => normalize(amount.value));
const canPayMore = computed(() => {
  const value = normalizedAmount.value;
  if (value === null || !/^\d+$/.test(props.occurrence.expectedMinor)) return false;
  const typed = toMinor(value);
  return typed > 0n && typed < BigInt(props.occurrence.expectedMinor);
});

watch(canPayMore, (visible) => {
  if (!visible) willPayMore.value = false;
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
  if (value === null || toMinor(value) <= 0n) errors.amount = 'Введите сумму больше нуля';
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
    willPayMore: canPayMore.value && willPayMore.value,
    accountId: accountId.value,
    categoryId: props.occurrence.categoryId,
    occurredOn: occurredOn.value,
    idempotencyKey: key,
  });
}
</script>

<template>
  <UiModal :open="open" title="Оплатить платёж" @close="emit('close')">
    <form id="obligation-pay-form" class="pay-sheet" novalidate @submit.prevent="handleSubmit">
      <section class="pay-sheet__head" aria-label="План">
        <p class="pay-sheet__name">{{ occurrence.name }}</p>
        <p class="pay-sheet__muted">
          Ожидалось
          <strong data-testid="pay-expected">{{ money(occurrence.expectedMinor) }}</strong>
          на {{ formatPlainDateShort(occurrence.scheduledOn) }}
        </p>
      </section>

      <div class="pay-sheet__amount">
        <label class="pay-sheet__label" for="obligation-pay-amount">Фактическая сумма</label>
        <div class="pay-sheet__amount-row">
          <input
            id="obligation-pay-amount"
            v-model="amount"
            class="pay-sheet__amount-input"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            name="amount"
            data-testid="pay-amount"
            :aria-invalid="fieldError('amount') ? 'true' : undefined"
            :aria-describedby="fieldError('amount') ? 'obligation-pay-amount-error' : undefined"
          />
          <span class="pay-sheet__currency" aria-hidden="true">₽</span>
        </div>
        <p
          v-if="fieldError('amount')"
          id="obligation-pay-amount-error"
          class="pay-sheet__field-error"
          role="alert"
        >
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ fieldError('amount') }}
        </p>
      </div>

      <label v-if="canPayMore" class="pay-sheet__switch">
        <input
          v-model="willPayMore"
          type="checkbox"
          class="pay-sheet__check"
          data-testid="pay-will-pay-more"
        />
        <span>
          <span class="pay-sheet__switch-title">Будет доплата</span>
          <span class="pay-sheet__muted">
            Платёж останется открытым. Доплату вы внесёте отдельной оплатой.
          </span>
        </span>
      </label>

      <UiPillSelect
        v-model="accountId"
        name="accountId"
        label="Счёт списания"
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

      <dl class="pay-sheet__readonly">
        <div>
          <dt>Категория</dt>
          <dd data-testid="pay-category">{{ categoryName }}</dd>
        </div>
        <div>
          <dt>Конверт</dt>
          <dd>Обязательные</dd>
        </div>
      </dl>
      <p v-if="fieldError('categoryId')" class="pay-sheet__field-error" role="alert">
        <AlertTriangle :size="14" aria-hidden="true" />
        {{ fieldError('categoryId') }}
      </p>

      <p v-if="error" class="pay-sheet__notice" role="alert" data-testid="pay-error">
        <AlertTriangle :size="18" aria-hidden="true" />
        <span>{{ error }}</span>
      </p>
    </form>

    <template #footer>
      <div class="pay-sheet__footer">
        <UiButton
          variant="secondary"
          :disabled="pending"
          data-testid="pay-cancel"
          @click="emit('close')"
        >
          Отмена
        </UiButton>
        <UiButton
          variant="primary"
          :loading="pending"
          :disabled="pending"
          data-testid="pay-submit"
          @click="handleSubmit"
        >
          Оплатить
        </UiButton>
      </div>
    </template>
  </UiModal>
</template>

<style scoped>
.pay-sheet {
  display: grid;
  gap: var(--hf-space-4);
  min-width: 0;
}

.pay-sheet__name {
  margin: 0;
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-body);
  font-weight: var(--hf-font-weight-semibold);
  overflow-wrap: anywhere;
}

.pay-sheet__muted {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.pay-sheet__amount {
  display: grid;
  justify-items: center;
  gap: var(--hf-space-2);
}

.pay-sheet__label {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
}

.pay-sheet__amount-row {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  max-width: 100%;
  padding-bottom: var(--hf-space-2);
  border-bottom: 2px solid var(--hf-color-status-danger);
}

.pay-sheet__amount-input {
  width: 9ch;
  max-width: 100%;
  min-height: 44px;
  border: none;
  background: transparent;
  color: var(--hf-color-status-danger);
  font: inherit;
  font-size: clamp(2rem, 6vw, 2.75rem);
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.pay-sheet__amount-input:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.pay-sheet__currency {
  color: var(--hf-color-status-danger);
  font-size: clamp(1.5rem, 4vw, 2rem);
}

.pay-sheet__switch {
  display: flex;
  align-items: flex-start;
  gap: var(--hf-space-3);
  min-height: 44px;
  padding: var(--hf-space-3) var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  cursor: pointer;
}

.pay-sheet__switch > span {
  display: grid;
}

.pay-sheet__switch-title {
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-semibold);
}

.pay-sheet__check {
  flex: none;
  width: 1.5rem;
  height: 1.5rem;
  accent-color: var(--hf-color-action-primary);
}

.pay-sheet__check:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.pay-sheet__readonly {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
}

.pay-sheet__readonly div {
  display: flex;
  justify-content: space-between;
  gap: var(--hf-space-3);
}

.pay-sheet__readonly dt {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.pay-sheet__readonly dd {
  margin: 0;
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
  text-align: right;
}

.pay-sheet__field-error {
  display: flex;
  align-items: center;
  gap: var(--hf-space-1);
  margin: 0;
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-small);
}

.pay-sheet__notice {
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

.pay-sheet__footer {
  display: flex;
  flex: 1 1 100%;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--hf-space-2);
}
</style>
