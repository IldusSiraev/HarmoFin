<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { AlertTriangle, Info, RefreshCw } from '@lucide/vue';

import type { FundingPreviewResponse } from '../../composables/useEnvelopePlanV2.js';
import { formatMinorUnits } from '../finance/money-format.js';
import EnvelopeTypeIcon from '../envelopes/EnvelopeTypeIcon.vue';
import UiAmountHero from '../ui/AmountHero.vue';
import UiAttentionRow from '../ui/AttentionRow.vue';
import UiButton from '../ui/Button.vue';
import UiModal from '../ui/Modal.vue';

defineOptions({ name: 'FundingReviewSheet' });

// Presentational only: the parent owns server preview/confirm. The sheet
// lists every active envelope the server sent, zero included: an empty
// field means 0, and typing re-previews after a pause so the server stays
// the one source of the suggested amounts. Every amount comes in as a
// minor-units string from the server; nothing here sums or compares money.
// BigInt/regex are used only to format minor units into the decimal text of
// an input and to validate the shape of typed text.

export type FundingSheetLine = FundingPreviewResponse['lines'][number] & {
  name?: string;
  /** Envelope type from the budget's envelope list; drives the row icon only. */
  envelopeType?: string | undefined;
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
  /** Present only for rows the server identified by lineId (two-slice mandatory). */
  lineId?: string;
  periodId?: string;
  amount: string;
}

