<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { AlertTriangle } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import { formatMinorUnits } from '../finance/money-format.js';
import UiButton from '../ui/Button.vue';
import UiModal from '../ui/Modal.vue';
import {
  type AssignFreeResponse,
  type EnvelopePeriodDto,
  type EnvelopePlanDto,
  type MoveEnvelopeResponse,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import { toDecimalText } from './envelope-plan-kind.js';

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
  'free-envelope': 'Из свободных в этот конверт',
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
      <p v-if="mode === 'archive'" class="move-panel__muted" data-testid="move-archive-note">
        В конверте «{{ source.name }}» остались деньги. Выберите, куда их направить: после переноса
        конверт будет архивирован.
      </p>

      <fieldset class="move-panel__field">
        <legend class="move-panel__label">Что сделать</legend>
        <div class="move-panel__pills">
          <label v-for="item in directions" :key="item" class="move-panel__pill">
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

      <dl class="move-panel__route">
        <div v-if="direction !== 'free-envelope'">
          <dt>Откуда: «{{ source.name }}»</dt>
          <dd data-testid="move-source-balance">
            Сейчас осталось
            <FinanceMoney :minor-units="sourceBalanceMinor" currency="RUB" :scale="2" />
          </dd>
        </div>
        <div v-else>
          <dt>Откуда</dt>
          <dd>Свободные деньги</dd>
        </div>
      </dl>

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

      <div v-if="needsDestination" class="move-panel__field">
        <label for="move-destination" class="move-panel__label">
          {{ direction === 'free-envelope' ? 'Конверт-получатель' : 'Куда' }}
        </label>
        <select
          id="move-destination"
          v-model="destinationId"
          class="move-panel__input"
          data-testid="move-destination"
          :disabled="pending"
          :aria-invalid="destinationError ? 'true' : undefined"
          :aria-describedby="destinationError ? 'move-destination-error' : undefined"
        >
          <option value="" disabled>Выберите конверт</option>
          <option v-for="item in selectable" :key="item.id" :value="item.id">
            {{ item.name }}
          </option>
        </select>
        <p v-if="selectable.length === 0" class="move-panel__muted">
          Другого активного конверта нет. Создайте его или выберите «В свободные».
        </p>
        <p v-if="destination" class="move-panel__muted" data-testid="move-destination-balance">
          Сейчас осталось
          <FinanceMoney :minor-units="destination.balanceMinor" currency="RUB" :scale="2" />
        </p>
        <p
          v-if="destinationError"
          id="move-destination-error"
          class="move-panel__error"
          role="alert"
          data-testid="move-destination-error"
        >
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ destinationError }}
        </p>
      </div>

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
          :aria-describedby="amountError ? 'move-amount-error' : undefined"
          @keydown.enter.prevent="confirm"
        />
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

      <p class="move-panel__muted">
        Остатки после переноса покажет сервер. Ничего не изменится, пока вы не подтвердите.
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

.move-panel__route {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
}

.move-panel__route dt {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.move-panel__route dd {
  margin: 0;
  font-weight: var(--hf-font-weight-semibold);
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

.move-panel__pills {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}

.move-panel__pill {
  display: inline-flex;
  gap: var(--hf-space-2);
  align-items: center;
  min-height: 44px;
  padding: 0 var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: 999px;
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  cursor: pointer;
}

.move-panel__pill:has(:checked) {
  border-color: var(--hf-color-action-primary);
  background: var(--hf-color-surface-subtle);
  font-weight: var(--hf-font-weight-semibold);
}

.move-panel__pill:has(:focus-visible) {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.move-panel__radio {
  width: 1.25rem;
  height: 1.25rem;
  accent-color: var(--hf-color-action-primary);
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
