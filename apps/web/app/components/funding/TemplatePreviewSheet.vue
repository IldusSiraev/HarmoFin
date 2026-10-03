<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch, type Component } from 'vue';
import { AlertTriangle, Archive, CircleCheck, Plus, RefreshCw } from '@lucide/vue';

import { ApiRequestError } from '../../composables/useApiClient.js';
import {
  useEnvelopePlanV2,
  type TemplateAction,
  type TemplateApplyRequest,
  type TemplatePreviewResponse,
} from '../../composables/useEnvelopePlanV2.js';
import { useFundingEntry } from '../../composables/useFundingEntry.js';
import UiButton from '../ui/Button.vue';
import UiInfoTooltip from '../ui/InfoTooltip.vue';
import UiModal from '../ui/Modal.vue';

defineOptions({ name: 'TemplatePreviewSheet' });

// The one reference-template panel behind both launch points (settings and the
// onboarding checklist). It shows the server preview, collects optional period
// targets and optional savings, and applies exactly what the preview describes.
// Amounts are typed decimal text passed through as strings: the browser checks
// their shape only and never adds, compares or converts money. The server
// recomputes everything from previewHash. The cycle boundaries are two small
// integers (start day 1-28, first-period length 1-27 days, same limits as the
// API); they are sent with apply only when they differ from the budget's current
// ones and do not affect previewHash. On a used budget the server answers
// CYCLE_CHANGE_REQUIRES_FLOW and the fields turn read-only: that change is a
// separate, confirmed flow in settings.

type PreviewEnvelope = TemplatePreviewResponse['envelopes'][number];
type PeriodRole = 'FIRST' | 'SECOND';
type Role = PeriodRole | 'MANDATORY';

const props = defineProps<{ open: boolean; budgetId: string }>();
const emit = defineEmits<{ close: []; applied: [] }>();

const v2 = useEnvelopePlanV2();
const entry = useFundingEntry();

const AMOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;
const ZERO_AMOUNT = /^0+(?:[.,]0+)?$/;
const PERIOD_ROLES: PeriodRole[] = ['FIRST', 'SECOND'];

const preview = ref<TemplatePreviewResponse | null>(null);
const loading = ref(false);
const noticeEl = ref<HTMLElement | null>(null);
const loadFailed = ref(false);
const pending = ref(false);
const applyError = ref<{ code: string; detail: string } | null>(null);
const fieldErrors = reactive<Record<string, string>>({});

const later = reactive<Record<PeriodRole, boolean>>({ FIRST: true, SECOND: true });
const targets = reactive<Record<PeriodRole, string>>({ FIRST: '', SECOND: '' });
const cycleForm = reactive({ startDay: '', length: '' });
const cycleLocked = ref(false);
const consent = reactive<Record<string, boolean>>({});
const savingsSelected = reactive<Record<string, boolean>>({});
const contributions = reactive<Record<string, string>>({});

let generation = 0;
let lastSignature: string | null = null;
let idempotencyKey = '';

const ERROR_TEXT: Record<string, string> = {
  PREVIEW_STALE: 'Данные изменились после предпросмотра. Обновите его, чтобы продолжить.',
  CYCLE_CHANGE_REQUIRES_FLOW:
    'В бюджете уже есть операции или назначения, поэтому границы цикла здесь не меняются. Остальной шаблон можно применить.',
  TEMPLATE_SAVINGS_UNKNOWN: 'Такого накопления нет в шаблоне. Обновите предпросмотр.',
  IDEMPOTENCY_CONFLICT: 'Это действие уже обрабатывается. Обновите предпросмотр.',
  MODEL_VERSION_MISMATCH: 'Для этого бюджета базовый шаблон недоступен.',
  FORBIDDEN: 'Настроить шаблон может только владелец бюджета.',
  VALIDATION_FAILED: 'Проверьте введённые данные и повторите попытку.',
  TEMPLATE_ADOPT_UNAVAILABLE:
    'Существующий элемент нельзя использовать для шаблона. Обновите предпросмотр.',
  TEMPLATE_ELEMENT_EXISTS: 'Такой элемент уже существует. Обновите предпросмотр.',
  TEMPLATE_NAME_REQUIRED: 'Укажите имя элемента, чтобы создать его.',
  TEMPLATE_NAME_CONFLICT: 'Имя элемента уже занято другим элементом. Обновите предпросмотр.',
};
const GENERIC_ERROR = 'Не удалось применить шаблон. Повторите попытку: дубль не создастся.';

