<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { AlertTriangle } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import { formatMinorUnits } from '../finance/money-format.js';
import UiAmountHero from '../ui/AmountHero.vue';
import UiBeforeAfter from '../ui/BeforeAfter.vue';
import UiButton from '../ui/Button.vue';
import UiModal from '../ui/Modal.vue';
import UiSelect from '../ui/Select.vue';
import {
  type AssignFreeResponse,
  type EnvelopePeriodDto,
  type EnvelopePlanDto,
  type MoveEnvelopeResponse,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import EnvelopeTypeIcon from './EnvelopeTypeIcon.vue';
import { decimalToMinor, formatMoneyText, toDecimalText } from './envelope-plan-kind.js';

defineOptions({ name: 'EnvelopeMovePanel' });

// Compact reassignment panel (same contract as the period-leftover panel):
// envelope to envelope, free money to an envelope, or an envelope back to free
// money. The amount is a decimal string, nothing is sent until the user
// confirms, and balances after the change come from the server response.
// `archive` mode fixes the amount to the whole remainder and offers only the
// two destinations that empty the envelope.

export type MovePanelResult =
  | { kind: 'move'; response: MoveEnvelopeResponse }
  | { kind: 'assign'; response: AssignFreeResponse };

type Direction = 'envelope-envelope' | 'free-envelope' | 'envelope-free';

const props = defineProps<{
  budgetId: string;
  source: EnvelopePlanDto | null;
  envelopes: ReadonlyArray<EnvelopePlanDto>;
  mode: 'reassign' | 'archive';
}>();

const emit = defineEmits<{ close: []; done: [result: MovePanelResult] }>();

const planV2 = useEnvelopePlanV2();

// The money of a period envelope lives in period buckets. The server sends the
// buckets (ids, dates, balances, which one is current); the panel only picks
// one and sends its id, it never computes a balance. Sign checks on minor-unit
// strings are the only "math" here.
const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

function isPeriodEnvelope(envelope: EnvelopePlanDto | null | undefined): boolean {
  return envelope?.envelopeType === 'CURRENT_EXPENSES';
}

function periodsOf(envelope: EnvelopePlanDto | null | undefined): EnvelopePeriodDto[] {
  return envelope?.periods ?? [];
}

function hasMoney(period: EnvelopePeriodDto): boolean {
  return period.balanceMinor !== '0' && !period.balanceMinor.startsWith('-');
}

function dayText(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return dayMonth.format(new Date(year, month - 1, day));
}

function periodLabel(period: EnvelopePeriodDto): string {
  const range = `${dayText(period.startsOn)} – ${dayText(period.endsOn)}`;
  return period.current ? `${range} · идёт сейчас` : range;
}

function periodOption(period: EnvelopePeriodDto): string {
  return `${periodLabel(period)} · ${formatMinorUnits(period.balanceMinor, 'RUB', 2)}`;
}

const AMOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;

const direction = ref<Direction>('envelope-envelope');
const destinationId = ref('');
const amount = ref('');
const amountError = ref('');
const destinationError = ref('');
const submitError = ref('');
const pending = ref(false);

const DIRECTION_LABELS: Record<Direction, string> = {
  'envelope-envelope': 'В другой конверт',
  'free-envelope': 'Из свободных сюда',
  'envelope-free': 'В свободные',
};

const directions = computed<Direction[]>(() =>
  props.mode === 'archive'
    ? ['envelope-free', 'envelope-envelope']
    : ['envelope-envelope', 'free-envelope', 'envelope-free'],
);

const candidates = computed(() =>
  props.envelopes.filter(
    (item) => item.archivedAt === null && item.id !== (props.source?.id ?? ''),
  ),
);
const selectable = computed(() =>
  direction.value === 'free-envelope'
    ? props.envelopes.filter((item) => item.archivedAt === null)
    : candidates.value,
);
const needsDestination = computed(() => direction.value !== 'envelope-free');
// Quick picks: the first envelopes in list order (never the source when moving
// envelope to envelope); the searchable select offers all of them.
const QUICK_PICKS = 5;
const recipientPills = computed(() => selectable.value.slice(0, QUICK_PICKS));
const recipientOptions = computed(() =>
  selectable.value.map((item) => ({ value: item.id, label: item.name })),
);
const destination = computed(
  () => props.envelopes.find((item) => item.id === destinationId.value) ?? null,
);
const amountLocked = computed(() => props.mode === 'archive');

const sourceMoneyPeriods = computed(() =>
  isPeriodEnvelope(props.source) ? periodsOf(props.source).filter(hasMoney) : [],
);
const sourceUsesPeriods = computed(
  () => isPeriodEnvelope(props.source) && periodsOf(props.source).length > 0,
);
const sourcePeriodId = ref('');
const sourcePeriod = computed(
  () => sourceMoneyPeriods.value.find((item) => item.periodId === sourcePeriodId.value) ?? null,
);
const showSourcePeriods = computed(
  () => sourceUsesPeriods.value && direction.value !== 'free-envelope',
);
const sourceBalanceMinor = computed(
  () => sourcePeriod.value?.balanceMinor ?? props.source?.balanceMinor ?? '0',
);

// Money lands in the current period of a period envelope (the same bucket the
// confirm sends as destinationPeriodId); null when it has no current period.
function receivingBalanceMinor(envelope: EnvelopePlanDto): string | null {
  if (!isPeriodEnvelope(envelope)) return envelope.balanceMinor;
  return periodsOf(envelope).find((item) => item.current)?.balanceMinor ?? null;
}

// The money the source can give now (the chosen period bucket for a period
// envelope). Server value; the server still checks the limit on save.
const sourceAvailableMinor = computed(() => sourceBalanceMinor.value);

// Hero: the bucket that gives the money, or, for «Из свободных сюда», the one
// that receives it.
const heroMinor = computed(() => {
  if (direction.value === 'free-envelope' && props.source) {
    return receivingBalanceMinor(props.source) ?? props.source.balanceMinor;
  }
  return sourceAvailableMinor.value;
});

// Preview only: the one place the browser adds or subtracts money, on integer
// minor units (bigint). Nothing here is sent; the server validates and returns
// the real balances after the change. Invalid or zero amounts hide the preview.
const previewAmountMinor = computed<string | null>(() => {
  const text = amount.value.trim();
  if (!AMOUNT_PATTERN.test(text)) return null;
  const minor = decimalToMinor(text.replace(',', '.'));
  if (minor === null || !/[1-9]/.test(minor)) return null;
  return minor;
});

type PreviewRow = { label: string; beforeMinor: string; afterMinor: string };

const previewRows = computed<PreviewRow[]>(() => {
  const minor = previewAmountMinor.value;
  const source = props.source;
  if (minor === null || !source) return [];
  const delta = BigInt(minor);
  const rows: PreviewRow[] = [];
  if (direction.value !== 'free-envelope') {
    const before = sourceBalanceMinor.value;
    rows.push({
      label: source.name,
      beforeMinor: before,
      afterMinor: (BigInt(before) - delta).toString(),
    });
  }
  const before = destination.value ? receivingBalanceMinor(destination.value) : null;
  if (direction.value !== 'envelope-free' && destination.value && before !== null) {
    rows.push({
      label: destination.value.name,
      beforeMinor: before,
      afterMinor: (BigInt(before) + delta).toString(),
    });
  }
  return rows;
});

const amountDescribedBy = computed(
  () =>
    [
      direction.value !== 'free-envelope' ? 'move-amount-hint' : undefined,
      amountError.value ? 'move-amount-error' : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined,
);

// Free money has no "before" figure in this panel: name the amount only.
const previewNote = computed(() => {
  const minor = previewAmountMinor.value;
  if (minor === null) return '';
  if (direction.value === 'envelope-free') return `Свободные деньги: +${formatMoneyText(minor)}`;
  if (direction.value === 'free-envelope') return `Свободные деньги: −${formatMoneyText(minor)}`;
  return '';
});

// Default: the current period when it holds money, otherwise the first that does.
watch(
  sourceMoneyPeriods,
  (periods) => {
    if (periods.some((item) => item.periodId === sourcePeriodId.value)) return;
    sourcePeriodId.value = (periods.find((item) => item.current) ?? periods[0])?.periodId ?? '';
  },
  { immediate: true },
);

// Archive moves the whole remainder of the chosen bucket.
watch(sourcePeriodId, () => {
  if (props.mode === 'archive' && sourcePeriod.value) {
    amount.value = toDecimalText(sourcePeriod.value.balanceMinor);
  }
});

watch(
  () => props.source?.id,
  (id) => {
    if (!id || !props.source) return;
    direction.value = props.mode === 'archive' ? 'envelope-free' : 'envelope-envelope';
    destinationId.value = '';
    amount.value =
      props.mode === 'archive'
        ? toDecimalText(sourcePeriod.value?.balanceMinor ?? props.source.balanceMinor)
        : '';
    amountError.value = '';
    destinationError.value = '';
    submitError.value = '';
  },
  { immediate: true },
);

watch(destinationId, () => {
  destinationError.value = '';
});

watch(direction, (next) => {
  destinationError.value = '';
  if (next === 'free-envelope') destinationId.value = props.source?.id ?? '';
  else if (next === 'envelope-free') destinationId.value = '';
  else if (destinationId.value === props.source?.id) destinationId.value = '';
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
  const source = props.source;
  if (!source || pending.value) return;
  // Nothing to move at all: say it before asking for an amount.
  if (direction.value !== 'free-envelope' && sourceUsesPeriods.value && !sourcePeriod.value) {
    submitError.value = 'В этом конверте нет денег, которые можно перенести.';
    amountError.value = '';
    return;
  }
  const text = amount.value.trim();
  if (!AMOUNT_PATTERN.test(text)) {
    amountError.value =
      text === '' ? 'Введите сумму' : 'Введите сумму числом, не более двух знаков после запятой';
    focusById('move-amount');
    return;
  }
  if (/^0+(?:[.,]0+)?$/.test(text)) {
    amountError.value = 'Сумма должна быть больше нуля';
    focusById('move-amount');
    return;
  }
  amountError.value = '';
  if (needsDestination.value && destinationId.value === '') {
    destinationError.value = 'Выберите конверт';
    focusById('move-destination');
    return;
  }
  destinationError.value = '';
  const decimal = text.replace(',', '.');

  // Period envelopes: the destination is always its current period.
  let destinationPeriodId: string | undefined;
  if (needsDestination.value && isPeriodEnvelope(destination.value)) {
    destinationPeriodId = periodsOf(destination.value).find((item) => item.current)?.periodId;
    if (destinationPeriodId === undefined) {
      destinationError.value = `У конверта «${destination.value?.name ?? ''}» нет текущего периода. Сначала распределите в него деньги кнопкой «Распределить» на главной.`;
      focusById('move-destination');
      return;
    }
  }

  pending.value = true;
  submitError.value = '';
  try {
    let result: MovePanelResult;
    if (direction.value === 'free-envelope') {
      const body = {
        envelopeId: destinationId.value,
        ...(destinationPeriodId ? { periodId: destinationPeriodId } : {}),
        amount: decimal,
      };
      result = {
        kind: 'assign',
        response: await planV2.assignFree(props.budgetId, body, attemptKey(['assign', body])),
      };
    } else {
      const body = {
        sourceEnvelopeId: source.id,
        ...(sourcePeriod.value ? { sourcePeriodId: sourcePeriod.value.periodId } : {}),
        destinationEnvelopeId: direction.value === 'envelope-free' ? null : destinationId.value,
        ...(destinationPeriodId ? { destinationPeriodId } : {}),
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
    submitError.value = v2ErrorMessage(cause, 'Не удалось выполнить перенос. Попробуйте ещё раз.');
    focusById('move-amount');
  } finally {
    pending.value = false;
  }
}

const title = computed(() => (props.mode === 'archive' ? 'Куда направить остаток' : 'Переложить'));
const confirmLabel = computed(() =>
  props.mode === 'archive' ? 'Перенести и архивировать' : 'Переложить',
);

defineExpose({ confirm });
</script>

<template>
  <UiModal :open="source !== null" :title="title" @close="close">
    <div v-if="source" class="move-panel" data-testid="move-panel">
      <p class="move-panel__subtitle" data-testid="move-source-name">Источник: {{ source.name }}</p>

      <p v-if="mode === 'archive'" class="move-panel__muted" data-testid="move-archive-note">
        В конверте «{{ source.name }}» остались деньги. Выберите, куда их направить: после переноса
        конверт будет архивирован.
      </p>

      <div data-testid="move-source-balance">
        <UiAmountHero label="Сейчас в конверте" :amount-minor="heroMinor" />
      </div>

      <fieldset class="move-panel__field">
        <legend class="move-panel__label">Что сделать</legend>
        <div class="move-panel__segments">
          <label v-for="item in directions" :key="item" class="move-panel__segment">
            <input
              v-model="direction"
              type="radio"
              name="move-direction"
              class="move-panel__radio"
              :value="item"
              :data-testid="`move-direction-${item}`"
              :disabled="pending"
            />
            <span>{{ DIRECTION_LABELS[item] }}</span>
          </label>
        </div>
      </fieldset>

      <div v-if="showSourcePeriods && sourceMoneyPeriods.length > 1" class="move-panel__field">
        <label for="move-source-period" class="move-panel__label">Из какого периода</label>
        <select
          id="move-source-period"
          v-model="sourcePeriodId"
          class="move-panel__input"
          data-testid="move-source-period"
          :disabled="pending"
        >
          <option v-for="item in sourceMoneyPeriods" :key="item.periodId" :value="item.periodId">
            {{ periodOption(item) }}
          </option>
        </select>
      </div>
      <p
        v-else-if="showSourcePeriods && sourcePeriod"
        class="move-panel__muted"
        data-testid="move-source-period-note"
      >
        Деньги периода: {{ periodLabel(sourcePeriod) }}.
      </p>

      <fieldset v-if="needsDestination" class="move-panel__field">
        <legend class="move-panel__label">Конверт-получатель</legend>
        <div v-if="recipientPills.length > 0" class="move-panel__pills">
          <button
            v-for="item in recipientPills"
            :key="item.id"
            type="button"
            class="move-panel__pill"
            :class="{ 'move-panel__pill--selected': item.id === destinationId }"
            :aria-pressed="item.id === destinationId ? 'true' : 'false'"
            :data-testid="`move-recipient-pill-${item.id}`"
            :disabled="pending"
            @click="destinationId = item.id"
          >
            <EnvelopeTypeIcon :envelope-type="item.envelopeType" size="sm" />
            <span class="move-panel__pill-name">{{ item.name }}</span>
          </button>
        </div>
        <UiSelect
          id="move-destination"
          v-model="destinationId"
          name="move-destination"
          label="Все конверты"
          placeholder="Найдите конверт"
          searchable
          data-testid="move-destination"
          :options="recipientOptions"
          :error="destinationError || undefined"
          :disabled="pending"
        />
        <p v-if="selectable.length === 0" class="move-panel__muted">
          Другого активного конверта нет. Создайте его или выберите «В свободные».
        </p>
        <p
          v-if="destination && previewRows.length === 0"
          class="move-panel__muted"
          data-testid="move-destination-balance"
        >
          Сейчас осталось
          <FinanceMoney
            :minor-units="receivingBalanceMinor(destination) ?? destination.balanceMinor"
            currency="RUB"
            :scale="2"
          />
        </p>
      </fieldset>

      <div class="move-panel__field">
        <label for="move-amount" class="move-panel__label">Сумма, ₽</label>
        <input
          id="move-amount"
          v-model="amount"
          class="move-panel__input"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          data-testid="move-amount"
          :readonly="amountLocked"
          :disabled="pending"
          :aria-invalid="amountError ? 'true' : undefined"
          :aria-describedby="amountDescribedBy"
          @keydown.enter.prevent="confirm"
        />
        <p
          v-if="direction !== 'free-envelope'"
          id="move-amount-hint"
          class="move-panel__muted"
          data-testid="move-amount-hint"
        >
          Можно переложить до {{ formatMoneyText(sourceAvailableMinor) }}
        </p>
        <p
          v-if="amountError"
          id="move-amount-error"
          class="move-panel__error"
          role="alert"
          data-testid="move-amount-error"
        >
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ amountError }}
        </p>
      </div>

      <div v-if="previewRows.length > 0" class="move-panel__preview" data-testid="move-preview">
        <p class="move-panel__label">Было → стало</p>
        <UiBeforeAfter :rows="previewRows" />
        <p v-if="previewNote" class="move-panel__muted">{{ previewNote }}</p>
      </div>

      <p class="move-panel__muted">
        Это предварительный расчёт: итоговые остатки покажет сервер. Ничего не изменится, пока вы не
        подтвердите.
      </p>

      <p v-if="submitError" class="move-panel__error" role="alert" data-testid="move-error">
        <AlertTriangle :size="14" aria-hidden="true" />
        {{ submitError }}
      </p>
    </div>

    <template #footer>
      <div class="move-panel__buttons">
        <UiButton variant="secondary" :disabled="pending" data-testid="move-cancel" @click="close">
          Отмена
        </UiButton>
        <UiButton
          variant="primary"
          :loading="pending"
          :disabled="pending"
          data-testid="move-confirm"
          @click="confirm"
        >
          {{ confirmLabel }}
        </UiButton>
      </div>
    </template>
  </UiModal>
</template>

<style scoped>
.move-panel {
  display: grid;
  gap: var(--hf-space-4);
  min-width: 0;
}

.move-panel__muted {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.move-panel__subtitle {
  margin: 0;
  color: var(--hf-color-text-muted);
  overflow-wrap: anywhere;
}

.move-panel__field {
  display: grid;
  gap: var(--hf-space-2);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.move-panel__label {
  margin: 0;
  font-weight: var(--hf-font-weight-medium);
}

.move-panel__input {
  min-height: 44px;
  padding: 0 var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
  font-variant-numeric: tabular-nums;
}

.move-panel__input:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.move-panel__input[aria-invalid='true'] {
  border-color: var(--hf-color-border-danger);
}

.move-panel__input[readonly] {
  background: var(--hf-color-surface-subtle);
}

/* Direction: radio group drawn as a segmented control. */
.move-panel__segments {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-1);
  padding: var(--hf-space-1);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
}

.move-panel__segment {
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

.move-panel__segment:has(:checked) {
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-semibold);
}

.move-panel__segment:has(:focus-visible) {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

/* Full-size transparent overlay: the native radio itself receives pointer
   input (E2E `.check()` works) and keyboard focus; the segment draws state. */
.move-panel__radio {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
}

.move-panel__radio:disabled {
  cursor: not-allowed;
}

.move-panel__pills {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}

.move-panel__pill {
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

.move-panel__pill-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.move-panel__pill--selected {
  border-color: var(--hf-color-action-primary);
  background: var(--hf-color-brand-soft);
  font-weight: var(--hf-font-weight-semibold);
}

.move-panel__pill:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.move-panel__pill:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.move-panel__preview {
  display: grid;
  gap: var(--hf-space-2);
  min-width: 0;
}

.move-panel__error {
  display: flex;
  gap: var(--hf-space-1);
  align-items: center;
  margin: 0;
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-small);
}

.move-panel__buttons {
  display: flex;
  flex: 1 1 100%;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  justify-content: flex-end;
}
</style>
