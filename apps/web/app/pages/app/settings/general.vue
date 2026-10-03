<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { definePageMeta } from '#imports';

import CyclePreview from '../../../components/settings/CyclePreview.vue';
import ReferencePageLayout from '../../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiCard from '../../../components/ui/Card.vue';
import UiEmptyState from '../../../components/ui/EmptyState.vue';
import UiInfoTooltip from '../../../components/ui/InfoTooltip.vue';
import UiInput from '../../../components/ui/Input.vue';
import UiSelect from '../../../components/ui/Select.vue';
import UiStatus from '../../../components/ui/Status.vue';
import { ApiRequestError } from '../../../composables/useApiClient.js';
import { useAuth } from '../../../composables/useAuth.js';
import {
  type BudgetDto,
  useBudgetReferenceData,
} from '../../../composables/useBudgetReferenceData.js';
import {
  type CycleChangePreviewResponse,
  useEnvelopePlanV2,
} from '../../../composables/useEnvelopePlanV2.js';
import { v2ErrorMessage } from '../../../composables/useV2Error.js';

defineOptions({ name: 'AppSettingsGeneralPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

type GeneralField = 'name' | 'timezone' | 'allowNegativeBalance';
type CycleErrorField = 'cycleStartDay' | 'periodBoundaryOffset';
interface TransitionDecision {
  target: string;
  noTarget: boolean;
}

const { currentData, loadMe } = useAuth();
const api = useBudgetReferenceData();
const planV2 = useEnvelopePlanV2();

const loading = ref(true);
const saving = ref(false);
const loadError = ref('');
const summary = ref('');
const summaryTone = ref<'success' | 'danger'>('success');
const summaryRef = ref<HTMLElement | null>(null);
const fieldErrors = ref<Partial<Record<GeneralField, string>>>({});
const budget = ref<BudgetDto | null>(null);
const form = reactive({
  name: '',
  timezone: '',
  allowNegativeBalance: false,
  cycleStartDay: '',
  periodBoundaryOffset: '',
});

const budgetId = computed(() => currentData.value?.workspaces[0]?.budgets[0]?.id);
// The cycle changes only through a read-only preview and one explicit confirmation.

const cycleErrors = ref<Partial<Record<CycleErrorField, string>>>({});
const preview = ref<CycleChangePreviewResponse | null>(null);
const previewRequest = ref<{ cycleStartDay: number; periodBoundaryOffset: number } | null>(null);
const previewLoading = ref(false);
const confirming = ref(false);
const stale = ref(false);
const decisions = ref<Record<string, TransitionDecision>>({});
const confirmedNote = ref('');
const previewRef = ref<InstanceType<typeof CyclePreview> | null>(null);
const resultRef = ref<HTMLElement | null>(null);

const cycleChanged = computed(
  () =>
    budget.value !== null &&
    (form.cycleStartDay.trim() !== String(budget.value.cycleStartDay) ||
      form.periodBoundaryOffset.trim() !== String(budget.value.periodBoundaryOffset)),
);
const showCycleFlow = computed(() => cycleChanged.value);

// The target is a decimal string passed to the server as is; no money arithmetic here.
const TARGET_PATTERN = /^\d{1,12}([.,]\d{1,2})?$/;

function isValidTarget(value: string): boolean {
  return TARGET_PATTERN.test(value.trim());
}

const decisionErrors = computed(() => {
  const errors: Record<string, string> = {};
  for (const [start, decision] of Object.entries(decisions.value)) {
    if (!decision.noTarget && decision.target.trim() !== '' && !isValidTarget(decision.target)) {
      errors[start] = 'Введите сумму в формате 1500.50 или отметьте «Без фиксированной цели».';
    }
  }
  return errors;
});

const decisionsComplete = computed(() => {
  const ranges = preview.value?.transitionRanges ?? [];
  return ranges.every((range) => {
    const decision = decisions.value[range.start];
    return decision !== undefined && (decision.noTarget || isValidTarget(decision.target));
  });
});

// One Idempotency-Key per user attempt: a retry of the same request reuses it,
// any changed parameter or a new preview starts a new attempt.
let attempt: { fingerprint: string; key: string } | null = null;
function attemptKey(fingerprint: string): string {
  if (attempt?.fingerprint !== fingerprint) {
    attempt = { fingerprint, key: crypto.randomUUID() };
  }
  return attempt.key;
}

const timezoneOptions = computed(() => {
  const zones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [form.timezone || 'UTC'];
  return zones.map((zone) => ({ value: zone, label: zone }));
});

function syncForm(nextBudget: BudgetDto) {
  form.name = nextBudget.name;
  form.timezone = nextBudget.timezone;
  form.allowNegativeBalance = nextBudget.allowNegativeBalance;
  form.cycleStartDay = String(nextBudget.cycleStartDay);
  form.periodBoundaryOffset = String(nextBudget.periodBoundaryOffset);
}

function resetPreview() {
  preview.value = null;
  previewRequest.value = null;
  decisions.value = {};
  stale.value = false;
}

watch(
  () => [form.cycleStartDay, form.periodBoundaryOffset],
  () => {
    if (preview.value) resetPreview();
  },
);

async function loadPage() {
  loading.value = true;
  loadError.value = '';
  try {
    if (!currentData.value) await loadMe();
    const id = budgetId.value;
    if (!id) return;
    budget.value = await api.getBudget(id);
    syncForm(budget.value);
  } catch {
    loadError.value = 'Не удалось загрузить настройки бюджета. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

function getFieldError(field: GeneralField) {
  return fieldErrors.value[field];
}

function getCycleError(field: CycleErrorField) {
  return cycleErrors.value[field];
}

function validateCycle(): { cycleStartDay: number; periodBoundaryOffset: number } | null {
  cycleErrors.value = {};
  const day = Number(form.cycleStartDay);
  const offset = Number(form.periodBoundaryOffset);
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    cycleErrors.value.cycleStartDay = 'Укажите день от 1 до 28.';
  }
  if (!Number.isInteger(offset) || offset < 1 || offset > 27) {
    cycleErrors.value.periodBoundaryOffset = 'Укажите число дней от 1 до 27.';
  }
  return Object.keys(cycleErrors.value).length > 0
    ? null
    : { cycleStartDay: day, periodBoundaryOffset: offset };
}

function settingsPatch() {
  const current = budget.value;
  const patch: { name?: string; allowNegativeAccountBalance?: boolean; timezone?: string } = {};
  if (!current) return patch;
  if (form.name !== current.name) patch.name = form.name;
  if (form.allowNegativeBalance !== current.allowNegativeBalance) {
    patch.allowNegativeAccountBalance = form.allowNegativeBalance;
  }
  if (form.timezone !== current.timezone) patch.timezone = form.timezone;
  return patch;
}

async function reloadBudget(id: string) {
  budget.value = await api.getBudget(id);
  syncForm(budget.value);
}

function applyV2Error(error: unknown) {
  const message = v2ErrorMessage(error, 'Не удалось сохранить настройки. Повторите попытку.');
  if (
    error instanceof ApiRequestError &&
    error.problem.code === 'TIMEZONE_CHANGE_REQUIRES_RECONCILIATION'
  ) {
    fieldErrors.value = { timezone: message };
  }
  summaryTone.value = 'danger';
  summary.value = message;
}

async function saveSettingsV2(id: string) {
  const patch = settingsPatch();
  if (Object.keys(patch).length === 0) return;
  await planV2.updateBudgetSettings(id, patch, attemptKey(`settings:${JSON.stringify(patch)}`));
  attempt = null;
  // Applied: remember it locally so a later cycle retry does not diff (or resend) these fields.
  if (budget.value) {
    budget.value = {
      ...budget.value,
      name: patch.name ?? budget.value.name,
      timezone: patch.timezone ?? budget.value.timezone,
      allowNegativeBalance: patch.allowNegativeAccountBalance ?? budget.value.allowNegativeBalance,
    };
  }
}

async function showError(message: string) {
  summary.value = message;
  summaryTone.value = 'danger';
  await nextTick();
  summaryRef.value?.focus();
}

async function save() {
  const id = budgetId.value;
  if (!id) return;
  if (saving.value || previewLoading.value) return;
  if (cycleChanged.value) {
    await runPreview();
    return;
  }
  saving.value = true;
  summary.value = '';
  fieldErrors.value = {};
  confirmedNote.value = '';
  try {
    await saveSettingsV2(id);
    await reloadBudget(id);
    summaryTone.value = 'success';
    summary.value = 'Общие настройки сохранены.';
  } catch (error) {
    applyV2Error(error);
  } finally {
    saving.value = false;
  }
}

async function runPreview() {
  const id = budgetId.value;
  const input = validateCycle();
  if (!id || !input || previewLoading.value) return;
  previewLoading.value = true;
  summary.value = '';
  fieldErrors.value = {};
  confirmedNote.value = '';
  stale.value = false;
  try {
    const result = await planV2.previewCycleChange(id, input);
    preview.value = result;
    previewRequest.value = input;
    attempt = null;
    decisions.value = Object.fromEntries(
      result.transitionRanges.map((range) => [range.start, { target: '', noTarget: false }]),
    );
    await nextTick();
    previewRef.value?.focusHeading();
  } catch (error) {
    resetPreview();
    await showError(v2ErrorMessage(error, 'Не удалось показать последствия. Повторите попытку.'));
  } finally {
    previewLoading.value = false;
  }
}

function onDecision(periodStart: string, value: TransitionDecision) {
  decisions.value = { ...decisions.value, [periodStart]: value };
}

async function confirmCycle() {
  const id = budgetId.value;
  const current = preview.value;
  const request = previewRequest.value;
  if (!id || !current || !request || confirming.value || !decisionsComplete.value) return;
  confirming.value = true;
  summary.value = '';
  fieldErrors.value = {};
  stale.value = false;
  const body = {
    ...request,
    previewHash: current.previewHash,
    transitionTargets: current.transitionRanges.map((range) => {
      const decision = decisions.value[range.start];
      return {
        periodStart: range.start,
        target: decision && !decision.noTarget ? decision.target.trim().replace(',', '.') : null,
      };
    }),
  };
  try {
    // Settings first: a blocked timezone fails before anything is applied, and a
    // later cycle failure leaves the form with only the cycle still pending.
    await saveSettingsV2(id);
    const result = await planV2.confirmCycleChange(
      id,
      body,
      attemptKey(`cycle:${JSON.stringify(body)}`),
    );
    attempt = null;
    // The date is the server's effectiveOn, sliced as a string (no local Date).
    const [year, month, day] = result.effectiveOn.split('-');
    const confirmedOn = `${day}.${month}.${year}`;
    resetPreview();
    await reloadBudget(id);
    confirmedNote.value = `Изменение цикла подтверждено. Действует с ${confirmedOn}.`;
    await nextTick();
    resultRef.value?.focus();
  } catch (error) {
    if (error instanceof ApiRequestError && error.problem.code === 'PREVIEW_STALE') {
      stale.value = true;
    }
    applyV2Error(error);
    await nextTick();
    summaryRef.value?.focus();
  } finally {
    confirming.value = false;
  }
}

onMounted(() => {
  void loadPage();
});
</script>

<template>
  <template v-if="loading">
    <UiStatus label="Загрузка настроек…" tone="info" aria-live="polite" />
  </template>
  <UiEmptyState v-else-if="loadError" title="Настройки недоступны" :description="loadError">
    <template #action>
      <UiButton @click="loadPage">Повторить</UiButton>
    </template>
  </UiEmptyState>
  <UiEmptyState
    v-else-if="!budget"
    title="Бюджет не выбран"
    description="Создайте или выберите бюджет, чтобы изменить настройки."
  />
  <ReferencePageLayout v-else>
    <template #kicker>Настройки</template>
    <template #title>Общие настройки</template>
    <template #actions>
      <UiButton variant="tertiary" to="/app/settings">← Настройки</UiButton>
    </template>
    <template #content>
      <UiCard as="section">
        <div
          v-if="summary"
          ref="summaryRef"
          class="general-settings-form__result"
          tabindex="-1"
          data-testid="summary-status"
        >
          <UiStatus :label="summary" :tone="summaryTone" aria-live="polite" />
        </div>
        <div
          v-if="confirmedNote"
          ref="resultRef"
          class="general-settings-form__result"
          tabindex="-1"
          role="status"
          data-testid="cycle-confirmed"
        >
          <UiStatus :label="confirmedNote" tone="success" />
        </div>
        <form class="general-settings-form" @submit.prevent="save">
          <UiInput
            v-model="form.name"
            name="name"
            label="Название бюджета"
            :error="getFieldError('name')"
            required
          />
          <UiSelect
            v-model="form.timezone"
            name="timezone"
            label="Часовой пояс"
            searchable
            :options="timezoneOptions"
            tooltip="Часовой пояс используется для расчёта границ финансового месяца и определения «сегодня» на дашборде, в отчётах и планах."
            :error="getFieldError('timezone')"
            required
          />
          <label class="general-settings-form__checkbox">
            <input v-model="form.allowNegativeBalance" type="checkbox" />
            <span>Разрешить уходить в минус</span>
            <UiInfoTooltip
              text="Если выключено, HarmoFin не даст сохранить операцию, которая уведёт счёт или конверт в минус."
            />
          </label>
          <UiInput
            v-model="form.cycleStartDay"
            name="cycleStartDay"
            label="Начало первого периода"
            inputmode="numeric"
            :error="getCycleError('cycleStartDay')"
            required
          />
          <UiInput
            v-model="form.periodBoundaryOffset"
            name="periodBoundaryOffset"
            label="Граница второго периода (дней от начала первого)"
            inputmode="numeric"
            :error="getCycleError('periodBoundaryOffset')"
            required
          />
          <p v-if="showCycleFlow" class="general-settings-form__note">
            Сначала покажем, с какой даты изменение вступит в силу. Ничего не изменится, пока вы не
            подтвердите.
          </p>
          <UiButton type="submit" :loading="saving || previewLoading" data-action="submit-general">
            {{ showCycleFlow ? 'Показать последствия' : 'Сохранить' }}
          </UiButton>
        </form>
        <div v-if="preview && previewRequest" class="general-settings-form__effect">
          <CyclePreview
            ref="previewRef"
            :cycle-start-day="previewRequest.cycleStartDay"
            :period-boundary-offset="previewRequest.periodBoundaryOffset"
            :effective-on="preview.effectiveOn"
            :transition-ranges="preview.transitionRanges"
            :decisions="decisions"
            :errors="decisionErrors"
            @decision="onDecision"
          />
          <div class="general-settings-form__actions">
            <UiButton
              v-if="stale"
              variant="secondary"
              data-action="refresh-cycle-preview"
              :loading="previewLoading"
              @click="runPreview"
            >
              Обновить
            </UiButton>
            <UiButton
              data-action="confirm-cycle-change"
              :loading="confirming"
              :disabled="!decisionsComplete || stale"
              :aria-describedby="decisionsComplete ? undefined : 'cycle-confirm-hint'"
              @click="confirmCycle"
            >
              Подтвердить изменение
            </UiButton>
          </div>
          <p v-if="!decisionsComplete" id="cycle-confirm-hint" class="general-settings-form__note">
            Укажите целевую сумму или отметьте «Без фиксированной цели» для переходного периода.
          </p>
        </div>
      </UiCard>
    </template>
  </ReferencePageLayout>
</template>

<style scoped>
.general-settings-form {
  display: grid;
  gap: var(--hf-space-5);
  margin-top: var(--hf-space-4);
}

.general-settings-form__note {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.general-settings-form__effect {
  display: grid;
  gap: var(--hf-space-4);
  margin-top: var(--hf-space-5);
}

.general-settings-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
}

.general-settings-form__result {
  margin-top: var(--hf-space-3);
}

.general-settings-form__checkbox {
  display: flex;
  align-items: center;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  color: var(--hf-color-text);
}

.general-settings-form__checkbox input {
  width: 1.25rem;
  height: 1.25rem;
}
</style>