function resetForm(): void {
  later.FIRST = true;
  later.SECOND = true;
  targets.FIRST = '';
  targets.SECOND = '';
  for (const record of [consent, savingsSelected, contributions, fieldErrors] as Array<
    Record<string, unknown>
  >) {
    for (const key of Object.keys(record)) delete record[key];
  }
  cycleLocked.value = false;
  applyError.value = null;
}

function syncCycleForm(): void {
  const cycle = preview.value?.cycle;
  if (!cycle) return;
  cycleForm.startDay = String(cycle.cycleStartDay);
  cycleForm.length = String(cycle.periodBoundaryOffset);
}

function dropIneligibleSavings(): void {
  for (const item of savings.value) {
    if (!savingEligible(item)) delete savingsSelected[item.templateKey];
  }
}

async function loadPreview(keepInput = false): Promise<void> {
  generation += 1;
  const mine = generation;
  loading.value = true;
  loadFailed.value = false;
  applyError.value = null;
  lastSignature = null;
  try {
    const body = await v2.getTemplatePreview(props.budgetId);
    if (mine !== generation) return;
    if (!keepInput) resetForm();
    preview.value = body;
    if (!keepInput) syncCycleForm();
    dropIneligibleSavings();
  } catch {
    if (mine !== generation) return;
    loadFailed.value = true;
  } finally {
    if (mine === generation) loading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void loadPreview();
    else generation += 1;
  },
  { immediate: true },
);

const envelopes = computed(() => preview.value?.envelopes ?? []);
const byRole = (role: Role): PreviewEnvelope | undefined =>
  envelopes.value.find((item) => item.role === role);
const savings = computed(() => envelopes.value.filter((item) => item.role === 'SAVINGS'));
function savingEligible(item: PreviewEnvelope): boolean {
  return item.status === 'MISSING' || item.status === 'EXISTING';
}
const categories = computed(() => preview.value?.categories ?? []);

function categoryCount(status: string): number {
  return categories.value.filter((item) => item.status === status).length;
}
const categoriesNeedAttention = computed(
  () => categoryCount('ARCHIVED') + categoryCount('COLLISION') > 0,
);

interface StatusView {
  label: string;
  icon: Component;
}
function statusView(status: string, emptyEnvelope = false): StatusView {
  switch (status) {
    case 'EXISTING':
      return { label: 'Уже есть', icon: CircleCheck };
    case 'ARCHIVED':
      return { label: 'В архиве, не восстанавливается', icon: Archive };
    case 'COLLISION':
      return { label: 'Конфликт: не меняется', icon: AlertTriangle };
    default:
      return { label: emptyEnvelope ? 'Будет создан (пустой)' : 'Будет создан', icon: Plus };
  }
}

function actionFor(role: Role): TemplateAction {
  const item = byRole(role);
  if (!item) return 'SKIP';
  if (item.status === 'MISSING') return 'CREATE';
  if (item.status === 'EXISTING') return 'ADOPT';
  if (item.status === 'ARCHIVED' && consent[role] === true) return 'CREATE';
  return 'SKIP';
}

function showsTarget(role: PeriodRole): boolean {
  return actionFor(role) === 'CREATE';
}

function onTargetInput(role: PeriodRole): void {
  later[role] = targets[role].trim() === '';
  delete fieldErrors[role];
}

