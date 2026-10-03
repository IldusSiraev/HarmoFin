<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { AlertTriangle, RefreshCw } from '@lucide/vue';

import type { FundingPreviewResponse } from '../../composables/useEnvelopePlanV2.js';
import { formatMinorUnits } from '../finance/money-format.js';
import UiButton from '../ui/Button.vue';
import UiDrawer from '../ui/Drawer.vue';

defineOptions({ name: 'FundingReviewSheet' });

// Presentational only: the parent owns server preview/confirm. Every amount
// comes in as a minor-units string from the server; nothing here sums or
// compares money. BigInt/regex are used only to format minor units into the
// decimal text of an input and to validate the shape of typed text.

export type FundingSheetLine = FundingPreviewResponse['lines'][number] & {
  name?: string;
  /** Server-provided amount that tops the envelope up to its target (minor). */
  toTargetMinor?: string | undefined;
  /** Server-provided amount equal to the whole remainder (minor). */
  allRemainingMinor?: string | undefined;
  /** Server field-level error for this line. */
  error?: string | undefined;
};

export type FundingSheetPeriodDraft = FundingPreviewResponse['periodTargetDrafts'][number] & {
  name?: string;
};

export interface FundingSheetError {
  code: string;
  detail: string;
}

export interface FundingChangeLinePayload {
  envelopeId: string;
  periodId?: string;
  amount: string;
}

const props = withDefaults(
  defineProps<{
    open: boolean;
    sourceMinor: string;
    periodTargetDrafts: FundingSheetPeriodDraft[];
    previewLines: FundingSheetLine[];
    remainingMinor: string;
    mandatoryGapMinor: string;
    pending: boolean;
    error: FundingSheetError | null;
    currency?: string;
    scale?: number;
  }>(),
  { currency: 'RUB', scale: 2 },
);

const emit = defineEmits<{
  changeLine: [payload: FundingChangeLinePayload];
  togglePeriodTarget: [payload: { periodId: string; selected: boolean }];
  confirm: [];
  later: [];
  refresh: [];
}>();

const AMOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;

function money(minor: string): string {
  try {
    return formatMinorUnits(minor, props.currency, props.scale);
  } catch {
    return minor;
  }
}

// Minor-units string -> decimal text for an input ("1000050" -> "10000.50").
function toDecimalText(minor: string): string {
  if (!/^\d+$/.test(minor)) return '';
  const padded = minor.padStart(props.scale + 1, '0');
  const cut = padded.length - props.scale;
  const whole = padded.slice(0, cut).replace(/^0+(?=\d)/, '');
  return props.scale === 0 ? whole : `${whole}.${padded.slice(cut)}`;
}

function lineKey(line: FundingSheetLine): string {
  return `${line.envelopeId}:${line.periodId ?? ''}`;
}

const drafts = reactive<Record<string, string>>({});
const localErrors = reactive<Record<string, string>>({});

watch(
  () => props.previewLines,
  (lines) => {
    for (const line of lines) {
      drafts[lineKey(line)] = toDecimalText(line.suggestedMinor);
      delete localErrors[lineKey(line)];
    }
  },
  { immediate: true, deep: true },
);

function lineError(line: FundingSheetLine): string | undefined {
  return localErrors[lineKey(line)] ?? line.error;
}

function lineName(line: FundingSheetLine): string {
  return line.name ?? 'Конверт';
}

function emitLine(line: FundingSheetLine, amount: string): void {
  const payload: FundingChangeLinePayload = { envelopeId: line.envelopeId, amount };
  if (line.periodId !== null) payload.periodId = line.periodId;
  emit('changeLine', payload);
}

function commitDraft(line: FundingSheetLine): void {
  const key = lineKey(line);
  const text = (drafts[key] ?? '').trim();
  if (!AMOUNT_PATTERN.test(text)) {
    localErrors[key] =
      text === '' ? 'Введите сумму' : 'Введите сумму числом, не более двух знаков после запятой';
    return;
  }
  delete localErrors[key];
  emitLine(line, text.replace(',', '.'));
}

function applyHint(line: FundingSheetLine, minor: string | undefined): void {
  if (minor === undefined) return;
  const text = toDecimalText(minor);
  if (text === '') return;
  drafts[lineKey(line)] = text;
  delete localErrors[lineKey(line)];
  emitLine(line, text);
}

