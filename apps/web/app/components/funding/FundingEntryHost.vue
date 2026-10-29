<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import { ApiRequestError } from '../../composables/useApiClient.js';
import {
  useEnvelopePlanV2,
  type FundingConfirmRequest,
  type FundingConfirmResponse,
  type FundingLineInput,
  type FundingPreviewRequest,
  type FundingPreviewResponse,
} from '../../composables/useEnvelopePlanV2.js';
import { useFundingEntry, type FundingEntryRequest } from '../../composables/useFundingEntry.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';
import { usePermissions } from '../../composables/usePermissions.js';
import { useToast } from '../../composables/useToast.js';
import FundingReviewSheet, {
  type FundingChangeLinePayload,
  type FundingSheetError,
} from './FundingReviewSheet.vue';

defineOptions({ name: 'FundingEntryHost' });

// Owns the optional "assign this money" step: it opens FundingReviewSheet for a
// saved money fact, asks the server for every preview, and confirms exactly the
// lines, period targets and previewHash the last preview returned. The browser
// never computes an amount: it only turns the server's minor-unit strings into
// decimal text for the next request (string formatting, no arithmetic).
//
// Every active envelope comes back as a line (zero when nothing is proposed);
// every preview that can end in a confirm is requested with overrides = all
// lines, zeros included, and confirm sends the same lines. The
// Idempotency-Key belongs to one preview result: a retry of the same confirm
// reuses it, a new preview rotates it.

const emit = defineEmits<{ confirmed: [result: FundingConfirmResponse] }>();

const SCALE = 2;

const v2 = useEnvelopePlanV2();
const entry = useFundingEntry();
const reference = useOperationReferenceData();
const { push } = useToast();

const open = ref(false);
const pending = ref(false);
const error = ref<FundingSheetError | null>(null);
const preview = ref<FundingPreviewResponse | null>(null);
const lineErrors = ref<Record<string, string>>({});
let active: FundingEntryRequest | null = null;
let idempotencyKey = '';
// Drops the answer of a preview/confirm that a newer request has overtaken.
let generation = 0;
let confirming = false;

const envelopeNames = computed(
  () => new Map(reference.envelopePlans.value.map((envelope) => [envelope.id, envelope.name])),
);

// Only the row icon uses it; an unknown envelope falls back to the neutral icon.
const envelopeTypes = computed(
  () =>
    new Map(reference.envelopePlans.value.map((envelope) => [envelope.id, envelope.envelopeType])),
);

// The preview line carries no owner, but the budget envelope references do:
// the review sheet shows the owner caption from here.
const envelopeOwners = computed(
  () => new Map(reference.envelopePlans.value.map((envelope) => [envelope.id, envelope.owner])),
);

type LineIdentifiable = {
  lineId?: string | null;
  envelopeId: string;
  periodId?: string | null;
};

// Server row id wins: the two mandatory slices of one envelope share an id.
function lineKey(line: LineIdentifiable): string {
  return line.lineId ?? `${line.envelopeId}:${line.periodId ?? ''}`;
}

// Distinguishes the two mandatory slice rows so inputs stay labeled uniquely.
function lineLabel(line: LineIdentifiable): string {
  const name = envelopeNames.value.get(line.envelopeId) ?? 'Конверт';
  if (line.lineId?.endsWith('||MANDATORY_CURRENT')) return `${name} — текущий период`;
  if (line.lineId?.endsWith('||MANDATORY_NEXT')) return `${name} — следующий период`;
  return name;
}

// "400050" -> "4000.50": the same decimal text the server accepts in overrides.
function minorToDecimal(minor: string): string {
  const padded = minor.padStart(SCALE + 1, '0');
  const cut = padded.length - SCALE;
  const whole = padded.slice(0, cut).replace(/^0+(?=\d)/, '');
  return `${whole}.${padded.slice(cut)}`;
}

function linesToInputs(lines: FundingPreviewResponse['lines']): FundingLineInput[] {
  return lines.map((line) => ({
    envelopeId: line.envelopeId,
    ...(line.lineId !== null ? { lineId: line.lineId } : {}),
    ...(line.periodId !== null ? { periodId: line.periodId } : {}),
    amount: minorToDecimal(line.suggestedMinor),
  }));
}

function selectedTargets(body: FundingPreviewResponse): string[] {
  return body.periodTargetDrafts
    .filter((draft) => draft.selectedForConfirmation)
    .map((draft) => draft.periodId);
}

function sourceFields(
  request: FundingEntryRequest,
): Pick<FundingPreviewRequest, 'sourceKind' | 'incomeTransactionId'> {
  return request.source.sourceKind === 'INCOME'
    ? { sourceKind: 'INCOME', incomeTransactionId: request.source.incomeTransactionId }
    : { sourceKind: request.source.sourceKind };
}