function onLaterChange(role: PeriodRole, checked: boolean): void {
  later[role] = checked;
  if (checked) targets[role] = '';
  delete fieldErrors[role];
}

const CYCLE_DAY_ERROR = 'Укажите день месяца от 1 до 28.';
const CYCLE_LENGTH_ERROR = 'Укажите число дней от 1 до 27.';

function parseCycleNumber(text: string, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= max ? value : null;
}

function onCycleInput(field: 'cycleStartDay' | 'cycleLength'): void {
  delete fieldErrors[field];
}

// Human hint derived from the two inputs; days only, no money.
const secondPeriodHint = computed(() => {
  const start = parseCycleNumber(cycleForm.startDay, 28);
  const length = parseCycleNumber(cycleForm.length, 27);
  if (start === null || length === null) return null;
  const second = start + length;
  return second <= 28
    ? `Второй период начнётся ${second}-го числа.`
    : 'Второй период начнётся в следующем календарном месяце: дата зависит от длины месяца.';
});

function validAmount(text: string): boolean {
  return AMOUNT_PATTERN.test(text) && !ZERO_AMOUNT.test(text);
}

function normalize(text: string): string {
  return text.trim().replace(',', '.');
}

const hasFieldErrors = computed(() => Object.keys(fieldErrors).length > 0);
const isStale = computed(() => applyError.value?.code === 'PREVIEW_STALE');

function buildRequest(): TemplateApplyRequest | null {
  const current = preview.value;
  if (!current) return null;
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key];

  const periods: TemplateApplyRequest['periods'] = PERIOD_ROLES.map((role) => {
    const action = actionFor(role);
    const entryValue: TemplateApplyRequest['periods'][number] = { role, action };
    const text = targets[role].trim();
    if (action === 'CREATE' && !later[role] && text !== '') {
      if (validAmount(text)) entryValue.target = normalize(text);
      else fieldErrors[role] = 'Введите сумму больше нуля, не более двух знаков после запятой.';
    }
    return entryValue;
  });

  const chosen: TemplateApplyRequest['savings'] = [];
  for (const item of savings.value) {
    if (savingsSelected[item.templateKey] !== true || !savingEligible(item)) continue;
    const text = (contributions[item.templateKey] ?? '').trim();
    const row: TemplateApplyRequest['savings'][number] = { name: item.name };
    if (text !== '') {
      if (validAmount(text)) row.requestedContribution = normalize(text);
      else {
        fieldErrors[item.templateKey] =
          'Введите сумму больше нуля, не более двух знаков после запятой.';
      }
    }
    chosen.push(row);
  }

  let cycle: TemplateApplyRequest['cycle'];
  const startDay = parseCycleNumber(cycleForm.startDay, 28);
  const length = parseCycleNumber(cycleForm.length, 27);
  if (startDay === null) fieldErrors['cycleStartDay'] = CYCLE_DAY_ERROR;
  if (length === null) fieldErrors['cycleLength'] = CYCLE_LENGTH_ERROR;
  if (
    startDay !== null &&
    length !== null &&
    (startDay !== current.cycle.cycleStartDay || length !== current.cycle.periodBoundaryOffset)
  ) {
    cycle = { startDay, boundaryOffset: length };
  }

  if (hasFieldErrors.value) return null;
  return {
    previewHash: current.previewHash,
    ...(cycle ? { cycle } : {}),
    periods,
    mandatory: { action: actionFor('MANDATORY') },
    savings: chosen,
  };
}

async function focusFirstInvalid(): Promise<void> {
  await nextTick();
  document
    .querySelector<HTMLElement>(
      '[data-testid^="template-cycle-"][aria-invalid="true"], [data-testid^="template-target-"][aria-invalid="true"], [data-testid^="template-contribution-"][aria-invalid="true"]',
    )
    ?.focus();
}

