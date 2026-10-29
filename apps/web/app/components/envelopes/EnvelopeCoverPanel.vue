<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { AlertTriangle } from '@lucide/vue';

import UiAmountHero from '../ui/AmountHero.vue';
import UiBeforeAfter from '../ui/BeforeAfter.vue';
import UiButton from '../ui/Button.vue';
import UiModal from '../ui/Modal.vue';
import {
  type EnvelopePlanDto,
  type MoveEnvelopeResponse,
  type AssignFreeResponse,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import EnvelopeTypeIcon from './EnvelopeTypeIcon.vue';
import {
  decimalToMinor,
  formatMoneyText,
  periodRangeText,
  toDecimalText,
} from './envelope-plan-kind.js';

defineOptions({ name: 'EnvelopeCoverPanel' });

// Covers a shortage of one envelope bucket: the overspend of a past period of a
// current-expense envelope, or the gap of the mandatory envelope. The recipient is
// fixed; the user picks where the money comes from (free money or another
// envelope) and confirms. Every balance is a server minor-units string; the
// before/after rows are a preview only, the server checks and returns the result.

export type CoverTarget = {
  reason: 'deficit' | 'mandatory';
  envelope: EnvelopePlanDto;
  // The bucket to cover for a current-expense envelope; null for a whole envelope.
  periodId: string | null;
  // How much is missing, server value (positive minor units).
  shortageMinor: string;
};

export type CoverPanelResult =
  | { kind: 'move'; response: MoveEnvelopeResponse }
  | { kind: 'assign'; response: AssignFreeResponse };

type Source = 'free' | 'envelope';
type Donor = {
  key: string;
  envelope: EnvelopePlanDto;
  periodId: string | null;
  availableMinor: string;
};

const props = defineProps<{
  budgetId: string;
  target: CoverTarget | null;
  envelopes: ReadonlyArray<EnvelopePlanDto>;
  freeMinor: string;
}>();

const emit = defineEmits<{ close: []; done: [result: CoverPanelResult] }>();

const planV2 = useEnvelopePlanV2();

const AMOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;
const isPositive = (minor: string) => /[1-9]/.test(minor) && !minor.startsWith('-');

const source = ref<Source>('free');
const donorKey = ref('');
const amount = ref('');
const amountError = ref('');
const donorError = ref('');
const submitError = ref('');
const pending = ref(false);

const targetPeriod = computed(() => {
  const target = props.target;
  if (!target || target.periodId === null) return null;
  return (target.envelope.periods ?? []).find((item) => item.periodId === target.periodId) ?? null;
});
const targetBalanceMinor = computed(
  () => targetPeriod.value?.balanceMinor ?? props.target?.envelope.balanceMinor ?? '0',
);

const title = computed(() =>
  props.target?.reason === 'deficit' ? 'Покрыть перерасход' : 'Пополнить обязательные',
);
const subtitle = computed(() => {
  const target = props.target;
  if (!target) return undefined;
  const period = targetPeriod.value;
  return period
    ? `${target.envelope.name} · ${periodRangeText(period.startsOn, period.endsOn)}`
    : target.envelope.name;
});

// Money another envelope can give now: the current period bucket of a
// current-expense envelope, the whole balance of any other envelope.
const donors = computed<Donor[]>(() => {
  const target = props.target;
  if (!target) return [];
  const list: Donor[] = [];
  for (const envelope of props.envelopes) {
    if (envelope.archivedAt !== null) continue;
    // Moving out of an envelope is its owner's action; a missing flag falls
    // back to allowed and the server still refuses foreign envelopes.
    if (envelope.canEdit === false) continue;
    let periodId: string | null = null;
    let availableMinor = envelope.balanceMinor;
    if (envelope.envelopeType === 'CURRENT_EXPENSES') {
      const current = (envelope.periods ?? []).find((item) => item.current);
      if (!current) continue;
      periodId = current.periodId;
      availableMinor = current.balanceMinor;
    }
    if (envelope.id === target.envelope.id && periodId === target.periodId) continue;
    if (!isPositive(availableMinor)) continue;
    list.push({ key: `${envelope.id}:${periodId ?? ''}`, envelope, periodId, availableMinor });
  }
  return list;
});
const donor = computed(() => donors.value.find((item) => item.key === donorKey.value) ?? null);
const freeAvailable = computed(() => isPositive(props.freeMinor));
const availableMinor = computed(() =>
  source.value === 'free' ? props.freeMinor : (donor.value?.availableMinor ?? null),
);

// Preview only, on integer minor units (bigint); nothing here is sent.
const previewRows = computed(() => {
  const target = props.target;
  const text = amount.value.trim();
  if (!target || !AMOUNT_PATTERN.test(text)) return [];
  const minor = decimalToMinor(text.replace(',', '.'));
  if (minor === null || !/[1-9]/.test(minor)) return [];
  const delta = BigInt(minor);
  const rows = [];
  if (source.value === 'envelope' && donor.value) {
    rows.push({
      label: donor.value.envelope.name,
      beforeMinor: donor.value.availableMinor,
      afterMinor: (BigInt(donor.value.availableMinor) - delta).toString(),
    });
  }
  if (source.value === 'free') {
    rows.push({
      label: 'Свободные деньги',
      beforeMinor: props.freeMinor,
      afterMinor: (BigInt(props.freeMinor) - delta).toString(),
    });
  }
  rows.push({
    label: target.envelope.name,
    beforeMinor: targetBalanceMinor.value,
    afterMinor: (BigInt(targetBalanceMinor.value) + delta).toString(),
  });
  return rows;
});

watch(
  () => props.target,
  (target) => {
    if (!target) return;
    source.value = freeAvailable.value || donors.value.length === 0 ? 'free' : 'envelope';
    donorKey.value = donors.value.length === 1 ? donors.value[0]!.key : '';
    amount.value = toDecimalText(target.shortageMinor);
    amountError.value = '';
    donorError.value = '';
    submitError.value = '';
  },
  { immediate: true },
);

watch([source, donorKey], () => {
  donorError.value = '';
  submitError.value = '';
});

// One Idempotency-Key per user attempt; a retry of the same request reuses it.
let attempt: { fingerprint: string; key: string } | null = null;
function attemptKey(payload: unknown): string {
  const fingerprint = JSON.stringify(payload);
  if (attempt?.fingerprint !== fingerprint) {
    attempt = { fingerprint, key: crypto.randomUUID() };
  }
  return attempt.key;
}

function focusById(id: string): void {
  void nextTick(() => document.getElementById(id)?.focus());
}

function close(): void {
  if (pending.value) return;
  emit('close');
}

async function confirm(): Promise<void> {
  const target = props.target;
  if (!target || pending.value) return;
  if (source.value === 'envelope' && !donor.value) {
    donorError.value = 'Выберите конверт, из которого взять деньги';
    void nextTick(() => document.querySelector<HTMLElement>('.cover-panel__pill')?.focus());
    return;
  }
  const text = amount.value.trim();
  if (!AMOUNT_PATTERN.test(text)) {
    amountError.value =
      text === '' ? 'Введите сумму' : 'Введите сумму числом, не более двух знаков после запятой';
    focusById('cover-amount');
    return;
  }
  if (/^0+(?:[.,]0+)?$/.test(text)) {
    amountError.value = 'Сумма должна быть больше нуля';
    focusById('cover-amount');
    return;
  }
  amountError.value = '';
  const decimal = text.replace(',', '.');
  pending.value = true;
  submitError.value = '';
  try {
    let result: CoverPanelResult;
    if (source.value === 'free') {
      const body = {
        envelopeId: target.envelope.id,
        ...(target.periodId ? { periodId: target.periodId } : {}),
        amount: decimal,
      };
      result = {
        kind: 'assign',
        response: await planV2.assignFree(props.budgetId, body, attemptKey(['assign', body])),
      };
    } else {
      const from = donor.value!;
      const body = {
        sourceEnvelopeId: from.envelope.id,
        ...(from.periodId ? { sourcePeriodId: from.periodId } : {}),
        destinationEnvelopeId: target.envelope.id,
        ...(target.periodId ? { destinationPeriodId: target.periodId } : {}),
        amount: decimal,
      };
      result = {
        kind: 'move',
        response: await planV2.move(props.budgetId, body, attemptKey(['move', body])),
      };
    }
    attempt = null;
    emit('done', result);
  } catch (cause) {
    submitError.value = v2ErrorMessage(cause, 'Не удалось покрыть. Попробуйте ещё раз.');
    focusById('cover-amount');
  } finally {
    pending.value = false;
  }
}

defineExpose({ confirm });
</script>

<template>
  <UiModal :open="target !== null" :title="title" :subtitle="subtitle" @close="close">
    <div v-if="target" class="cover-panel" data-testid="cover-panel">
      <UiAmountHero
        :label="target.reason === 'deficit' ? 'Перерасход' : 'Не хватает'"
        :amount-minor="target.shortageMinor"
        amount-test-id="cover-shortage"
      />

      <fieldset class="cover-panel__field">
        <legend class="cover-panel__label">Откуда взять деньги</legend>
        <div class="cover-panel__segments">
          <label
            class="cover-panel__segment"
            :class="{ 'cover-panel__segment--disabled': !freeAvailable }"
          >
            <input
              v-model="source"
              type="radio"
              name="cover-source"
              class="cover-panel__radio"
              value="free"
              data-testid="cover-source-free"
              :disabled="pending || !freeAvailable"
            />
            <span>Из свободных</span>
          </label>
          <label
            class="cover-panel__segment"
            :class="{ 'cover-panel__segment--disabled': donors.length === 0 }"
          >
            <input
              v-model="source"
              type="radio"
              name="cover-source"
              class="cover-panel__radio"
              value="envelope"
              data-testid="cover-source-envelope"
              :disabled="pending || donors.length === 0"
            />
            <span>Из другого конверта</span>
          </label>
        </div>
        <p v-if="!freeAvailable" class="cover-panel__muted" data-testid="cover-free-empty">
          Свободных денег нет.
        </p>
        <p
          v-if="!freeAvailable && donors.length === 0"
          class="cover-panel__muted"
          data-testid="cover-nothing"
        >
          Взять деньги неоткуда: запишите доход или проверьте остатки на счетах.
        </p>
      </fieldset>

      <fieldset v-if="source === 'envelope'" class="cover-panel__field">
        <legend class="cover-panel__label">Конверт-источник</legend>
        <div
          class="cover-panel__pills"
          :aria-describedby="donorError ? 'cover-donor-error' : undefined"
        >
          <button
            v-for="item in donors"
            :key="item.key"
            type="button"
            class="cover-panel__pill"
            :class="{ 'cover-panel__pill--selected': item.key === donorKey }"
            :aria-pressed="item.key === donorKey ? 'true' : 'false'"
            :data-testid="`cover-donor-${item.envelope.id}`"
            :disabled="pending"
            @click="donorKey = item.key"
          >
            <EnvelopeTypeIcon :envelope-type="item.envelope.envelopeType" size="sm" />
            <span class="cover-panel__pill-name">{{ item.envelope.name }}</span>
            <span class="cover-panel__pill-amount">{{ formatMoneyText(item.availableMinor) }}</span>
          </button>
        </div>
        <p
          v-if="donorError"
          id="cover-donor-error"
          class="cover-panel__error"
          role="alert"
          data-testid="cover-donor-error"
        >
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ donorError }}
        </p>
      </fieldset>

      <div class="cover-panel__field">
        <label for="cover-amount" class="cover-panel__label">Сумма, ₽</label>
        <input
          id="cover-amount"
          v-model="amount"
          class="cover-panel__input"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          data-testid="cover-amount"
          :disabled="pending"
          :aria-invalid="amountError ? 'true' : undefined"
          :aria-describedby="
            [
              availableMinor !== null ? 'cover-amount-hint' : '',
              amountError ? 'cover-amount-error' : '',
            ]
              .filter(Boolean)
              .join(' ') || undefined
          "
          @keydown.enter.prevent="confirm"
        />
        <p
          v-if="availableMinor !== null"
          id="cover-amount-hint"
          class="cover-panel__muted"
          data-testid="cover-amount-hint"
        >
          Можно взять до {{ formatMoneyText(availableMinor) }}
        </p>
        <p
          v-if="amountError"
          id="cover-amount-error"
          class="cover-panel__error"
          role="alert"
          data-testid="cover-amount-error"
        >
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ amountError }}
        </p>
      </div>

      <div v-if="previewRows.length > 0" class="cover-panel__field" data-testid="cover-preview">
        <p class="cover-panel__label">Было → стало</p>
        <UiBeforeAfter :rows="previewRows" />
      </div>

      <p class="cover-panel__muted">
        Это предварительный расчёт: итоговые остатки покажет сервер. Ничего не изменится, пока вы не
        подтвердите.
      </p>

      <p v-if="submitError" class="cover-panel__error" role="alert" data-testid="cover-error">
        <AlertTriangle :size="14" aria-hidden="true" />
        {{ submitError }}
      </p>
    </div>

    <template #footer>
      <div class="cover-panel__buttons">
        <UiButton variant="secondary" :disabled="pending" data-testid="cover-cancel" @click="close">
          Отмена
        </UiButton>
        <UiButton
          variant="primary"
          :loading="pending"
          :disabled="pending || (!freeAvailable && donors.length === 0)"
          data-testid="cover-confirm"
          @click="confirm"
        >
          Покрыть
        </UiButton>
      </div>
    </template>
  </UiModal>
