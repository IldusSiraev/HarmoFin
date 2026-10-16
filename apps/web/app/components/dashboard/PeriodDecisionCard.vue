<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { AlertTriangle, Ban, Info } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import UiActionMenu from '../ui/ActionMenu.vue';
import UiButton from '../ui/Button.vue';
import UiDrawer from '../ui/Drawer.vue';
import {
  type DashboardV2Response,
  type EnvelopePlanDto,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';

defineOptions({ name: 'PeriodDecisionCard' });

// Explicit decisions about money left over from the previous period. Nothing
// here moves money by itself: the server-confirmed dashboard supplies every
// balance as a minor-units string, and a move is only sent after the user
// confirms it in the panel. No arithmetic on money happens in the browser.

type Warning = DashboardV2Response['warnings'][number];
type Kind = 'FREE' | 'SAVINGS_GOAL' | 'MANDATORY_EXPENSES';

const props = defineProps<{
  budgetId: string;
  warnings: ReadonlyArray<Warning>;
  suggestedTarget: string | null;
  periodId: string | null;
  // The onboarding checklist already shows the plan decision: do not repeat it.
  hideTarget?: boolean;
  protectedAssignments: DashboardV2Response['protectedAssignments'];
}>();

// `changed`: a server mutation succeeded, the page rereads the dashboard and
// restores focus. `focus-fallback`: this card has nothing left to focus.
const emit = defineEmits<{ changed: []; 'focus-fallback': [] }>();

const planV2 = useEnvelopePlanV2();

const AMOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;

const dismissed = ref<ReadonlySet<string>>(new Set());
const heading = ref<HTMLElement | null>(null);

const leftovers = computed(() =>
  props.warnings.filter(
    (warning) =>
      warning.code === 'PERIOD_LEFTOVER' &&
      warning.envelopeId !== null &&
      warning.periodId !== null &&
      warning.balanceMinor !== null &&
      !dismissed.value.has(rowKey(warning)),
  ),
);
const deficits = computed(() => props.warnings.filter((w) => w.code === 'PERIOD_DEFICIT'));
const hasTarget = computed(
  () => props.suggestedTarget !== null && props.periodId !== null && props.hideTarget !== true,
);
const visible = computed(
  () => hasTarget.value || leftovers.value.length > 0 || deficits.value.length > 0,
);

function rowKey(warning: Warning): string {
  return `${warning.envelopeId ?? ''}:${warning.periodId ?? ''}`;
}

function sourceName(warning: Warning): string {
  return (
    props.protectedAssignments.find(
      (item) => item.envelopeId === warning.envelopeId && item.periodId === warning.periodId,
    )?.envelopeName ?? 'Конверт прошлого периода'
  );
}

// One Idempotency-Key per user attempt: the same request retried reuses it,
// any changed field starts a new attempt.
let attempt: { fingerprint: string; key: string } | null = null;
function attemptKey(kind: string, payload: unknown): string {
  const fingerprint = `${kind}:${JSON.stringify(payload)}`;
  if (attempt?.fingerprint !== fingerprint) {
    attempt = { fingerprint, key: crypto.randomUUID() };
  }
  return attempt.key;
}

async function afterSuccess(): Promise<void> {
  attempt = null;
  emit('changed');
}

// Draft period target

const targetPending = ref(false);
const targetError = ref('');

async function decideTarget(kind: 'confirm' | 'reject'): Promise<void> {
  if (targetPending.value || props.periodId === null) return;
  targetPending.value = true;
  targetError.value = '';
  try {
    const key = attemptKey(`target-${kind}`, props.periodId);
    if (kind === 'confirm') {
      await planV2.confirmPeriodTarget(props.budgetId, props.periodId, key);
    } else {
      await planV2.rejectPeriodTarget(props.budgetId, props.periodId, key);
    }
    await afterSuccess();
  } catch (error) {
    targetError.value = v2ErrorMessage(error, 'Не удалось выполнить действие. Попробуйте ещё раз.');
  } finally {
    targetPending.value = false;
  }
}

// Leftover move panel

const sheet = ref<{ warning: Warning; kind: Kind } | null>(null);
const amount = ref('');
const amountError = ref('');
const moveError = ref('');
const pending = ref(false);
const destinationId = ref<string | null>(null);
const envelopes = ref<EnvelopePlanDto[] | null>(null);
const envelopesLoading = ref(false);
const envelopesError = ref('');

const KIND_LABELS: Record<Kind, string> = {
  FREE: 'Вернуть в свободные',
  SAVINGS_GOAL: 'В накопления',
  MANDATORY_EXPENSES: 'В обязательные',
};

const candidates = computed(() => {
  const current = sheet.value;
  if (!current || current.kind === 'FREE') return [];
  return (envelopes.value ?? []).filter(
    (item) =>
      item.envelopeType === current.kind &&
      item.archivedAt === null &&
      item.id !== current.warning.envelopeId,
  );
});

// Minor-units string -> decimal text for the input ("1000000" -> "10000.00").
function toDecimalText(minor: string): string {
  if (!/^\d+$/.test(minor)) return '';
  const padded = minor.padStart(3, '0');
  const whole = padded.slice(0, -2).replace(/^0+(?=\d)/, '');
  return `${whole}.${padded.slice(-2)}`;
}

async function loadEnvelopes(): Promise<void> {
  envelopesLoading.value = true;
  envelopesError.value = '';
  try {
    envelopes.value = (await planV2.listEnvelopes(props.budgetId)).items;
    if (candidates.value.length === 1) destinationId.value = candidates.value[0]!.id;
  } catch (error) {
    envelopesError.value = v2ErrorMessage(error, 'Не удалось загрузить конверты.');
  } finally {
    envelopesLoading.value = false;
  }
}

async function openSheet(warning: Warning, kind: Kind): Promise<void> {
  sheet.value = { warning, kind };
  amount.value = toDecimalText(warning.balanceMinor ?? '');
  amountError.value = '';
  moveError.value = '';
  destinationId.value = null;
  destinationError.value = '';
  if (kind !== 'FREE') {
    if (envelopes.value === null) await loadEnvelopes();
    else if (candidates.value.length === 1) destinationId.value = candidates.value[0]!.id;
  }
}

function closeSheet(): void {
  if (pending.value) return;
  sheet.value = null;
}

async function keepForNow(warning: Warning): Promise<void> {
  dismissed.value = new Set([...dismissed.value, rowKey(warning)]);
  await nextTick();
  if (heading.value) heading.value.focus();
  else emit('focus-fallback');
}

const destinationName = computed(() => {
  const current = sheet.value;
  if (!current) return '';
  if (current.kind === 'FREE') return 'Свободные деньги';
  return candidates.value.find((item) => item.id === destinationId.value)?.name ?? '';
});

const destinationError = ref('');
const confirmDisabled = computed(() => pending.value);

function focusAmount(): void {
  void nextTick(() => document.getElementById('leftover-amount')?.focus());
}

async function confirmMove(): Promise<void> {
  const current = sheet.value;
  if (!current || confirmDisabled.value) return;
  const text = amount.value.trim();
  if (!AMOUNT_PATTERN.test(text)) {
    amountError.value =
      text === '' ? 'Введите сумму' : 'Введите сумму числом, не более двух знаков после запятой';
    focusAmount();
    return;
  }
  if (/^0+(?:[.,]0+)?$/.test(text)) {
    amountError.value = 'Сумма должна быть больше нуля';
    focusAmount();
    return;
  }
  amountError.value = '';
  if (current.kind !== 'FREE' && destinationId.value === null) {
    destinationError.value = 'Выберите конверт';
    void nextTick(() =>
      document.querySelector<HTMLElement>('[data-testid^="leftover-destination-"]')?.focus(),
    );
    return;
  }
  destinationError.value = '';
  const body = {
    sourceEnvelopeId: current.warning.envelopeId as string,
    sourcePeriodId: current.warning.periodId as string,
    destinationEnvelopeId: current.kind === 'FREE' ? null : destinationId.value,
    amount: text.replace(',', '.'),
  };
  pending.value = true;
  moveError.value = '';
  try {
    await planV2.move(props.budgetId, body, attemptKey('move', body));
    sheet.value = null;
    await afterSuccess();
  } catch (error) {
    moveError.value = v2ErrorMessage(error, 'Не удалось перенести остаток. Попробуйте ещё раз.');
    focusAmount();
  } finally {
    pending.value = false;
  }
}

defineExpose({ confirmMove, decideTarget });
</script>

<template>
  <section
    v-if="visible"
    class="period-decision"
    data-testid="period-decision-card"
    aria-labelledby="period-decision-title"
  >
    <h2 id="period-decision-title" ref="heading" class="period-decision__title" tabindex="-1">
      Решение по периоду
    </h2>

    <div v-if="hasTarget" class="period-decision__row" data-testid="target-row">
      <Info class="period-decision__icon" :size="20" aria-hidden="true" />
      <p class="period-decision__text">
        Предложенный лимит на период
        <FinanceMoney
          class="period-decision__amount"
          :minor-units="suggestedTarget as string"
          currency="RUB"
          :scale="2"
        />
        <span class="period-decision__muted">
          Это предложение, а не действующий лимит, пока вы его не подтвердите.
        </span>
      </p>
      <div class="period-decision__actions">
        <UiButton
          variant="primary"
          size="sm"
          :loading="targetPending"
          data-testid="target-confirm"
          @click="decideTarget('confirm')"
        >
          Подтвердить план
        </UiButton>
        <UiButton
          variant="secondary"
          size="sm"
          :disabled="targetPending"
          data-testid="target-reject"
          @click="decideTarget('reject')"
        >
          Отклонить
        </UiButton>
      </div>
      <p v-if="targetError" class="period-decision__error" role="alert" data-testid="target-error">
        <AlertTriangle :size="14" aria-hidden="true" />
        {{ targetError }}
      </p>
    </div>

    <div
      v-for="warning in leftovers"
      :key="rowKey(warning)"
      class="period-decision__row"
      data-testid="leftover-row"
    >
      <Info class="period-decision__icon" :size="20" aria-hidden="true" />
      <p class="period-decision__text">
        Остаток прошлого периода, «{{ sourceName(warning) }}»
        <FinanceMoney
          class="period-decision__amount"
          :minor-units="warning.balanceMinor as string"
          currency="RUB"
          :scale="2"
        />
        <span class="period-decision__muted">
          Он не добавлен к текущему периоду автоматически: выберите, куда его направить.
        </span>
      </p>
      <UiActionMenu label="Действия с остатком прошлого периода" tooltip="Что сделать с остатком">
        <button
          type="button"
          role="menuitem"
          aria-disabled="true"
          class="period-decision__item--disabled"
          data-action="leftover-next"
        >
          <span class="period-decision__item-title">
            <Ban :size="14" aria-hidden="true" />
            В следующий период
          </span>
          <span class="period-decision__muted">Недоступно: период ещё не создан</span>
        </button>
        <button
          type="button"
          role="menuitem"
          data-action="leftover-savings"
          @click="openSheet(warning, 'SAVINGS_GOAL')"
        >
          В накопления
        </button>
        <button
          type="button"
          role="menuitem"
          data-action="leftover-mandatory"
          @click="openSheet(warning, 'MANDATORY_EXPENSES')"
        >
          В обязательные
        </button>
        <button
          type="button"
          role="menuitem"
          data-action="leftover-free"
          @click="openSheet(warning, 'FREE')"
        >
          Вернуть в свободные
        </button>
        <button
          type="button"
          role="menuitem"
          data-action="leftover-keep"
          @click="keepForNow(warning)"
        >
          Оставить пока
        </button>
      </UiActionMenu>
    </div>

    <div
      v-for="warning in deficits"
      :key="`deficit-${rowKey(warning)}`"
      class="period-decision__row"
      data-testid="deficit-row"
    >
      <AlertTriangle
        class="period-decision__icon period-decision__icon--danger"
        :size="20"
        aria-hidden="true"
      />
      <p class="period-decision__text"><strong>Превышение:</strong> {{ warning.message }}</p>
      <NuxtLink :to="warning.actionPath" class="period-decision__link">Покрыть превышение</NuxtLink>
    </div>

    <UiDrawer :open="sheet !== null" title="Перенести остаток" @close="closeSheet">
      <div v-if="sheet" class="period-decision__sheet">
        <dl class="period-decision__route">
          <div>
            <dt>Откуда</dt>
            <dd>{{ sourceName(sheet.warning) }}, прошлый период</dd>
          </div>
          <div>
            <dt>Куда</dt>
            <dd data-testid="leftover-destination-name">
              {{ KIND_LABELS[sheet.kind] }}{{ destinationName ? `: ${destinationName}` : '' }}
            </dd>
          </div>
        </dl>

        <fieldset v-if="sheet.kind !== 'FREE'" class="period-decision__field">
          <legend class="period-decision__label">Конверт-получатель</legend>
          <p v-if="envelopesLoading" class="period-decision__muted">Загрузка конвертов…</p>
          <p v-else-if="envelopesError" class="period-decision__error" role="alert">
            {{ envelopesError }}
          </p>
          <p v-else-if="candidates.length === 0" class="period-decision__muted">
            Подходящего конверта нет. Создайте его на странице «Конверты».
          </p>
          <div v-else class="period-decision__pills">
            <label v-for="item in candidates" :key="item.id" class="period-decision__pill">
              <input
                v-model="destinationId"
                type="radio"
                name="leftover-destination"
                class="period-decision__radio"
                :value="item.id"
                :data-testid="`leftover-destination-${item.id}`"
                :disabled="pending"
              />
              <span>{{ item.name }}</span>
            </label>
          </div>
          <p
            v-if="destinationError"
            class="period-decision__error"
            role="alert"
            data-testid="leftover-destination-error"
          >
            <AlertTriangle :size="14" aria-hidden="true" />
            {{ destinationError }}
          </p>
        </fieldset>

        <div class="period-decision__field">
          <label for="leftover-amount" class="period-decision__label">Сумма, ₽</label>
          <input
            id="leftover-amount"
            v-model="amount"
            class="period-decision__input"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            data-testid="leftover-amount"
            :aria-invalid="amountError ? 'true' : undefined"
            :aria-describedby="amountError ? 'leftover-amount-error' : undefined"
            :disabled="pending"
            @keydown.enter.prevent="confirmMove"
          />
          <p
            v-if="amountError"
            id="leftover-amount-error"
            class="period-decision__error"
            role="alert"
            data-testid="leftover-amount-error"
          >
            <AlertTriangle :size="14" aria-hidden="true" />
            {{ amountError }}
          </p>
        </div>

        <p
          v-if="moveError"
          class="period-decision__error"
          role="alert"
          data-testid="leftover-error"
        >
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ moveError }}
        </p>
      </div>

      <template #footer>
        <div class="period-decision__buttons">
          <UiButton
            variant="secondary"
            :disabled="pending"
            data-testid="leftover-cancel"
            @click="closeSheet"
          >
            Отмена
          </UiButton>
          <UiButton
            variant="primary"
            :loading="pending"
            :disabled="confirmDisabled"
            data-testid="leftover-confirm"
            @click="confirmMove"
          >
            Перенести
          </UiButton>
        </div>
      </template>
    </UiDrawer>
  </section>