const isStale = computed(() => props.error?.code === 'PREVIEW_STALE');
const isExcess = computed(() => props.remainingMinor.startsWith('-'));
const hasGap = computed(() => /^[1-9]/.test(props.mandatoryGapMinor));
const hasLineError = computed(() =>
  props.previewLines.some((line) => lineError(line) !== undefined),
);
const confirmDisabled = computed(
  () => props.pending || props.error !== null || isExcess.value || hasLineError.value,
);

function handleConfirm(): void {
  if (confirmDisabled.value) return;
  emit('confirm');
}
</script>

<template>
  <UiDrawer :open="open" title="Назначить деньги" @close="emit('later')">
    <div class="funding-sheet">
      <section class="funding-sheet__source" aria-label="Сумма источника">
        <p class="funding-sheet__caption">Можно назначить</p>
        <p class="funding-sheet__amount" data-testid="funding-source">{{ money(sourceMinor) }}</p>
        <p class="funding-sheet__muted" data-testid="funding-intro">
          Эти деньги лежат на ваших счетах и пока свободны. Мы заранее предложили, для каких
          конвертов их отметить. Деньги со счетов никуда не переводятся. Проверьте суммы и нажмите
          «Назначить предложенное» или выберите «Позже».
        </p>
      </section>

      <div
        v-if="error"
        class="funding-sheet__notice"
        role="alert"
        :data-testid="isStale ? 'funding-stale' : 'funding-error'"
      >
        <AlertTriangle :size="18" aria-hidden="true" />
        <p>
          {{
            isStale
              ? 'Данные изменились, предложение устарело. Обновите его, чтобы продолжить.'
              : error.detail
          }}
        </p>
        <UiButton
          v-if="isStale"
          variant="secondary"
          size="sm"
          :disabled="pending"
          data-testid="funding-refresh"
          @click="emit('refresh')"
        >
          <RefreshCw :size="16" aria-hidden="true" />
          Обновить
        </UiButton>
      </div>

      <label
        v-for="draft in periodTargetDrafts"
        :key="draft.periodId"
        class="funding-sheet__card funding-sheet__period"
      >
        <input
          type="checkbox"
          class="funding-sheet__check"
          data-testid="funding-period-toggle"
          :checked="draft.selectedForConfirmation"
          :disabled="pending"
          @change="
            emit('togglePeriodTarget', {
              periodId: draft.periodId,
              selected: ($event.target as HTMLInputElement).checked,
            })
          "
        />
        <span class="funding-sheet__period-text">
          <span class="funding-sheet__period-title">Принять план периода</span>
          <span class="funding-sheet__muted">
            {{ draft.name ?? 'Новый период' }}, цель {{ money(draft.targetMinor) }}
          </span>
        </span>
      </label>

      <ul class="funding-sheet__lines" aria-label="Предложенные назначения">
        <li
          v-for="line in previewLines"
          :key="lineKey(line)"
          class="funding-sheet__line"
          data-testid="funding-line"
          :data-envelope-id="line.envelopeId"
        >
          <div class="funding-sheet__line-head">
            <span class="funding-sheet__line-name">{{ lineName(line) }}</span>
            <input
              v-model="drafts[lineKey(line)]"
              class="funding-sheet__input"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              :data-testid="`funding-amount-${line.envelopeId}`"
              :aria-label="`Сумма для конверта ${lineName(line)}`"
              :aria-invalid="lineError(line) !== undefined ? 'true' : undefined"
              :aria-describedby="
                lineError(line) !== undefined ? `funding-err-${lineKey(line)}` : undefined
              "
              :disabled="pending"
              @change="commitDraft(line)"
              @keydown.enter.prevent="commitDraft(line)"
            />
          </div>
          <p
            v-if="lineError(line) !== undefined"
            :id="`funding-err-${lineKey(line)}`"
            class="funding-sheet__field-error"
            :data-testid="`funding-line-error-${line.envelopeId}`"
          >
            <AlertTriangle :size="14" aria-hidden="true" />
            {{ lineError(line) }}
          </p>
          <div
            v-if="line.toTargetMinor !== undefined || line.allRemainingMinor !== undefined"
            class="funding-sheet__line-actions"
          >
            <UiButton
              v-if="line.toTargetMinor !== undefined"
              variant="tertiary"
              size="sm"
              :disabled="pending"
              :data-testid="`funding-to-target-${line.envelopeId}`"
              @click="applyHint(line, line.toTargetMinor)"
            >
              До нужной суммы
            </UiButton>
            <UiButton
              v-if="line.allRemainingMinor !== undefined"
              variant="tertiary"
              size="sm"
              :disabled="pending"
              :data-testid="`funding-all-remaining-${line.envelopeId}`"
              @click="applyHint(line, line.allRemainingMinor)"
            >
              Весь остаток
            </UiButton>
          </div>
        </li>
      </ul>
    </div>

    <template #footer>
      <div class="funding-sheet__footer">
        <div class="funding-sheet__total" aria-live="polite">
          <span class="funding-sheet__caption">Осталось назначить</span>
          <strong class="funding-sheet__total-amount" data-testid="funding-remaining">
            {{ isExcess ? money(remainingMinor.slice(1)) : money(remainingMinor) }}
          </strong>
          <span
            v-if="remainingMinor === '0' && previewLines.length > 0"
            class="funding-sheet__muted"
            data-testid="funding-all-proposed"
          >
            Всё предложено: ничего не остаётся.
          </span>
          <span v-if="isExcess" class="funding-sheet__status" data-testid="funding-excess">
            Превышение: назначено больше, чем доступно
          </span>
          <span v-if="hasGap" class="funding-sheet__status" data-testid="funding-gap">
            Не хватает на обязательства: {{ money(mandatoryGapMinor) }}
          </span>
        </div>
        <p class="funding-sheet__muted">
          Оставить свободными можно кнопкой «Позже» — деньги не пропадут.
        </p>
        <div class="funding-sheet__buttons">
          <UiButton
            variant="secondary"
            :disabled="pending"
            data-testid="funding-later"
            @click="emit('later')"
          >
            Позже
          </UiButton>
          <UiButton
            variant="primary"
            :loading="pending"
            :disabled="confirmDisabled"
            data-testid="funding-confirm"
            @click="handleConfirm"
          >
            Назначить предложенное
          </UiButton>
        </div>
      </div>
    </template>
  </UiDrawer>
