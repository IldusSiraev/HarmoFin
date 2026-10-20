<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { AlertTriangle, CircleCheck } from '@lucide/vue';

import {
  type EnvelopePlanDto,
  type FundingRuleType,
  type PutFundingRuleRequest,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
import { ApiRequestError } from '../../composables/useApiClient.js';
import { useBudgetReferenceData } from '../../composables/useBudgetReferenceData.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import UiButton from '../ui/Button.vue';
import UiModal from '../ui/Modal.vue';
import { formatPlainDate } from '../obligations/format-plain-date.js';

defineOptions({ name: 'RuleSettingsSheet' });

// One editing screen for an envelope's funding rule, its current period goal and
// the "income category -> envelope" suggestion. Three independent actions:
// saving the rule or the suggestion never assigns money and never touches the
// confirmed goal; the goal changes only through its own explicit, confirmed
// action. The browser only checks input shape; the server owns every rule and
// answers with field errors, which are shown at the field. Confirmed plan data
// is not kept here: the parent re-reads the list after `changed`.

export interface InitialFundingRule {
  type: FundingRuleType;
  priority: number;
  /** Decimal rubles. */
  fixedAmount?: string;
  percentBasisPoints?: number;
}

const props = defineProps<{
  open: boolean;
  budgetId: string;
  envelope: EnvelopePlanDto | null;
  /** Start date of the envelope's current period; null when the data does not give it. */
  periodStart: string | null;
  initialRule?: InitialFundingRule;
}>();
const emit = defineEmits<{ close: []; changed: [message: string] }>();

const v2 = useEnvelopePlanV2();
const reference = useBudgetReferenceData();

const TYPE_LABELS: Record<FundingRuleType, string> = {
  MANUAL: 'Вручную',
  SUM_OF_PLANS: 'Сумма планов обязательных',
  FIXED_PER_PERIOD: 'Фиксированная цель на период',
  SUGGESTED_FIXED: 'Предлагаемая сумма',
  PERCENT_OF_INCOME: 'Процент от дохода',
};
const TYPE_HINTS: Record<FundingRuleType, string> = {
  MANUAL: 'Сумма предлагается только вручную при распределении.',
  SUM_OF_PLANS: 'Потребность считает сервер по планам обязательных платежей.',
  FIXED_PER_PERIOD:
    'Цель периода: подтверждается отдельно, пока не подтверждена — это предложение.',
  SUGGESTED_FIXED: 'Это предложение, не обязательный взнос.',
  PERCENT_OF_INCOME: 'Доля от поступившего дохода, которую предложит сервер.',
};

const AMOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;
const ZERO_AMOUNT = /^0+(?:[.,]0+)?$/;
const PERCENT_PATTERN = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;
const PRIORITY_PATTERN = /^\d{1,7}$/;
const FIELD_TEXT = {
  priority: 'Приоритет — целое число от 0 до 1 000 000.',
  // The server requires a fixed rule amount above zero (positiveMinor).
  fixedAmount: 'Укажите сумму больше нуля, не более двух знаков после запятой.',
  percentBasisPoints: 'Проценты: введите значение от 0 до 100, не более двух знаков после запятой.',
  type: 'Выберите тип правила.',
} as const;
// The server accepts a period target of zero (non-negative decimal).
const TARGET_TEXT = 'Укажите сумму от нуля, не более двух знаков после запятой.';
const HINT_TEXT = {
  fixed: 'Сумма больше нуля, не более двух знаков после запятой.',
  percent: 'Значение от 0 до 100, не более двух знаков после запятой.',
  target: 'Сумма от нуля, не более двух знаков после запятой.',
} as const;
type RuleField = keyof typeof FIELD_TEXT;

const typeOptions = computed<FundingRuleType[]>(() => {
  const all: FundingRuleType[] = [
    'MANUAL',
    'SUM_OF_PLANS',
    'FIXED_PER_PERIOD',
    'SUGGESTED_FIXED',
    'PERCENT_OF_INCOME',
  ];
  // The server allows SUM_OF_PLANS only for the mandatory envelope.
  return props.envelope?.envelopeType === 'MANDATORY_EXPENSES'
    ? all
    : all.filter((value) => value !== 'SUM_OF_PLANS');
});

const ruleType = ref<FundingRuleType | ''>('');
const priority = ref('');
const fixed = ref('');
const percent = ref('');
const ruleErrors = reactive<Partial<Record<RuleField, string>>>({});
const ruleFormError = ref('');
const ruleStatus = ref('');
const rulePending = ref(false);

const showsFixed = computed(
  () => ruleType.value === 'FIXED_PER_PERIOD' || ruleType.value === 'SUGGESTED_FIXED',
);
const showsPercent = computed(() => ruleType.value === 'PERCENT_OF_INCOME');

function focusTestId(testId: string): void {
  void nextTick(() => {
    document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus();
  });
}
function focusFirstInvalid(): void {
  void nextTick(() => {
    document.querySelector<HTMLElement>('[data-testid^="rule-"][aria-invalid="true"]')?.focus();
  });
}

// Basis points <-> percent text, as integer/string conversion of the input only.
function basisPointsToPercent(value: number): string {
  const whole = Math.trunc(value / 100);
  const fraction = String(value % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(whole) : `${whole}.${fraction}`;
}
function percentToBasisPoints(text: string): number | null {
  const match = PERCENT_PATTERN.exec(text.trim());
  if (!match) return null;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return basisPoints <= 10_000 ? basisPoints : null;
}

// Target
const targetOpen = ref(false);
const targetValue = ref('');
const targetError = ref('');
const targetFormError = ref('');
const targetStatus = ref('');
const targetPending = ref(false);

// Suggestion
const categories = ref<Array<{ id: string; name: string }>>([]);
const categoriesFailed = ref(false);
const suggestionCategory = ref('');
const suggestionError = ref('');
const suggestionFormError = ref('');
const suggestionStatus = ref('');
const suggestionPending = ref(false);

// One Idempotency-Key per distinct attempt; the same payload retried keeps it.
const attempts = new Map<string, { fingerprint: string; key: string }>();
function attemptKey(kind: string, payload: unknown): string {
  const fingerprint = JSON.stringify(payload);
  const known = attempts.get(kind);
  if (known?.fingerprint === fingerprint) return known.key;
  const key = crypto.randomUUID();
  attempts.set(kind, { fingerprint, key });
  return key;
}

function clear(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) delete record[key];
}

function resetAll(): void {
  const rule = props.initialRule;
  ruleType.value = rule?.type ?? '';
  priority.value = rule ? String(rule.priority) : '';
  fixed.value = rule?.fixedAmount ?? '';
  percent.value =
    rule?.percentBasisPoints === undefined ? '' : basisPointsToPercent(rule.percentBasisPoints);
  clear(ruleErrors);
  ruleFormError.value = '';
  ruleStatus.value = '';
  targetOpen.value = false;
  targetValue.value = '';
  targetError.value = '';
  targetFormError.value = '';
  targetStatus.value = '';
  suggestionCategory.value = '';
  suggestionError.value = '';
  suggestionFormError.value = '';
  suggestionStatus.value = '';
  attempts.clear();
}

async function loadCategories(): Promise<void> {
  categoriesFailed.value = false;
  try {
    const items = await reference.listCategories(props.budgetId, 'INCOME', 'active');
    categories.value = items.map((item) => ({ id: item.id, name: item.name }));
  } catch {
    categories.value = [];
    categoriesFailed.value = true;
  }
}

watch(
  () => [props.open, props.envelope?.id] as const,
  ([open]) => {
    if (!open) return;
    resetAll();
    void loadCategories();
  },
  { immediate: true },
);

function onTypeChange(value: string): void {
  ruleType.value = value as FundingRuleType;
  delete ruleErrors.fixedAmount;
  delete ruleErrors.percentBasisPoints;
}

function buildRule(): PutFundingRuleRequest | null {
  clear(ruleErrors);
  const priorityText = priority.value.trim();
  const body: Partial<PutFundingRuleRequest> = {};
  if (ruleType.value === '') ruleErrors.type = FIELD_TEXT.type;
  else body.type = ruleType.value;
  if (PRIORITY_PATTERN.test(priorityText) && Number(priorityText) <= 1_000_000) {
    body.priority = Number(priorityText);
  } else {
    ruleErrors.priority = FIELD_TEXT.priority;
  }
  if (showsFixed.value) {
    const text = fixed.value.trim();
    if (AMOUNT_PATTERN.test(text) && !ZERO_AMOUNT.test(text))
      body.fixedAmount = text.replace(',', '.');
    else ruleErrors.fixedAmount = FIELD_TEXT.fixedAmount;
  }
  if (showsPercent.value) {
    const basisPoints = percentToBasisPoints(percent.value);
    if (basisPoints === null) ruleErrors.percentBasisPoints = FIELD_TEXT.percentBasisPoints;
    else body.percentBasisPoints = basisPoints;
  }
  return Object.keys(ruleErrors).length > 0 ? null : (body as PutFundingRuleRequest);
}

function applyFieldErrors(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  let any = false;
  for (const item of error.problem.fieldErrors ?? []) {
    if (item.field in FIELD_TEXT) {
      ruleErrors[item.field as RuleField] = FIELD_TEXT[item.field as RuleField];
      any = true;
    }
  }
  return any;
}

async function saveRule(): Promise<void> {
  const envelope = props.envelope;
  if (rulePending.value || !envelope) return;
  ruleFormError.value = '';
  ruleStatus.value = '';
  const body = buildRule();
  if (!body) {
    focusFirstInvalid();
    return;
  }
  rulePending.value = true;
  try {
    await v2.updateFundingRule(props.budgetId, envelope.id, body, attemptKey('rule', body));
    attempts.delete('rule');
    ruleStatus.value = 'Правило сохранено. Распределения и остатки не изменились.';
    emit('changed', 'Правило пополнения сохранено.');
  } catch (error) {
    if (applyFieldErrors(error)) {
      focusFirstInvalid();
    } else {
      ruleFormError.value = v2ErrorMessage(
        error,
        'Не удалось сохранить правило. Повторите попытку: дубль не создастся.',
      );
    }
  } finally {
    rulePending.value = false;
  }
}

function openTarget(): void {
  targetOpen.value = true;
  targetValue.value = '';
  targetError.value = '';
  targetFormError.value = '';
  targetStatus.value = '';
  focusTestId('target-input');
}

function cancelTarget(): void {
  if (targetPending.value) return;
  targetOpen.value = false;
  targetError.value = '';
  targetFormError.value = '';
  focusTestId('target-open');
}

async function confirmTarget(): Promise<void> {
  const envelope = props.envelope;
  const periodStart = props.periodStart;
  if (targetPending.value || !envelope || periodStart === null) return;
  const text = targetValue.value.trim();
  targetError.value = '';
  targetFormError.value = '';
  if (!AMOUNT_PATTERN.test(text)) {
    targetError.value = TARGET_TEXT;
    focusTestId('target-input');
    return;
  }
  const body = { target: text.replace(',', '.') };
  targetPending.value = true;
  try {
    await v2.updatePeriodTarget(
      props.budgetId,
      envelope.id,
      periodStart,
      body,
      attemptKey('target', { periodStart, body }),
    );
    attempts.delete('target');
    targetOpen.value = false;
    targetStatus.value = 'Цель текущего периода изменена.';
    focusTestId('target-open');
    emit('changed', 'Цель текущего периода изменена.');
  } catch (error) {
    if (error instanceof ApiRequestError && (error.problem.fieldErrors ?? []).length > 0) {
      targetError.value = TARGET_TEXT;
      focusTestId('target-input');
    } else {
      targetFormError.value = v2ErrorMessage(
        error,
        'Не удалось изменить цель. Повторите попытку: дубль не создастся.',
      );
    }
  } finally {
    targetPending.value = false;
  }
}

async function submitSuggestion(enabled: boolean): Promise<void> {
  const envelope = props.envelope;
  if (suggestionPending.value || !envelope) return;
  suggestionError.value = '';
  suggestionFormError.value = '';
  suggestionStatus.value = '';
  if (enabled && suggestionCategory.value === '') {
    suggestionError.value = 'Выберите категорию дохода.';
    focusTestId('suggestion-category');
    return;
  }
  const body = enabled
    ? { enabled: true, sourceCategoryId: suggestionCategory.value, targetEnvelopeId: envelope.id }
    : { enabled: false, sourceCategoryId: null, targetEnvelopeId: null };
  suggestionPending.value = true;
  try {
    await v2.updateIncomeCategorySuggestion(props.budgetId, body, attemptKey('suggestion', body));
    attempts.delete('suggestion');
    suggestionStatus.value = enabled
      ? 'Предложение сохранено. Деньги не распределены: распределение подтверждается отдельно.'
      : 'Предложение отключено.';
    emit('changed', enabled ? 'Предложение для дохода сохранено.' : 'Предложение отключено.');
  } catch (error) {
    if (error instanceof ApiRequestError && (error.problem.fieldErrors ?? []).length > 0) {
      suggestionError.value = 'Проверьте категорию дохода.';
      focusTestId('suggestion-category');
    } else {
      suggestionFormError.value = v2ErrorMessage(
        error,
        'Не удалось сохранить предложение. Повторите попытку: дубль не создастся.',
      );
    }
  } finally {
    suggestionPending.value = false;
  }
}

function requestClose(): void {
  if (rulePending.value || targetPending.value || suggestionPending.value) return;
  emit('close');
}
</script>

<template>
  <UiModal :open="open" title="Правило пополнения" @close="requestClose">
    <div v-if="envelope" class="rule-sheet">
      <p class="rule-sheet__muted rule-sheet__name">{{ envelope.name }}</p>

      <section class="rule-sheet__block" aria-labelledby="rule-heading">
        <h3 id="rule-heading" class="rule-sheet__heading">Правило</h3>
        <p v-if="!initialRule" class="rule-sheet__muted" data-testid="rule-unknown">
          Текущее правило здесь не показывается: сохранение заменит его.
        </p>

        <label class="rule-sheet__field">
          <span>Тип правила</span>
          <select
            class="rule-sheet__input"
            data-testid="rule-type"
            :value="ruleType"
            :aria-invalid="ruleErrors.type ? 'true' : undefined"
            :aria-describedby="
              ruleErrors.type ? 'rule-type-error rule-type-hint' : 'rule-type-hint'
            "
            @change="onTypeChange(($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>Выберите тип</option>
            <option v-for="value in typeOptions" :key="value" :value="value">
              {{ TYPE_LABELS[value] }}
            </option>
          </select>
        </label>
        <p id="rule-type-hint" class="rule-sheet__muted" data-testid="rule-type-hint">
          {{
            ruleType === '' ? 'Тип определяет, как сервер предлагает сумму.' : TYPE_HINTS[ruleType]
          }}
        </p>

        <label class="rule-sheet__field">
          <span>Приоритет</span>
          <input
            v-model="priority"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            class="rule-sheet__input"
            data-testid="rule-priority"
            :aria-invalid="ruleErrors.priority ? 'true' : undefined"
            :aria-describedby="
              ruleErrors.priority ? 'rule-priority-error rule-priority-hint' : 'rule-priority-hint'
            "
          />
        </label>
        <p
          v-if="ruleErrors.priority"
          id="rule-priority-error"
          class="rule-sheet__error"
          data-testid="rule-priority-error"
        >
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ ruleErrors.priority }}
        </p>
        <p id="rule-priority-hint" class="rule-sheet__muted">
          Приоритет — целое число: конверты с меньшим числом рассматриваются раньше.
        </p>

        <template v-if="showsFixed">
          <label class="rule-sheet__field">
            <span>{{
              ruleType === 'SUGGESTED_FIXED' ? 'Предлагаемая сумма, ₽' : 'Сумма на период, ₽'
            }}</span>
            <input
              v-model="fixed"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              class="rule-sheet__input"
              data-testid="rule-fixed"
              :aria-invalid="ruleErrors.fixedAmount ? 'true' : undefined"
              :aria-describedby="
                ruleErrors.fixedAmount ? 'rule-fixed-error rule-fixed-hint' : 'rule-fixed-hint'
              "
            />
          </label>
          <p id="rule-fixed-hint" class="rule-sheet__muted">{{ HINT_TEXT.fixed }}</p>
          <p
            v-if="ruleErrors.fixedAmount"
            id="rule-fixed-error"
            class="rule-sheet__error"
            data-testid="rule-fixed-error"
          >
            <AlertTriangle :size="14" aria-hidden="true" />
            {{ ruleErrors.fixedAmount }}
          </p>
        </template>

        <template v-if="showsPercent">
          <label class="rule-sheet__field">
            <span>Процент от дохода, %</span>
            <input
              v-model="percent"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              class="rule-sheet__input"
              data-testid="rule-percent"
              :aria-invalid="ruleErrors.percentBasisPoints ? 'true' : undefined"
              :aria-describedby="
                ruleErrors.percentBasisPoints
                  ? 'rule-percent-error rule-percent-hint'
                  : 'rule-percent-hint'
              "
            />
          </label>
          <p id="rule-percent-hint" class="rule-sheet__muted">{{ HINT_TEXT.percent }}</p>
          <p
            v-if="ruleErrors.percentBasisPoints"
            id="rule-percent-error"
            class="rule-sheet__error"
            data-testid="rule-percent-error"
          >
            <AlertTriangle :size="14" aria-hidden="true" />
            {{ ruleErrors.percentBasisPoints }}
          </p>
        </template>

        <p
          v-if="ruleErrors.type"
          id="rule-type-error"
          class="rule-sheet__error"
          data-testid="rule-type-error"
        >
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ ruleErrors.type }}
        </p>
        <p v-if="ruleFormError" class="rule-sheet__error" role="alert" data-testid="rule-error">
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ ruleFormError }}
        </p>
        <p v-if="ruleStatus" class="rule-sheet__ok" role="status" data-testid="rule-status">
          <CircleCheck :size="14" aria-hidden="true" />
          {{ ruleStatus }}
        </p>
        <div class="rule-sheet__actions">
          <UiButton :loading="rulePending" data-testid="rule-save" @click="saveRule">
            Сохранить правило
          </UiButton>
        </div>
        <p class="rule-sheet__muted">
          Изменение правила не меняет распределения, остатки и подтверждённую цель периода.
        </p>
      </section>

      <section class="rule-sheet__block" aria-labelledby="target-heading">
        <h3 id="target-heading" class="rule-sheet__heading">Текущая цель периода</h3>
        <p v-if="periodStart === null" class="rule-sheet__muted" data-testid="target-unavailable">
          Текущая цель периода недоступна для изменения здесь: период этого конверта не определён.
          Новое правило начнёт действовать со следующего периода.
        </p>
        <template v-else>
          <p v-if="!targetOpen" class="rule-sheet__muted">
            Подтверждённая цель текущего периода ({{ formatPlainDate(periodStart ?? '') }}) меняется
            только отдельным действием.
          </p>
          <div v-if="!targetOpen" class="rule-sheet__actions">
            <UiButton variant="secondary" data-testid="target-open" @click="openTarget">
              Изменить текущую цель
            </UiButton>
          </div>
          <template v-else>
            <p class="rule-sheet__warning" role="note" data-testid="target-consequence">
              <AlertTriangle :size="16" aria-hidden="true" />
              Внимание: подтверждённая цель текущего периода изменится на указанную сумму.
              Распределения и остаток конверта не изменятся.
            </p>
            <label class="rule-sheet__field">
              <span>Новая цель периода, ₽</span>
              <input
                v-model="targetValue"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                class="rule-sheet__input"
                data-testid="target-input"
                :aria-invalid="targetError ? 'true' : undefined"
                :aria-describedby="
                  targetError ? 'target-input-error target-input-hint' : 'target-input-hint'
                "
              />
            </label>
            <p id="target-input-hint" class="rule-sheet__muted">{{ HINT_TEXT.target }}</p>
            <p
              v-if="targetError"
              id="target-input-error"
              class="rule-sheet__error"
              data-testid="target-error"
            >
              <AlertTriangle :size="14" aria-hidden="true" />
              {{ targetError }}
            </p>
            <p
              v-if="targetFormError"
              class="rule-sheet__error"
              role="alert"
              data-testid="target-form-error"
            >
              <AlertTriangle :size="14" aria-hidden="true" />
              {{ targetFormError }}
            </p>
            <div class="rule-sheet__actions">
              <UiButton
                :loading="targetPending"
                data-testid="target-confirm"
                @click="confirmTarget"
              >
                Подтвердить изменение цели
              </UiButton>
              <UiButton
                variant="tertiary"
                :disabled="targetPending"
                data-testid="target-cancel"
                @click="cancelTarget"
              >
                Отмена
              </UiButton>
            </div>
          </template>
        </template>
        <p v-if="targetStatus" class="rule-sheet__ok" role="status" data-testid="target-status">
          <CircleCheck :size="14" aria-hidden="true" />
          {{ targetStatus }}
        </p>
      </section>

      <section class="rule-sheet__block" aria-labelledby="suggestion-heading">
        <h3 id="suggestion-heading" class="rule-sheet__heading">Предложение для дохода</h3>
        <p class="rule-sheet__muted">
          При поступлении дохода выбранной категории сервер предложит направить его в этот конверт.
          Это только настройка: распределения не создаются, решение вы подтверждаете сами. Новое
          предложение заменяет прежнее.
        </p>
        <label class="rule-sheet__field">
          <span>Категория дохода</span>
          <select
            v-model="suggestionCategory"
            class="rule-sheet__input"
            data-testid="suggestion-category"
            :aria-invalid="suggestionError ? 'true' : undefined"
            :aria-describedby="suggestionError ? 'suggestion-category-error' : undefined"
          >
            <option value="">Не выбрана</option>
            <option v-for="item in categories" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select>
        </label>
        <div v-if="categoriesFailed" class="rule-sheet__actions" role="status">
          <p class="rule-sheet__muted">Не удалось загрузить категории дохода.</p>
          <UiButton variant="secondary" data-testid="categories-retry" @click="loadCategories">
            Повторить
          </UiButton>
        </div>
        <p
          v-if="suggestionError"
          id="suggestion-category-error"
          class="rule-sheet__error"
          data-testid="suggestion-category-error"
        >
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ suggestionError }}
        </p>
        <p
          v-if="suggestionFormError"
          class="rule-sheet__error"
          role="alert"
          data-testid="suggestion-error"
        >
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ suggestionFormError }}
        </p>
        <p
          v-if="suggestionStatus"
          class="rule-sheet__ok"
          role="status"
          data-testid="suggestion-status"
        >
          <CircleCheck :size="14" aria-hidden="true" />
          {{ suggestionStatus }}
        </p>
        <div class="rule-sheet__actions">
          <UiButton
            :loading="suggestionPending"
            data-testid="suggestion-save"
            @click="submitSuggestion(true)"
          >
            Сохранить предложение
          </UiButton>
          <UiButton
            variant="tertiary"
            :disabled="suggestionPending"
            data-testid="suggestion-off"
            @click="submitSuggestion(false)"
          >
            Отключить предложение
          </UiButton>
        </div>
      </section>
    </div>

    <template #footer>
      <div class="rule-sheet__footer">
        <UiButton variant="secondary" data-testid="rule-close" @click="requestClose">
          Закрыть
        </UiButton>
      </div>
    </template>
  </UiModal>