</template>

<style scoped>
.period-decision {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

.period-decision__title {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}

.period-decision__title:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.period-decision__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: center;
  min-height: 2.75rem;
}

.period-decision__icon {
  flex-shrink: 0;
  color: var(--hf-color-status-info);
}

.period-decision__icon--danger {
  color: var(--hf-color-status-danger);
}

.period-decision__text {
  display: grid;
  flex: 1 1 14rem;
  gap: var(--hf-space-1);
  min-width: 0;
  margin: 0;
}

.period-decision__amount {
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.period-decision__muted {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.period-decision__actions,
.period-decision__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}

.period-decision__buttons {
  flex: 1 1 100%;
  justify-content: flex-end;
}

.period-decision__link {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  color: var(--hf-color-action-primary);
  font-weight: var(--hf-font-weight-medium);
}

.period-decision__item--disabled {
  display: grid;
  color: var(--hf-color-text-muted);
  cursor: not-allowed;
}

.period-decision__error {
  display: flex;
  flex: 1 1 100%;
  gap: var(--hf-space-1);
  align-items: center;
  margin: 0;
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-small);
}

.period-decision__sheet {
  display: grid;
  gap: var(--hf-space-4);
  min-width: 0;
}

.period-decision__route {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
}

.period-decision__route dt {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.period-decision__route dd {
  margin: 0;
  font-weight: var(--hf-font-weight-semibold);
  overflow-wrap: anywhere;
}

.period-decision__field {
  display: grid;
  gap: var(--hf-space-2);
}

.period-decision__label {
  margin: 0;
  font-weight: var(--hf-font-weight-medium);
}

.period-decision__input {
  min-height: 44px;
  padding: 0 var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
  font-variant-numeric: tabular-nums;
}

.period-decision__input:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.period-decision__input[aria-invalid='true'] {
  border-color: var(--hf-color-border-danger);
}

.period-decision__pills {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}

.period-decision__pill {
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

.period-decision__pill:has(:checked) {
  border-color: var(--hf-color-action-primary);
  background: var(--hf-color-surface-subtle);
  font-weight: var(--hf-font-weight-semibold);
}

.period-decision__pill:has(:focus-visible) {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.period-decision__radio {
  width: 1.25rem;
  height: 1.25rem;
  accent-color: var(--hf-color-action-primary);
}

.period-decision__item-title {
  display: inline-flex;
  gap: var(--hf-space-1);
  align-items: center;
}

fieldset.period-decision__field {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
</style>