</template>

<style scoped>
.funding-sheet {
  display: grid;
  gap: var(--hf-space-4);
  min-width: 0;
}

.funding-sheet__source {
  display: grid;
  gap: var(--hf-space-1);
}

.funding-sheet__caption,
.funding-sheet__muted {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.funding-sheet__amount {
  margin: 0;
  color: var(--hf-color-text);
  font-size: 1.875rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.funding-sheet__notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hf-space-2);
  margin: 0;
  padding: var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text);
}

.funding-sheet__notice p {
  flex: 1 1 12rem;
  margin: 0;
}

.funding-sheet__card {
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

.funding-sheet__period {
  display: flex;
  align-items: center;
  gap: var(--hf-space-3);
  min-height: 44px;
  padding: var(--hf-space-3) var(--hf-space-4);
  cursor: pointer;
}

.funding-sheet__check {
  flex: none;
  width: 1.5rem;
  height: 1.5rem;
  accent-color: var(--hf-color-action-primary);
}

.funding-sheet__check:focus-visible,
.funding-sheet__input:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.funding-sheet__period-text {
  display: grid;
  min-width: 0;
}

.funding-sheet__period-title,
.funding-sheet__line-name {
  color: var(--hf-color-text);
  font-weight: 600;
}

.funding-sheet__lines {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.funding-sheet__line {
  display: grid;
  gap: var(--hf-space-2);
  min-width: 0;
  padding: var(--hf-space-3) 0;
  border-bottom: 1px solid var(--hf-color-border);
}

.funding-sheet__line-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-3);
}

.funding-sheet__line-name {
  min-width: 0;
  overflow-wrap: anywhere;
}

.funding-sheet__input {
  flex: 0 1 9rem;
  min-width: 0;
  min-height: 44px;
  padding: 0 var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.funding-sheet__input[aria-invalid='true'] {
  border-color: var(--hf-color-border-danger);
}

.funding-sheet__field-error {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--hf-space-1);
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-small);
}

.funding-sheet__line-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}

.funding-sheet__footer {
  display: grid;
  flex: 1 1 100%;
  gap: var(--hf-space-2);
  min-width: 0;
}

.funding-sheet__total {
  display: grid;
  gap: var(--hf-space-1);
}

.funding-sheet__total-amount {
  color: var(--hf-color-text);
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
}

.funding-sheet__status {
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-small);
  font-weight: 600;
}

.funding-sheet__buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--hf-space-2);
}
</style>