// Server detail text is not user-facing copy: known codes get Russian text,
// anything else a generic line.
const ERROR_TEXT: Record<string, string> = {
  PREVIEW_STALE: 'Данные изменились, предложение устарело. Обновите его, чтобы продолжить.',
  OVERRIDES_EXCEED_SOURCE: 'Распределено больше, чем доступно. Уменьшите суммы.',
  SOURCE_EXHAUSTED: 'Эти деньги уже распределены. Обновите предложение.',
  ASSIGNMENT_UNBACKED: 'Недостаточно свободных денег для такого распределения.',
  IDEMPOTENCY_CONFLICT: 'Это распределение уже обрабатывается. Обновите предложение.',
  MODEL_VERSION_MISMATCH: 'Для этого бюджета распределение недоступно.',
  OPENING_NOT_AVAILABLE:
    'Начальное распределение уже недоступно. Распределите свободные деньги позже.',
  ENVELOPE_ARCHIVED: 'Конверт в архиве: в него нельзя распределить деньги.',
  PERIOD_REQUIRED: 'Для этого конверта нужен период.',
  PERIOD_NOT_ALLOWED: 'У этого конверта нет периодов.',
  VALIDATION_FAILED: 'Проверьте суммы: они не могут быть отрицательными.',
  FORBIDDEN: 'Распределять деньги может только владелец бюджета.',
};
const GENERIC_ERROR = 'Не удалось распределить деньги. Повторите попытку или нажмите «Позже».';

function sheetError(code: string): FundingSheetError {
  return { code, detail: ERROR_TEXT[code] ?? GENERIC_ERROR };
}

function toSheetError(cause: unknown): FundingSheetError | null {
  if (cause instanceof ApiRequestError && cause.status < 500) {
    return sheetError(cause.problem.code);
  }
  return null;
}

function applyPreview(body: FundingPreviewResponse): void {
  preview.value = body;
  idempotencyKey = crypto.randomUUID();
  const first = body.errors[0];
  error.value = first ? sheetError(first.code) : null;
}

async function requestPreview(
  request: FundingEntryRequest,
  overrides?: FundingLineInput[],
  targets?: string[],
): Promise<FundingPreviewResponse> {
  return v2.previewFunding(request.budgetId, {
    ...sourceFields(request),
    ...(overrides !== undefined ? { overrides } : {}),
    ...(targets !== undefined ? { confirmPeriodTargets: targets } : {}),
  });
}

// First preview, then the same preview sealed with overrides = its own lines so
// its hash is the one confirm will recompute.
async function loadPreview(request: FundingEntryRequest): Promise<FundingPreviewResponse> {
  let body = await requestPreview(request);
  if (body.lines.length > 0) {
    body = await requestPreview(request, linesToInputs(body.lines), selectedTargets(body));
  }
  return body;
}

async function start(request: FundingEntryRequest): Promise<void> {
  active = request;
  generation += 1;
  const mine = generation;
  preview.value = null;
  error.value = null;
  lineErrors.value = {};
  pending.value = true;
  open.value = false;
  void reference.load().catch(() => undefined);
  try {
    const body = await loadPreview(request);
    if (mine !== generation) return;
    applyPreview(body);
    open.value = true;
  } catch (cause) {
    if (mine !== generation) return;
    // Opening money is only proposed before the first fact of the budget; later
    // it is simply not offered, which is not worth an error.
    const quiet =
      request.source.sourceKind === 'OPENING' &&
      cause instanceof ApiRequestError &&
      cause.problem.code === 'OPENING_NOT_AVAILABLE';
    if (!quiet) {
      push({
        tone: 'error',
        title: 'Не удалось подготовить распределение',
        description: 'Деньги сохранены. Распределить их можно позже.',
      });
    }
    close();
  } finally {
    if (mine === generation) pending.value = false;
  }
}

// Later/Esc must not drop a confirm that is already on its way to the server.
function later(): void {
  if (confirming) return;
  close();
  push({
    tone: 'info',
    title: 'Деньги остались свободными',
    description: 'Распределить их можно позже: на главной, в строке «Не распределено».',
  });
}

function close(): void {
  generation += 1;
  open.value = false;
  pending.value = false;
  preview.value = null;
  error.value = null;
  lineErrors.value = {};
  active = null;
  entry.dismiss();
  // The control that opened the flow may be gone (dialog closed, list
  // re-rendered), and the dialog then leaves focus on <body>.
  void nextTick(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const main = document.querySelector<HTMLElement>('main');
    if (!main) return;
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    main.focus();
  });
}

async function reload(overrides?: FundingLineInput[], targets?: string[]): Promise<void> {
  const request = active;
  if (!request) return;
  generation += 1;
  const mine = generation;
  pending.value = true;
  try {
    const body =
      overrides === undefined
        ? await loadPreview(request)
        : await requestPreview(request, overrides, targets);
    if (mine !== generation) return;
    lineErrors.value = {};
    applyPreview(body);
  } catch (cause) {
    if (mine !== generation) return;
    error.value = toSheetError(cause) ?? {
      code: 'PREVIEW_FAILED',
      detail: 'Не удалось пересчитать распределение. Повторите попытку.',
    };
  } finally {
    if (mine === generation) pending.value = false;
  }
}