// The banner sits at the top of the scrolling body while the apply button is
// at the bottom: bring the message into view and give it the focus.
async function revealNotice(): Promise<void> {
  await nextTick();
  const el = noticeEl.value;
  if (!el) return;
  el.scrollIntoView?.({ block: 'nearest' });
  el.focus({ preventScroll: true });
}

async function apply(): Promise<void> {
  if (pending.value || loading.value) return;
  const body = buildRequest();
  if (!body) {
    applyError.value = {
      code: 'FIELDS_INVALID',
      detail: 'Проверьте введённые данные: исправьте поля, отмеченные ошибкой.',
    };
    void revealNotice().then(focusFirstInvalid);
    return;
  }
  applyError.value = null;
  // One key per distinct attempt: the same request retried keeps its key, any
  // change of the input makes it a new attempt.
  const signature = JSON.stringify(body);
  if (signature !== lastSignature) {
    lastSignature = signature;
    idempotencyKey = crypto.randomUUID();
  }
  pending.value = true;
  try {
    await v2.applyTemplate(props.budgetId, body, idempotencyKey);
    lastSignature = null;
    entry.markConfirmed();
    emit('applied');
    emit('close');
  } catch (cause) {
    if (cause instanceof ApiRequestError && cause.status < 500) {
      const code = cause.problem.code;
      applyError.value = { code, detail: ERROR_TEXT[code] ?? GENERIC_ERROR };
      if (code === 'CYCLE_CHANGE_REQUIRES_FLOW') {
        cycleLocked.value = true;
        syncCycleForm();
        for (const key of ['cycleStartDay', 'cycleLength']) delete fieldErrors[key];
      }
    } else {
      applyError.value = { code: 'NETWORK', detail: GENERIC_ERROR };
    }
    void revealNotice();
  } finally {
    pending.value = false;
  }
}

function requestClose(): void {
  if (pending.value) return;
  emit('close');
}
</script>