const props = withDefaults(
  defineProps<{
    open: boolean;
    sourceKind?: FundingPreviewResponse['sourceKind'] | undefined;
    sourceMinor: string;
    periodTargetDrafts: FundingSheetPeriodDraft[];
    previewLines: FundingSheetLine[];
    remainingMinor: string;
    mandatoryGapMinor: string;
    mandatoryDueCurrentMinor?: string | undefined;
    mandatoryDueNextMinor?: string | undefined;
    pending: boolean;
    error: FundingSheetError | null;
    currency?: string;
    scale?: number;
  }>(),
  {
    currency: 'RUB',
    scale: 2,
    sourceKind: undefined,
    mandatoryDueCurrentMinor: undefined,
    mandatoryDueNextMinor: undefined,
  },
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

// Minor units -> text shown in an amount field: "2000000" -> "20 000", "1000050" -> "10 000,50".
// Spaces only group digits; commitDraft strips them again. String-only, no arithmetic.
// A zero amount shows an empty field with a "0" placeholder.
function toFieldText(minor: string): string {
  if (/^0+$/.test(minor)) return '';
  const [whole = '', fraction = ''] = toDecimalText(minor).split('.');
  if (whole === '') return '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return fraction === '' || /^0+$/.test(fraction) ? grouped : `${grouped},${fraction}`;
}

function lineIdOf(line: FundingSheetLine): string | null {
  return line.lineId == null ? null : line.lineId;
}

function lineKey(line: FundingSheetLine): string {
  return lineIdOf(line) ?? `${line.envelopeId}:${line.periodId ?? ''}`;
}

/** Short token so test ids and aria ids stay unique for two-slice mandatory rows. */
function lineToken(line: FundingSheetLine): string {
  const id = lineIdOf(line);
  return id == null ? line.envelopeId : id.replace(/[^A-Za-z0-9-]+/g, '-');
}

const SOURCE_LABELS: Record<string, string> = {
  INCOME: 'доход',
  OPENING: 'начальный остаток на счетах',
  FREE: 'нераспределённые деньги',
};

const subtitle = computed(() => {
  const label = props.sourceKind === undefined ? undefined : SOURCE_LABELS[props.sourceKind];
  return label === undefined ? null : `Источник: ${label}`;
});

// The row whose field or pill last held focus shows its shortcut pills. It is
// not cleared on blur, so a pill that does not take focus on click (Safari)
// is still there when the click lands.
const activeLineKey = ref<string | null>(null);

const drafts = reactive<Record<string, string>>({});
const localErrors = reactive<Record<string, string>>({});

// The field being typed in keeps the user's text when a recomputed preview arrives.
const focusedLineKey = ref<string | null>(null);

watch(
  () => props.previewLines,
  (lines) => {
    for (const line of lines) {
      const key = lineKey(line);
      if (key === focusedLineKey.value && drafts[key] !== undefined) continue;
      drafts[key] = toFieldText(line.suggestedMinor);
      delete localErrors[key];
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

function lineType(line: FundingSheetLine): string {
  return line.envelopeType ?? 'CUSTOM';
}

function lineInputId(line: FundingSheetLine): string {
  return `funding-input-${lineToken(line)}`;
}

function emitLine(line: FundingSheetLine, amount: string): void {
  const payload: FundingChangeLinePayload = { envelopeId: line.envelopeId, amount };
  const id = lineIdOf(line);
  if (id !== null) payload.lineId = id;
  if (line.periodId !== null) payload.periodId = line.periodId;
  emit('changeLine', payload);
}

const TYPING_PAUSE_MS = 400;
let typingTimer: ReturnType<typeof setTimeout> | null = null;

function cancelTyping(): void {
  if (typingTimer !== null) clearTimeout(typingTimer);
  typingTimer = null;
}

// Empty means "nothing here" and is sent as 0; anything else must be a decimal.
function parseDraft(key: string, text: string): string | null {
  if (text === '') {
    delete localErrors[key];
    return '0';
  }
  if (!AMOUNT_PATTERN.test(text)) {
    localErrors[key] = 'Введите сумму числом, не более двух знаков после запятой';
    return null;
  }
  delete localErrors[key];
  return text.replace(',', '.');
}

function commitDraft(line: FundingSheetLine, event?: Event): void {
  cancelTyping();
  const key = lineKey(line);
  // The field value in the DOM wins: a commit without a preceding 'input'
  // event (Enter, programmatic write) must not resend the stale draft.
  const field = (event?.target ?? null) as HTMLInputElement | null;
  const text = (field?.value ?? drafts[key] ?? '').replace(/\s/g, '');
  const amount = parseDraft(key, text);
  if (amount === null) return;
  drafts[key] = text;
  emitLine(line, amount);
}

function onTyping(line: FundingSheetLine): void {
  cancelTyping();
  const key = lineKey(line);
  const text = (drafts[key] ?? '').replace(/\s/g, '');
  // Mid-typing text is not judged yet: only a valid amount schedules a recompute.
  if (text !== '' && !AMOUNT_PATTERN.test(text)) return;
  typingTimer = setTimeout(() => {
    typingTimer = null;
    const amount = parseDraft(key, text);
    if (amount !== null) emitLine(line, amount);
  }, TYPING_PAUSE_MS);
}

onBeforeUnmount(cancelTyping);

function applyHint(line: FundingSheetLine, minor: string | undefined): void {
  if (minor === undefined) return;
  const text = toDecimalText(minor);
  if (text === '') return;
  drafts[lineKey(line)] = toFieldText(minor);
  delete localErrors[lineKey(line)];
  emitLine(line, text);
}

function lineNumber(line: FundingSheetLine): string {
  return line.queuePosition == null ? '' : String(line.queuePosition);
}

const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
function dayText(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return dayMonth.format(new Date(year, month - 1, day));
}
function periodCaption(line: FundingSheetLine): string | null {
  if (!line.periodStartsOn || !line.periodEndsOn) return null;
  return `${dayText(line.periodStartsOn)} – ${dayText(line.periodEndsOn)}`;
}

const isStale = computed(() => props.error?.code === 'PREVIEW_STALE');
const isExcess = computed(() => props.remainingMinor.startsWith('-'));
const hasGap = computed(() => /^[1-9]/.test(props.mandatoryGapMinor));
const gapTitle = computed(
  () => `Не хватает на обязательные платежи: ${money(props.mandatoryGapMinor)}`,
);
const hasDueBreakdown = computed(
  () =>
    (props.mandatoryDueCurrentMinor !== undefined && props.mandatoryDueCurrentMinor !== '0') ||
    (props.mandatoryDueNextMinor !== undefined && props.mandatoryDueNextMinor !== '0'),
);
const hasLineError = computed(() =>
  props.previewLines.some((line) => lineError(line) !== undefined),
);
// String checks only: is any line non-zero, or is a period target kept?
const hasSomethingToConfirm = computed(
  () =>
    props.previewLines.some((line) => !/^0+$/.test(line.suggestedMinor)) ||
    props.periodTargetDrafts.some((draft) => draft.selectedForConfirmation),
);
const confirmDisabled = computed(
  () =>
    props.pending ||
    props.error !== null ||
    isExcess.value ||
    hasLineError.value ||
    !hasSomethingToConfirm.value,
);

function handleConfirm(): void {
  if (confirmDisabled.value) return;
  emit('confirm');
}
</script>

<template>
  <UiModal :open="open" title="Распределить деньги" @close="emit('later')">
    <div class="funding-sheet">
      <p v-if="subtitle" class="funding-sheet__subtitle" data-testid="funding-subtitle">
        {{ subtitle }}
      </p>

      <section class="funding-sheet__source" aria-label="Сумма источника">
        <UiAmountHero
          label="Можно распределить"
          :amount-minor="sourceMinor"
          amount-test-id="funding-source"
        >
          <template #aside>
            <span class="funding-sheet__badge">
              <Info :size="16" aria-hidden="true" />
              Деньги остаются на ваших счетах
            </span>
          </template>
        </UiAmountHero>
        <p class="funding-sheet__muted" data-testid="funding-intro">
          Суммы предложены по правилам пополнения. Измените любую или впишите сумму в другой
          конверт. Деньги со счетов никуда не переводятся.
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

      <UiAttentionRow
        v-if="hasGap"
        tone="warning"
        data-testid="funding-gap"
        :title="gapTitle"
        description="Можно распределить доступную сумму сейчас и покрыть нехватку позже"
      />

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
          <span class="funding-sheet__period-title">Принять лимит на период</span>
          <span class="funding-sheet__muted">
            {{ draft.name ?? 'Новый период' }}, цель {{ money(draft.targetMinor) }}
          </span>
        </span>
      </label>

      <div v-if="previewLines.length > 0" class="funding-sheet__queue">
        <div class="funding-sheet__queue-head" aria-hidden="true">
          <span>Конверт</span>
          <span>Сумма</span>
        </div>
        <ol class="funding-sheet__lines" aria-label="Распределение по конвертам">
          <li
            v-for="line in previewLines"
            :key="lineKey(line)"
            class="funding-sheet__line"
            data-testid="funding-line"
            :data-envelope-id="line.envelopeId"
            @focusin="activeLineKey = lineKey(line)"
          >
            <div class="funding-sheet__line-head">
              <span class="funding-sheet__line-number" aria-hidden="true">{{
                lineNumber(line)
              }}</span>
              <EnvelopeTypeIcon :envelope-type="lineType(line)" size="sm" />
              <span class="funding-sheet__line-title">
                <span class="funding-sheet__line-name">{{ lineName(line) }}</span>
                <span v-if="periodCaption(line)" class="funding-sheet__line-period">
                  {{ periodCaption(line) }}
                </span>
              </span>
              <label class="funding-sheet__visually-hidden" :for="lineInputId(line)">
                Сумма для {{ lineName(line)
                }}<template v-if="periodCaption(line)">, {{ periodCaption(line) }}</template>
              </label>
              <input
                :id="lineInputId(line)"
                v-model="drafts[lineKey(line)]"
                class="funding-sheet__input"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                placeholder="0"
                :data-testid="`funding-amount-${lineToken(line)}`"
                :aria-invalid="lineError(line) !== undefined ? 'true' : undefined"
                :aria-describedby="
                  lineError(line) !== undefined ? `funding-err-${lineKey(line)}` : undefined
                "
                @input="onTyping(line)"
                @focusin="focusedLineKey = lineKey(line)"
                @focusout="focusedLineKey = null"
                @change="commitDraft(line, $event)"
                @keydown.enter.prevent="commitDraft(line, $event)"
              />
            </div>
            <p
              v-if="lineError(line) !== undefined"
              :id="`funding-err-${lineKey(line)}`"
              class="funding-sheet__field-error"
              :data-testid="`funding-line-error-${lineToken(line)}`"
            >
              <AlertTriangle :size="14" aria-hidden="true" />
              {{ lineError(line) }}
            </p>
            <div
              v-if="line.toTargetMinor !== undefined || line.allRemainingMinor !== undefined"
              v-show="activeLineKey === lineKey(line)"
              class="funding-sheet__line-actions"
            >
              <button
                v-if="line.toTargetMinor !== undefined"
                type="button"
                class="funding-sheet__pill"
                :disabled="pending"
                :data-testid="`funding-to-target-${lineToken(line)}`"
                @click="applyHint(line, line.toTargetMinor)"
              >
                До нужной суммы
              </button>
              <button
                v-if="line.allRemainingMinor !== undefined"
                type="button"
                class="funding-sheet__pill"
                :disabled="pending"
                :data-testid="`funding-all-remaining-${lineToken(line)}`"
                @click="applyHint(line, line.allRemainingMinor)"
              >
                Весь остаток
              </button>
            </div>
          </li>
        </ol>
      </div>
    </div>

    <template #footer>
      <div class="funding-sheet__footer">
        <div class="funding-sheet__total" aria-live="polite">
          <span class="funding-sheet__caption">Осталось распределить</span>
          <!-- Screen-reader echo of the gap row above, so its changes are announced. -->
          <span v-if="hasGap" class="funding-sheet__sr" data-testid="funding-gap-live">
            {{ gapTitle }}
          </span>
          <strong class="funding-sheet__total-amount" data-testid="funding-remaining">
            {{ isExcess ? money(remainingMinor.slice(1)) : money(remainingMinor) }}
          </strong>
          <span
            v-if="remainingMinor === '0' && previewLines.length > 0 && hasSomethingToConfirm"
            class="funding-sheet__muted"
            data-testid="funding-all-proposed"
          >
            Всё распределено: ничего не остаётся.
          </span>
          <span
            v-if="!hasSomethingToConfirm"
            class="funding-sheet__muted"
            data-testid="funding-nothing"
          >
            Впишите сумму хотя бы в один конверт или нажмите «Позже».
          </span>
          <span v-if="pending" class="funding-sheet__muted" data-testid="funding-recount">
            Пересчитываем…
          </span>
          <span v-if="isExcess" class="funding-sheet__status" data-testid="funding-excess">
            <AlertTriangle :size="14" aria-hidden="true" />
            Превышение: распределено больше, чем доступно
          </span>
          <span
            v-if="hasDueBreakdown"
            class="funding-sheet__muted funding-sheet__muted--deep"
            data-testid="funding-due-breakdown"
          >
            К оплате: текущий период {{ money(mandatoryDueCurrentMinor ?? '0') }}; следующий период
            {{ money(mandatoryDueNextMinor ?? '0') }}
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
            Распределить
          </UiButton>
        </div>
      </div>
    </template>
  </UiModal>
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

/* Due amounts are money, not decoration: one level deeper than muted keeps
   the row at 4.5:1 in both themes. */
.funding-sheet__muted--deep {
  color: var(--hf-color-text-secondary);
}

.funding-sheet__subtitle {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.funding-sheet__source {
  gap: var(--hf-space-3);
}

.funding-sheet__badge {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  padding: var(--hf-space-1) var(--hf-space-2);
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-status-info-background);
  color: var(--hf-color-status-info);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
}

.funding-sheet__queue {
  display: grid;
  min-width: 0;
}

.funding-sheet__queue-head {
  display: flex;
  justify-content: space-between;
  gap: var(--hf-space-3);
  padding-bottom: var(--hf-space-2);
  border-bottom: 1px solid var(--hf-color-border);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
}

.funding-sheet__line-number {
  flex: none;
  min-width: 1.25rem;
  color: var(--hf-color-text-muted);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.funding-sheet__visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.funding-sheet__pill {
  min-height: 44px;
  padding: 0 var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: 999px;
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
}

.funding-sheet__pill:hover:not(:disabled) {
  background: var(--hf-color-surface-subtle);
}

.funding-sheet__pill:disabled {
  opacity: 0.6;
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
  gap: var(--hf-space-3);
}

.funding-sheet__line-title {
  display: grid;
  flex: 1 1 auto;
  min-width: 0;
}

.funding-sheet__line-name {
  min-width: 0;
  overflow-wrap: anywhere;
}

.funding-sheet__line-period {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
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
  display: flex;
  flex: 1 1 100%;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-2) var(--hf-space-4);
  min-width: 0;
}

.funding-sheet__footer > .funding-sheet__muted {
  flex-basis: 100%;
  order: 3;
}

.funding-sheet__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
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
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
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