// "10000" and "10000.00" are the same amount.
function sameAmount(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const [whole = '', fraction = ''] = value.split('.');
    return `${whole.replace(/^0+(?=d)/, '')}.${fraction.replace(/0+$/, '')}`;
  };
  return normalize(left) === normalize(right);
}

function changeLine(payload: FundingChangeLinePayload): void {
  const current = preview.value;
  if (!current) return;
  const key = lineKey(payload);
  // Blur re-commits a field that Enter or the typing pause already sent. Recomputing the same
  // amount would only disable "Распределить" for a moment and swallow the click that caused the blur.
  const shown = linesToInputs(current.lines).find((line) => lineKey(line) === key);
  if (shown && !error.value && sameAmount(shown.amount, payload.amount)) return;
  // Replace the edited row in place, matched by lineId, so the server's row
  // order and the identities of the untouched rows survive the recompute.
  void reload(
    linesToInputs(current.lines).map((line): FundingLineInput => {
      if (lineKey(line) !== key) return line;
      return {
        envelopeId: payload.envelopeId,
        ...(payload.lineId !== undefined ? { lineId: payload.lineId } : {}),
        ...(payload.periodId !== undefined ? { periodId: payload.periodId } : {}),
        amount: payload.amount,
      };
    }),
    selectedTargets(current),
  );
}

function togglePeriodTarget(payload: { periodId: string; selected: boolean }): void {
  const current = preview.value;
  if (!current) return;
  const targets = current.periodTargetDrafts
    .filter((draft) =>
      draft.periodId === payload.periodId ? payload.selected : draft.selectedForConfirmation,
    )
    .map((draft) => draft.periodId);
  void reload(linesToInputs(current.lines), targets);
}

async function confirm(): Promise<void> {
  const request = active;
  const current = preview.value;
  if (!request || !current || pending.value) return;
  const body: FundingConfirmRequest = {
    ...sourceFields(request),
    previewHash: current.previewHash,
    confirmPeriodTargets: selectedTargets(current),
    lines: linesToInputs(current.lines),
  };
  generation += 1;
  const mine = generation;
  pending.value = true;
  confirming = true;
  try {
    const result = await v2.confirmFunding(request.budgetId, body, idempotencyKey);
    // The server did assign the money: report it even if the panel has moved
    // on; the generation check only guards the panel state.
    push({ tone: 'success', title: 'Деньги распределены' });
    entry.markConfirmed();
    emit('confirmed', result);
    if (mine === generation) close();
  } catch (cause) {
    if (mine !== generation) return;
    const known = toSheetError(cause);
    if (known) {
      error.value = known;
    } else {
      // Network/5xx: keep the panel and the same key so a retry cannot duplicate.
      push({
        tone: 'error',
        title: 'Не удалось распределить деньги',
        description: 'Повторите попытку: повторное нажатие не создаст дубль.',
      });
    }
  } finally {
    confirming = false;
    if (mine === generation) pending.value = false;
  }
}

const sheetLines = computed(() =>
  (preview.value?.lines ?? []).map((line) => {
    const owner = envelopeOwners.value.get(line.envelopeId);
    // exactOptionalPropertyTypes: the owner key only appears when known.
    return {
      ...line,
      name: lineLabel(line),
      envelopeType: envelopeTypes.value.get(line.envelopeId),
      ...(owner !== undefined ? { owner } : {}),
      error: lineErrors.value[lineKey(line)],
    };
  }),
);

watch(
  () => entry.request.value,
  (request) => {
    if (request === null) return;
    if (request.seq === active?.seq) return;
    void start(request);
  },
  { immediate: true },
);
// Owner captions in the review sheet compare line owners with the current user.
const { userId } = usePermissions();
</script>

<template>
  <FundingReviewSheet
    :current-user-id="userId"
    :open="open"
    :source-kind="preview?.sourceKind"
    :source-minor="preview?.sourceAvailableMinor ?? '0'"
    :period-target-drafts="preview?.periodTargetDrafts ?? []"
    :preview-lines="sheetLines"
    :remaining-minor="preview?.remainingMinor ?? '0'"
    :mandatory-gap-minor="preview?.mandatoryGapMinor ?? '0'"
    :mandatory-due-current-minor="preview?.mandatoryDueCurrentMinor"
    :mandatory-due-next-minor="preview?.mandatoryDueNextMinor"
    :pending="pending"
    :error="error"
    @change-line="changeLine"
    @toggle-period-target="togglePeriodTarget"
    @confirm="confirm"
    @later="later"
    @refresh="reload()"
  />
</template>