<template>
  <UiModal :open="open" title="Базовый шаблон бюджета" @close="requestClose">
    <div class="template-sheet">
      <p v-if="loading && !preview" class="template-sheet__muted" role="status">
        Загружаем шаблон…
      </p>

      <div v-else-if="loadFailed && !preview" class="template-sheet__notice" role="alert">
        <AlertTriangle :size="18" aria-hidden="true" />
        <p>Не удалось загрузить шаблон. Повторите попытку.</p>
        <UiButton variant="secondary" size="sm" data-testid="template-retry" @click="loadPreview()">
          Повторить
        </UiButton>
      </div>

      <template v-else-if="preview">
        <div
          v-if="applyError"
          ref="noticeEl"
          class="template-sheet__notice"
          role="alert"
          tabindex="-1"
          data-testid="template-summary"
        >
          <AlertTriangle :size="18" aria-hidden="true" />
          <p>{{ applyError.detail }}</p>
          <UiButton
            v-if="isStale"
            variant="secondary"
            size="sm"
            :disabled="loading"
            data-testid="template-refresh"
            @click="loadPreview(true)"
          >
            <RefreshCw :size="16" aria-hidden="true" />
            Обновить
          </UiButton>
        </div>

        <section class="template-sheet__block" aria-label="Цикл" data-testid="template-cycle">
          <div class="template-sheet__heading-row">
            <h3 class="template-sheet__heading">Цикл</h3>
            <UiInfoTooltip
              label="Что такое финансовый цикл"
              placement="bottom"
              align="start"
              text="Финансовый цикл — период между поступлениями денег, «от зарплаты до зарплаты». Он делится на два периода: аванс и зарплата. Пример: если цикл начинается 10-го числа, то аванс приходит 10-го, а второй период с зарплатой начинается 25-го."
            />
          </div>
          <label class="template-sheet__field">
            <span>Первый период начинается: числа месяца (1–28)</span>
            <input
              v-model="cycleForm.startDay"
              type="text"
              class="template-sheet__input"
              inputmode="numeric"
              autocomplete="off"
              :disabled="cycleLocked"
              data-testid="template-cycle-start"
              :aria-invalid="fieldErrors['cycleStartDay'] ? 'true' : undefined"
              :aria-describedby="
                cycleLocked
                  ? 'template-cycle-locked-note'
                  : fieldErrors['cycleStartDay']
                    ? 'template-err-cycleStartDay'
                    : undefined
              "
              @input="onCycleInput('cycleStartDay')"
            />
          </label>
          <p
            v-if="fieldErrors['cycleStartDay']"
            id="template-err-cycleStartDay"
            class="template-sheet__field-error"
            data-testid="template-error-cycle-start"
          >
            <AlertTriangle :size="14" aria-hidden="true" />
            {{ fieldErrors['cycleStartDay'] }}
          </p>
          <label class="template-sheet__field">
            <span>Первый период длится, дней (1–27)</span>
            <input
              v-model="cycleForm.length"
              type="text"
              class="template-sheet__input"
              inputmode="numeric"
              autocomplete="off"
              :disabled="cycleLocked"
              data-testid="template-cycle-length"
              :aria-invalid="fieldErrors['cycleLength'] ? 'true' : undefined"
              :aria-describedby="
                cycleLocked
                  ? 'template-cycle-locked-note'
                  : fieldErrors['cycleLength']
                    ? 'template-err-cycleLength'
                    : undefined
              "
              @input="onCycleInput('cycleLength')"
            />
          </label>
          <p
            v-if="fieldErrors['cycleLength']"
            id="template-err-cycleLength"
            class="template-sheet__field-error"
            data-testid="template-error-cycle-length"
          >
            <AlertTriangle :size="14" aria-hidden="true" />
            {{ fieldErrors['cycleLength'] }}
          </p>
          <p class="template-sheet__muted" aria-live="polite" data-testid="template-cycle-hint">
            {{ secondPeriodHint ?? '' }}
          </p>
          <p
            v-if="cycleLocked"
            id="template-cycle-locked-note"
            class="template-sheet__muted"
            role="note"
            data-testid="template-cycle-locked"
          >
            Границы цикла уже закреплены операциями и назначениями. Изменить их можно отдельно: в
            настройках, в разделе «Финансовый цикл».
          </p>
          <p v-else class="template-sheet__muted">
            По умолчанию взяты текущие настройки бюджета. Позже их можно изменить в настройках.
          </p>
        </section>

        <section class="template-sheet__block" aria-label="Категории">
          <div class="template-sheet__heading-row">
            <h3 class="template-sheet__heading">Категории</h3>
            <UiInfoTooltip
              label="Что такое категории"
              placement="bottom"
              align="start"
              text="Категории — это «подписи» для доходов и расходов: например, продукты, транспорт, зарплата. По ним потом видно, на что уходят деньги."
            />
          </div>
          <p class="template-sheet__muted" data-testid="template-categories-summary">
            Будет создано: {{ categoryCount('MISSING') }}. Уже есть:
            {{ categoryCount('EXISTING') }}.
            <template v-if="categoriesNeedAttention">
              Не восстанавливаются и не меняются: {{ categoryCount('ARCHIVED') }} в архиве,
              {{ categoryCount('COLLISION') }} в конфликте.
            </template>
          </p>
          <ul v-if="categoriesNeedAttention" class="template-sheet__list">
            <li
              v-for="item in categories.filter(
                (c) => c.status === 'ARCHIVED' || c.status === 'COLLISION',
              )"
              :key="item.templateKey"
              class="template-sheet__row"
            >
              <span class="template-sheet__name">{{ item.name }}</span>
              <span class="template-sheet__status">
                <component :is="statusView(item.status).icon" :size="16" aria-hidden="true" />
                {{ statusView(item.status).label }}
              </span>
            </li>
          </ul>
        </section>

        <section class="template-sheet__block" aria-label="Конверты">
          <div class="template-sheet__heading-row">
            <h3 class="template-sheet__heading">Конверты</h3>
            <UiInfoTooltip
              label="Что такое конверты"
              placement="bottom"
              align="start"
              text="Конверт — это назначение денег на определённую цель. Деньги по-прежнему лежат на ваших счетах, конверт лишь показывает, какая их часть для чего предназначена."
            />
          </div>
          <p class="template-sheet__muted" data-testid="template-envelopes-intro">
            Конверт — назначение денег на цель, а не отдельный кошелёк. Создаваемые конверты пустые:
            денег и платежей в них нет.
          </p>

          <div class="template-sheet__group" data-testid="template-group-periods">
            <div class="template-sheet__heading-row">
              <h4 class="template-sheet__subheading">На обычные траты по периодам</h4>
              <UiInfoTooltip
                label="Что такое конверты периодов"
                placement="bottom"
                align="start"
                text="Конверт периода — деньги на обычные траты внутри периода: еда, транспорт, мелкие покупки. На каждый из двух периодов цикла — свой конверт."
              />
            </div>
            <ul class="template-sheet__list">
              <li
                v-for="role in PERIOD_ROLES"
                :key="role"
                class="template-sheet__item"
                :data-testid="`template-row-${role}`"
              >
                <template v-if="byRole(role)">
                  <div class="template-sheet__row">
                    <span class="template-sheet__name">{{ byRole(role)?.name }}</span>
                    <span class="template-sheet__status">
                      <component
                        :is="statusView(byRole(role)?.status ?? '', true).icon"
                        :size="16"
                        aria-hidden="true"
                      />
                      {{ statusView(byRole(role)?.status ?? '', true).label }}
                    </span>
                  </div>
                  <label
                    v-if="byRole(role)?.status === 'ARCHIVED'"
                    class="template-sheet__check-row"
                  >
                    <input
                      v-model="consent[role]"
                      type="checkbox"
                      class="template-sheet__check"
                      :data-testid="`template-consent-${role}`"
                    />
                    Создать новый вместо архивного
                  </label>
                  <template v-if="showsTarget(role)">
                    <div class="template-sheet__field">
                      <div class="template-sheet__label-row">
                        <label :for="`template-target-field-${role}`">
                          Целевая сумма на период (необязательно)
                        </label>
                        <UiInfoTooltip
                          label="Что такое целевая сумма на период"
                          align="start"
                          text="Сколько вы планируете потратить на обычные расходы в этом периоде. Это ориентир: его можно не указывать сейчас и задать позже."
                        />
                      </div>
                      <input
                        :id="`template-target-field-${role}`"
                        v-model="targets[role]"
                        type="text"
                        class="template-sheet__input"
                        inputmode="decimal"
                        autocomplete="off"
                        placeholder="Сумма, ₽"
                        :data-testid="`template-target-${role}`"
                        :aria-invalid="fieldErrors[role] ? 'true' : undefined"
                        :aria-describedby="fieldErrors[role] ? `template-err-${role}` : undefined"
                        @input="onTargetInput(role)"
                      />
                    </div>
                    <div class="template-sheet__label-row">
                      <label class="template-sheet__check-row">
                        <input
                          type="checkbox"
                          class="template-sheet__check"
                          :checked="later[role]"
                          :data-testid="`template-later-${role}`"
                          @change="onLaterChange(role, ($event.target as HTMLInputElement).checked)"
                        />
                        Укажу позже
                      </label>
                      <UiInfoTooltip
                        label="Что значит «Укажу позже»"
                        align="start"
                        text="Конверт создастся без суммы. Целевую сумму можно задать в любой момент позже."
                      />
                    </div>
                    <p
                      v-if="fieldErrors[role]"
                      :id="`template-err-${role}`"
                      class="template-sheet__field-error"
                      :data-testid="`template-error-${role}`"
                    >
                      <AlertTriangle :size="14" aria-hidden="true" />
                      {{ fieldErrors[role] }}
                    </p>
                  </template>
                  <p v-else-if="byRole(role)?.status === 'EXISTING'" class="template-sheet__muted">
                    Цель и правило существующего конверта не меняются.
                  </p>
                </template>
              </li>
            </ul>
          </div>

          <div
            v-if="byRole('MANDATORY')"
            class="template-sheet__group"
            data-testid="template-group-mandatory"
          >
            <div class="template-sheet__heading-row">
              <h4 class="template-sheet__subheading">Обязательные платежи</h4>
              <UiInfoTooltip
                label="Что такое обязательные платежи"
                placement="bottom"
                align="start"
                text="Обязательные платежи — платежи, которые нельзя пропустить: аренда, коммунальные услуги, кредиты. Для них создаётся отдельный конверт «Обязательные»."
              />
            </div>
            <p class="template-sheet__muted" data-testid="template-envelopes-mandatory-note">
              В конверт «Обязательные» назначаются деньги на аренду, коммунальные услуги и кредиты.
            </p>
            <div class="template-sheet__row" data-testid="template-row-MANDATORY">
              <span class="template-sheet__name">{{ byRole('MANDATORY')?.name }}</span>
              <span class="template-sheet__status">
                <component
                  :is="statusView(byRole('MANDATORY')?.status ?? '', true).icon"
                  :size="16"
                  aria-hidden="true"
                />
                {{ statusView(byRole('MANDATORY')?.status ?? '', true).label }}
              </span>
            </div>
            <label
              v-if="byRole('MANDATORY')?.status === 'ARCHIVED'"
              class="template-sheet__check-row"
            >
              <input
                v-model="consent.MANDATORY"
                type="checkbox"
                class="template-sheet__check"
                data-testid="template-consent-MANDATORY"
              />
              Создать новый вместо архивного
            </label>
          </div>

          <div
            v-if="savings.length > 0"
            class="template-sheet__group"
            data-testid="template-group-savings"
          >
            <div class="template-sheet__heading-row">
              <h4 class="template-sheet__subheading">Накопления по желанию</h4>
              <UiInfoTooltip
                label="Что такое накопления по желанию"
                placement="bottom"
                align="start"
                text="Накопления — цели, на которые вы откладываете деньги: отпуск, автомобиль. Ничего не создаётся, пока вы не отметите нужное."
              />
            </div>
            <p class="template-sheet__muted">
              Отметьте накопления, которые вам нужны: конверт создастся пустым. Если укажете сумму,
              мы будем предлагать откладывать её при каждом новом доходе — решать, откладывать ли,
              вы будете сами.
            </p>
            <ul class="template-sheet__list">
              <li v-for="item in savings" :key="item.templateKey" class="template-sheet__item">
                <div class="template-sheet__row">
                  <label class="template-sheet__check-row">
                    <input
                      v-model="savingsSelected[item.templateKey]"
                      type="checkbox"
                      class="template-sheet__check"
                      :disabled="item.status === 'ARCHIVED' || item.status === 'COLLISION'"
                      :data-testid="`template-savings-${item.templateKey}`"
                    />
                    <span class="template-sheet__name">{{ item.name }}</span>
                  </label>
                  <span class="template-sheet__status">
                    <component
                      :is="statusView(item.status, true).icon"
                      :size="16"
                      aria-hidden="true"
                    />
                    {{ statusView(item.status, true).label }}
                  </span>
                </div>
                <template v-if="savingsSelected[item.templateKey]">
                  <label class="template-sheet__field">
                    <span>Сколько предлагать откладывать (необязательно)</span>
                    <input
                      v-model="contributions[item.templateKey]"
                      type="text"
                      class="template-sheet__input"
                      inputmode="decimal"
                      autocomplete="off"
                      placeholder="Сумма, ₽"
                      :data-testid="`template-contribution-${item.templateKey}`"
                      :aria-invalid="fieldErrors[item.templateKey] ? 'true' : undefined"
                      :aria-describedby="
                        fieldErrors[item.templateKey]
                          ? `template-hint-${item.templateKey} template-err-${item.templateKey}`
                          : `template-hint-${item.templateKey}`
                      "
                    />
                  </label>
                  <p :id="`template-hint-${item.templateKey}`" class="template-sheet__muted">
                    Это только предложение при поступлении дохода, деньги никуда не переводятся.
                  </p>
                  <p
                    v-if="fieldErrors[item.templateKey]"
                    :id="`template-err-${item.templateKey}`"
                    class="template-sheet__field-error"
                    :data-testid="`template-error-${item.templateKey}`"
                  >
                    <AlertTriangle :size="14" aria-hidden="true" />
                    {{ fieldErrors[item.templateKey] }}
                  </p>
                </template>
              </li>
            </ul>
          </div>
        </section>
      </template>
    </div>

    <template #footer>
      <div class="template-sheet__footer">
        <UiButton
          variant="secondary"
          :disabled="pending"
          data-testid="template-cancel"
          @click="requestClose"
        >
          Отмена
        </UiButton>
        <UiButton
          variant="primary"
          :loading="pending"
          :disabled="!preview || loading"
          data-testid="template-apply"
          @click="apply"
        >
          Применить шаблон
        </UiButton>
      </div>
    </template>
  </UiModal>