</template>

<style scoped>
.rule-sheet {
  display: grid;
  gap: var(--hf-space-5);
  min-width: 0;
}

.rule-sheet__block {
  display: grid;
  gap: var(--hf-space-3);
  padding-bottom: var(--hf-space-4);
  border-bottom: 1px solid var(--hf-color-border);
}

.rule-sheet__heading {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}

.rule-sheet__name {
  font-weight: var(--hf-font-weight-semibold);
  overflow-wrap: anywhere;
}

.rule-sheet__muted {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.rule-sheet__field {
  display: grid;
  gap: var(--hf-space-1);
  font-size: var(--hf-font-size-small);
}

.rule-sheet__input {
  min-width: 0;
  min-height: 44px;
  padding: 0 var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
  font-variant-numeric: tabular-nums;
}

.rule-sheet__input:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.rule-sheet__input[aria-invalid='true'] {
  border-color: var(--hf-color-border-danger);
}

.rule-sheet__error,
.rule-sheet__ok,
.rule-sheet__warning {
  display: flex;
  align-items: center;
  gap: var(--hf-space-1);
  margin: 0;
  font-size: var(--hf-font-size-small);
}

.rule-sheet__error {
  color: var(--hf-color-text-danger);
}

.rule-sheet__warning {
  padding: var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text);
}

.rule-sheet__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}

.rule-sheet__footer {
  display: flex;
  flex: 1 1 100%;
  justify-content: flex-end;
}
</style>