</template>

<style scoped>
.cover-panel {
  display: grid;
  gap: var(--hf-space-5);
  min-width: 0;
}

.cover-panel__muted {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.cover-panel__field {
  display: grid;
  gap: var(--hf-space-3);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.cover-panel__label {
  margin: 0;
  font-weight: var(--hf-font-weight-medium);
}

legend.cover-panel__label {
  margin-bottom: var(--hf-space-3);
  padding: 0;
}

.cover-panel__input {
  min-height: 44px;
  padding: 0 var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
  font-variant-numeric: tabular-nums;
}

.cover-panel__input:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.cover-panel__input[aria-invalid='true'] {
  border-color: var(--hf-color-border-danger);
}

.cover-panel__segments {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-1);
  padding: var(--hf-space-1);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
}

.cover-panel__segment {
  position: relative;
  display: inline-flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 var(--hf-space-3);
  border-radius: var(--hf-radius-sm);
  color: var(--hf-color-text-muted);
  text-align: center;
  cursor: pointer;
}

.cover-panel__segment:has(:checked) {
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-semibold);
}

.cover-panel__segment:has(:focus-visible) {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.cover-panel__radio {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
}

.cover-panel__segment--disabled {
  color: var(--hf-color-text-subtle);
  cursor: not-allowed;
}

.cover-panel__radio:disabled {
  cursor: not-allowed;
}

.cover-panel__pills {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}

.cover-panel__pill {
  display: inline-flex;
  gap: var(--hf-space-2);
  align-items: center;
  min-width: 0;
  max-width: 100%;
  min-height: 44px;
  padding: var(--hf-space-1) var(--hf-space-3) var(--hf-space-1) var(--hf-space-1);
  border: 1px solid var(--hf-color-border);
  border-radius: 999px;
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
  cursor: pointer;
}

.cover-panel__pill-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cover-panel__pill-amount {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.cover-panel__pill--selected {
  border-color: var(--hf-color-action-primary);
  background: var(--hf-color-brand-soft);
  font-weight: var(--hf-font-weight-semibold);
}

.cover-panel__pill:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.cover-panel__pill:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.cover-panel__error {
  display: flex;
  gap: var(--hf-space-1);
  align-items: center;
  margin: 0;
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-small);
}

.cover-panel__buttons {
  display: flex;
  flex: 1 1 100%;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  justify-content: flex-end;
}
</style>