</template>

<style scoped>
.template-sheet {
  display: grid;
  gap: var(--hf-space-4);
  min-width: 0;
}

.template-sheet__block {
  display: grid;
  gap: var(--hf-space-2);
}

.template-sheet__heading {
  margin: 0;
  font-size: var(--hf-font-size-body);
  line-height: var(--hf-line-height-body);
  font-weight: 700;
}

.template-sheet__subheading {
  margin: var(--hf-space-2) 0 0;
  font-size: var(--hf-font-size-body);
  line-height: var(--hf-line-height-body);
  font-weight: 600;
}

.template-sheet__heading-row,
.template-sheet__label-row {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
}

.template-sheet__text,
.template-sheet__muted {
  margin: 0;
}

.template-sheet__muted {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.template-sheet__notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hf-space-2);
  padding: var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text);
}

.template-sheet__notice p {
  flex: 1 1 12rem;
  margin: 0;
}

.template-sheet__list {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.template-sheet__item {
  display: grid;
  gap: var(--hf-space-2);
  padding: var(--hf-space-3) 0;
  border-bottom: 1px solid var(--hf-color-border);
}

.template-sheet__item:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.template-sheet__block + .template-sheet__block {
  padding-top: var(--hf-space-4);
  border-top: 1px solid var(--hf-color-border);
}

.template-sheet__group {
  display: grid;
  gap: var(--hf-space-2);
  padding: var(--hf-space-3) var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
}

.template-sheet__group > .template-sheet__heading-row:first-child .template-sheet__subheading {
  margin-top: 0;
}

.template-sheet__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-2);
}

.template-sheet__name {
  min-width: 0;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.template-sheet__status {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.template-sheet__field {
  display: grid;
  gap: var(--hf-space-1);
  font-size: var(--hf-font-size-small);
}

.template-sheet__input {
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

.template-sheet__input:focus-visible,
.template-sheet__check:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.template-sheet__input[aria-invalid='true'] {
  border-color: var(--hf-color-border-danger);
}

.template-sheet__check-row {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  min-height: 44px;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  cursor: pointer;
}

.template-sheet__check-row .template-sheet__name {
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-body);
}

.template-sheet__check {
  flex: none;
  width: 1.125rem;
  height: 1.125rem;
  accent-color: var(--hf-color-action-primary);
}

.template-sheet__field-error {
  display: flex;
  align-items: center;
  gap: var(--hf-space-1);
  margin: 0;
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-small);
}

.template-sheet__footer {
  display: flex;
  flex: 1 1 100%;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--hf-space-2);
}
</style>
