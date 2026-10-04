<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { format } from 'date-fns';
import { AlertTriangle, Plus } from '@lucide/vue';
import { definePageMeta, useRoute } from '#imports';

import PlanDayPanel from '../../components/plans/PlanDayPanel.vue';
import PlanItemList from '../../components/plans/PlanItemList.vue';
import PlanKpiRow from '../../components/plans/PlanKpiRow.vue';
import PlansCalendar from '../../components/plans/PlansCalendar.vue';
import PlanCreateDialog, {
  type PlanCreateSubmit,
} from '../../components/plans/PlanCreateDialog.vue';
import {
  fieldErrorsFromProblem,
  type PlanFormErrors,
  type PlanKind,
} from '../../components/plans/plan-form.js';
import ObligationPaySheet, {
  type ObligationPaySubmit,
} from '../../components/obligations/ObligationPaySheet.vue';
import IncomeRecordSheet, {
  type IncomeRecordSubmit,
} from '../../components/obligations/IncomeRecordSheet.vue';
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../components/ui/Button.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import { useAuth } from '../../composables/useAuth.js';
import {
  type IncomeOccurrenceItem,
  type ObligationOccurrenceItem,
  type PlansCalendarItem,
  type PlansCalendarResponse,
  type TransactionJournalV2Item,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
import { useFundingEntry } from '../../composables/useFundingEntry.js';
import { ApiRequestError } from '../../composables/useApiClient.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import {
  type CategoryDto,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'PlansPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const auth = useAuth();
const route = useRoute();
const api = useBudgetReferenceData();
const v2 = useEnvelopePlanV2();
const fundingEntry = useFundingEntry();

const today = format(new Date(), 'yyyy-MM-dd');

const accounts = ref<Array<{ value: string; label: string }>>([]);
const categories = ref<CategoryDto[]>([]);

const loading = ref(true); // gates only the very first full page load
const hydrated = ref(false);
const pending = ref(false);
const error = ref('');
const statusText = ref('');
const confirmation = ref<null | { action: 'skip'; occurrenceId: string }>(null);
const mutationKeys = new Map<string, string>();

const budget = computed(() => auth.currentData.value?.workspaces[0]?.budgets[0] ?? null);
// Every status, remainder and total comes from the server calendar DTO.
const monthKey = ref(format(new Date(), 'yyyy-MM'));
const monthAnchor = computed(() => `${monthKey.value}-01`);
const selectedDate = ref(today);
const calendar = ref<PlansCalendarResponse | null>(null);
const calendarLoading = ref(false);
const calendarError = ref(false);
const listMode = ref<'upcoming' | 'all'>('upcoming');
const dayFacts = ref<TransactionJournalV2Item[]>([]);
const factsLoading = ref(false);
const factsError = ref(false);
const planListEl = ref<InstanceType<typeof PlanItemList> | null>(null);
let calendarRequest = 0;
let factsRequest = 0;
let referencesLoaded = false;

const calendarDays = computed(() =>
  calendar.value?.month === monthKey.value ? calendar.value.days : [],
);
const calendarItems = computed(() =>
  calendar.value?.month === monthKey.value ? calendar.value.items : [],
);
const overdueItems = computed(() => calendar.value?.overdue ?? []);
const dayItems = computed(() =>
  calendarItems.value.filter((item) => item.scheduledOn === selectedDate.value),
);
const categoryNames = computed(() =>
  Object.fromEntries(categories.value.map((category) => [category.id, category.name])),
);
const payTarget = ref<ObligationOccurrenceItem | null>(null);
const payPending = ref(false);
const payError = ref<string | null>(null);
const payFieldErrors = ref<
  Partial<Record<'amount' | 'accountId' | 'occurredOn' | 'categoryId', string>>
>({});
const EMPTY_PAY_OCCURRENCE = {
  id: '',
  name: '',
  scheduledOn: '',
  expectedMinor: '0',
  categoryId: null,
};
const payOccurrence = computed(() => payTarget.value ?? EMPTY_PAY_OCCURRENCE);
// `?occurrence=` from a notification: highlight that obligation once, no automatic action.
const linkedOccurrenceId = ref<string | null>(null);
let linkApplied = false;
const PAY_ERROR_TEXT: Record<string, string> = {
  OCCURRENCE_NOT_OPEN: 'Обязательство уже закрыто, пропущено или отменено. Обновите список.',
  OCCURRENCE_NOT_PAYABLE: 'Этот план нельзя оплатить: у него нет обязательного конверта.',
  OCCURRENCE_HAS_PAYMENTS: 'По обязательству уже есть оплаты, пропустить его нельзя.',
  INSUFFICIENT_BALANCE: 'На выбранном счёте недостаточно средств.',
  IDEMPOTENCY_CONFLICT: 'Данные оплаты изменились. Проверьте форму и повторите.',
  MODEL_VERSION_MISMATCH: 'Этот бюджет работает по другой модели планов. Обновите страницу.',
};

// v2 expected income: a forecast only. Loading or viewing never creates a
// transaction; only the explicit "Записать доход" action does.
const incomeTarget = ref<IncomeOccurrenceItem | null>(null);
const incomePending = ref(false);
const incomeError = ref<string | null>(null);
const incomeFieldErrors = ref<
  Partial<Record<'amount' | 'accountId' | 'occurredOn' | 'categoryId', string>>
>({});
const EMPTY_INCOME_OCCURRENCE = {
  id: '',
  name: '',
  scheduledOn: '',
  expectedMinor: '0',
  categoryId: null,
};
const incomeOccurrence = computed(() => incomeTarget.value ?? EMPTY_INCOME_OCCURRENCE);
const INCOME_ERROR_TEXT: Record<string, string> = {
  OCCURRENCE_NOT_OPEN: 'Доход по этому плану уже записан или план отключён. Обновите список.',
  IDEMPOTENCY_CONFLICT: 'Данные дохода изменились. Проверьте форму и повторите.',
  MODEL_VERSION_MISMATCH: 'Этот бюджет работает по другой модели планов. Обновите страницу.',
};

// Plan creation. The dialog is always mounted (like the sheets above) so the
// modal can hand focus back to the button that opened it; this page owns the
// request, the Idempotency-Key and the status.
const planDialogOpen = ref(false);
const planDialogKind = ref<PlanKind>('obligation');
const planDialogDate = ref(today);
const planPending = ref(false);
const planError = ref<string | null>(null);
const planFieldErrors = ref<PlanFormErrors>({});
let planAttempt: { fingerprint: string; key: string } | null = null;

const categoryById = computed(
  () => new Map(categories.value.map((category) => [category.id, category])),
);

onMounted(() => {
  hydrated.value = true;
  void loadAll();
});

async function loadAll() {
  if (!budget.value) {
    try {
      await auth.loadMe();
    } catch {
      error.value = 'Не удалось загрузить бюджет.';
    }
  }
  if (!budget.value) {
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    await loadPage(true);
    applyOccurrenceLink();
  } catch {
    // A calendar failure has its own alert with a retry; the generic text is for references.
    if (!calendarError.value) error.value = 'Не удалось загрузить планы. Повторите попытку.';
  } finally {
    loading.value = false;
  }
  // The list renders once loading ends; only then can the linked row scroll into view.
  const linked = linkedOccurrenceId.value;
  if (linked) {
    await nextTick();
    document.getElementById(`obligation-${linked}`)?.scrollIntoView?.({ block: 'center' });
  }
}

async function loadPage(withReference = false): Promise<void> {
  if (!budget.value) return;
  const budgetId = budget.value.id;
  // References load independently: a calendar failure must not skip them.
  const [calendarResult, accountResult, categoryResult] = await Promise.allSettled([
    loadCalendar(),
    withReference ? api.listAccounts(budgetId, 'active') : Promise.resolve(null),
    withReference ? api.listCategories(budgetId, undefined, 'active') : Promise.resolve(null),
  ]);
  if (accountResult.status === 'fulfilled' && accountResult.value) {
    accounts.value = accountResult.value.map((account) => ({
      value: account.id,
      label: account.name,
    }));
  }
  if (categoryResult.status === 'fulfilled' && categoryResult.value) {
    categories.value = categoryResult.value;
  }
  referencesLoaded =
    referencesLoaded ||
    (accountResult.status === 'fulfilled' &&
      categoryResult.status === 'fulfilled' &&
      withReference);
  await loadFacts();
  for (const result of [calendarResult, accountResult, categoryResult]) {
    if (result.status === 'rejected') throw result.reason;
  }
}

async function loadCalendar(): Promise<void> {
  if (!budget.value) return;
  const request = ++calendarRequest;
  calendarLoading.value = true;
  calendarError.value = false;
  try {
    const result = await v2.getPlansCalendar(budget.value.id, monthKey.value);
    if (request !== calendarRequest) return;
    calendar.value = result;
  } catch (exception) {
    if (request === calendarRequest) calendarError.value = true;
    throw exception;
  } finally {
    if (request === calendarRequest) calendarLoading.value = false;
  }
}

// Facts of the selected day; a stale answer (day changed meanwhile) is dropped.
async function loadFacts(): Promise<void> {
  if (!budget.value) return;
  const request = ++factsRequest;
  factsLoading.value = true;
  factsError.value = false;
  try {
    const result = await v2.listTransactions(budget.value.id, {
      from: selectedDate.value,
      to: selectedDate.value,
      status: 'CONFIRMED',
      limit: 50,
    });
    if (request !== factsRequest) return;
    dayFacts.value = result.items;
  } catch {
    if (request === factsRequest) {
      dayFacts.value = [];
      factsError.value = true;
    }
  } finally {
    if (request === factsRequest) factsLoading.value = false;
  }
}

function changeMonth(anchor: string) {
  monthKey.value = anchor.slice(0, 7);
  const reference = calendar.value?.today ?? today;
  selectedDate.value = reference.startsWith(monthKey.value) ? reference : `${monthKey.value}-01`;
  void loadCalendar().catch(() => undefined);
  void loadFacts();
}

function selectDay(date: string) {
  selectedDate.value = date;
  void loadFacts();
}

function retryCalendar() {
  // The first read may have failed together with references and the ?occurrence= link.
  if (!referencesLoaded || !linkApplied) {
    void loadAll();
    return;
  }
  void loadCalendar().catch(() => undefined);
  void loadFacts();
}

async function showOverdue() {
  listMode.value = 'upcoming';
  await nextTick();
  planListEl.value?.focus();
}

function toObligationOccurrence(item: PlansCalendarItem): ObligationOccurrenceItem {
  return {
    id: item.occurrenceId,
    planId: item.planId,
    name: item.name,
    scheduledOn: item.scheduledOn,
    status: item.status as ObligationOccurrenceItem['status'],
    expectedMinor: item.expectedMinor,
    paidMinor: item.paidMinor,
    unpaidMinor: item.unpaidMinor,
    categoryId: item.categoryId,
    envelopeId: null,
  };
}

function toIncomeOccurrence(item: PlansCalendarItem): IncomeOccurrenceItem {
  return {
    id: item.occurrenceId,
    planId: item.planId,
    name: item.name,
    scheduledOn: item.scheduledOn,
    status: item.status,
    expectedMinor: item.expectedMinor,
    categoryId: item.categoryId,
    transactionId: item.transactionId,
  };
}

const onPay = (item: PlansCalendarItem) => openPay(toObligationOccurrence(item));
const onSkip = (item: PlansCalendarItem) => {
  confirmation.value = { action: 'skip', occurrenceId: item.occurrenceId };
};
const onRecordIncome = (item: PlansCalendarItem) => openIncomeRecord(toIncomeOccurrence(item));

function applyOccurrenceLink() {
  if (linkApplied) return;
  linkApplied = true;
  const wanted = route.query.occurrence;
  if (typeof wanted !== 'string') return;
  // Unknown or foreign ids are ignored: the highlight needs a row from the server list.
  const known = [...calendarItems.value, ...overdueItems.value];
  if (!known.some((item) => item.occurrenceId === wanted)) return;
  linkedOccurrenceId.value = wanted;
}

function openPay(item: ObligationOccurrenceItem) {
  payError.value = null;
  payFieldErrors.value = {};
  payTarget.value = item;
}

function closePay() {
  if (payPending.value) return;
  payTarget.value = null;
}

function payErrorText(exception: unknown): string {
  if (exception instanceof ApiRequestError) {
    return (
      PAY_ERROR_TEXT[exception.problem.code] ??
      'Не удалось выполнить оплату. Проверьте данные и повторите попытку.'
    );
  }
  return 'Не удалось выполнить оплату. Повторите попытку.';
}

async function submitPay(input: ObligationPaySubmit) {
  const target = payTarget.value;
  if (!budget.value || !target || payPending.value) return;
  payPending.value = true;
  payError.value = null;
  payFieldErrors.value = {};
  try {
    await v2.payObligation(
      budget.value.id,
      target.id,
      {
        amount: input.amount,
        willPayMore: input.willPayMore,
        accountId: input.accountId,
        categoryId: input.categoryId,
        occurredOn: input.occurredOn,
      },
      input.idempotencyKey,
    );
    payTarget.value = null;
    statusText.value = 'Оплата записана. Данные обновлены на сервере.';
    try {
      await loadPage();
    } catch {
      error.value = 'Оплата записана, но список не обновился. Обновите страницу.';
    }
    // The paid row may have moved or changed; park focus on the list.
    await nextTick();
    planListEl.value?.focus();
  } catch (exception) {
    if (exception instanceof ApiRequestError && exception.problem.fieldErrors?.length) {
      const known = ['amount', 'accountId', 'occurredOn', 'categoryId'] as const;
      for (const field of exception.problem.fieldErrors) {
        const name = known.find((candidate) => candidate === field.field);
        if (name) payFieldErrors.value[name] = field.message;
      }
    }
    payError.value = payErrorText(exception);
  } finally {
    payPending.value = false;
  }
}

function openPlanDialog(kind: PlanKind, date?: string) {
  planDialogDate.value = date ?? today;
  planError.value = null;
  planFieldErrors.value = {};
  planDialogKind.value = kind;
  planDialogOpen.value = true;
}

function closePlanDialog() {
  if (planPending.value) return;
  planDialogOpen.value = false;
}

// One key per unchanged attempt: a retry of the same request reuses it, any
// edit is a different attempt and gets a new one.
function planKeyFor(payload: PlanCreateSubmit): string {
  const fingerprint = JSON.stringify(payload);
  if (planAttempt?.fingerprint !== fingerprint) {
    planAttempt = { fingerprint, key: crypto.randomUUID() };
  }
  return planAttempt.key;
}

async function submitPlan(payload: PlanCreateSubmit) {
  if (!budget.value || planPending.value) return;
  planPending.value = true;
  planError.value = null;
  planFieldErrors.value = {};
  const key = planKeyFor(payload);
  try {
    if (payload.kind === 'obligation') {
      await v2.createObligationPlan(budget.value.id, payload.request, key);
    } else {
      await v2.createIncomePlan(budget.value.id, payload.request, key);
    }
    planAttempt = null;
    planDialogOpen.value = false;
    statusText.value =
      payload.kind === 'obligation'
        ? `Платёж «${payload.request.name}» добавлен.`
        : `Доход «${payload.request.name}» добавлен.`;
    try {
      await loadPage();
    } catch {
      error.value = 'План добавлен, но список не обновился. Обновите страницу.';
    }
    await nextTick();
    planListEl.value?.focus();
  } catch (exception) {
    if (exception instanceof ApiRequestError) {
      const mapped = fieldErrorsFromProblem(exception.problem);
      planFieldErrors.value = mapped.fields;
    }
    planError.value = v2ErrorMessage(exception, 'Не удалось сохранить план. Попробуйте ещё раз.');
  } finally {
    planPending.value = false;
  }
}

function openIncomeRecord(item: IncomeOccurrenceItem) {
  incomeError.value = null;
  incomeFieldErrors.value = {};
  incomeTarget.value = item;
}

function closeIncomeRecord() {
  if (incomePending.value) return;
  incomeTarget.value = null;
}

function incomeErrorText(exception: unknown): string {
  if (exception instanceof ApiRequestError) {
    return (
      INCOME_ERROR_TEXT[exception.problem.code] ??
      'Не удалось записать доход. Проверьте данные и повторите попытку.'
    );
  }
  return 'Не удалось записать доход. Повторите попытку.';
}

async function submitIncomeRecord(input: IncomeRecordSubmit) {
  const target = incomeTarget.value;
  if (!budget.value || !target || incomePending.value) return;
  incomePending.value = true;
  incomeError.value = null;
  incomeFieldErrors.value = {};
  try {
    const result = await v2.recordIncomeOccurrence(
      budget.value.id,
      target.id,
      {
        amount: input.amount,
        accountId: input.accountId,
        categoryId: input.categoryId,
        occurredOn: input.occurredOn,
      },
      input.idempotencyKey,
    );
    incomeTarget.value = null;
    statusText.value = 'Доход записан. Данные обновлены на сервере.';
    try {
      await loadPage();
    } catch {
      error.value = 'Доход записан, но список не обновился. Обновите страницу.';
    }
    await nextTick();
    planListEl.value?.focus();
    // Assignment stays an explicit step: the host only previews and the user
    // confirms. Closing it ("Позже") leaves the recorded income untouched.
    fundingEntry.offer({
      sourceKind: 'INCOME',
      incomeTransactionId: result.transaction.id,
    });
  } catch (exception) {
    if (exception instanceof ApiRequestError && exception.problem.fieldErrors?.length) {
      const known = ['amount', 'accountId', 'occurredOn', 'categoryId'] as const;
      for (const field of exception.problem.fieldErrors) {
        const name = known.find((candidate) => candidate === field.field);
        if (name) incomeFieldErrors.value[name] = field.message;
      }
    }
    incomeError.value = incomeErrorText(exception);
  } finally {
    incomePending.value = false;
  }
}

async function runConfirmation() {
  if (!budget.value || !confirmation.value) return;
  const current = confirmation.value;
  confirmation.value = null;
  pending.value = true;
  error.value = '';
  try {
    const operation = `skip:${current.occurrenceId}`;
    await v2.skipObligationOccurrence(budget.value.id, current.occurrenceId, keyFor(operation));
    mutationKeys.delete(operation);
    statusText.value = 'Данные обновлены на сервере.';
    await loadPage();
    await nextTick();
    planListEl.value?.focus();
  } catch (exception) {
    error.value =
      exception instanceof ApiRequestError
        ? (PAY_ERROR_TEXT[exception.problem.code] ?? errorMessage(exception))
        : errorMessage(exception);
  } finally {
    pending.value = false;
  }
}

function keyFor(operation: string) {
  const existing = mutationKeys.get(operation);
  if (existing) return existing;
  const key = crypto.randomUUID();
  mutationKeys.set(operation, key);
  return key;
}

function errorMessage(exception: unknown) {
  return exception instanceof ApiRequestError
    ? exception.problem.detail
    : 'Не удалось выполнить действие. Повторите попытку.';
}
</script>

<template>
  <div v-if="hydrated" class="plans-page" data-hydrated="true">
    <ReferencePageLayout>
      <template #kicker>Регулярные планы</template>
      <template #title>Планы</template>
      <template #actions>
        <UiButton data-testid="plan-add-obligation" @click="openPlanDialog('obligation')">
          <Plus :size="16" aria-hidden="true" />
          Добавить платёж
        </UiButton>
      </template>
      <template #content>
        <p v-if="statusText" class="plans-page__status" role="status">{{ statusText }}</p>
        <p v-if="error" class="plans-page__error" role="alert">{{ error }}</p>
        <p v-if="loading">Загрузка планов…</p>
        <div v-else-if="budget" class="plans-page__stack">
          <p v-if="calendarError" class="plans-page__error" role="alert">
            Не удалось загрузить календарь.
            <UiButton
              variant="tertiary"
              size="sm"
              data-testid="calendar-retry"
              @click="retryCalendar"
            >
              Повторить
            </UiButton>
          </p>
          <p
            v-if="(calendar?.overdueCount ?? 0) > 0"
            class="plans-page__overdue"
            data-testid="overdue-banner"
          >
            <AlertTriangle :size="16" aria-hidden="true" />
            Просрочено: {{ calendar?.overdueCount }}
            <UiButton variant="tertiary" size="sm" @click="showOverdue">Показать</UiButton>
          </p>
          <PlanKpiRow v-if="calendar" :totals="calendar.totals" />
          <div class="plans-page__board">
            <PlansCalendar
              :month-anchor="monthAnchor"
              :selected-date="selectedDate"
              :today="calendar?.today ?? today"
              :days="calendarDays"
              :loading="calendarLoading"
              @select-day="selectDay"
              @change-month="changeMonth"
            />
            <PlanDayPanel
              :date="selectedDate"
              :items="dayItems"
              :facts="dayFacts"
              :category-names="categoryNames"
              :facts-loading="factsLoading"
              :facts-error="factsError"
              :busy="pending"
              @add-plan="openPlanDialog('obligation', $event)"
              @pay="onPay"
              @skip="onSkip"
              @record-income="onRecordIncome"
              @retry-facts="loadFacts"
            />
          </div>
          <PlanItemList
            ref="planListEl"
            v-model:mode="listMode"
            :items="calendarItems"
            :overdue="overdueItems"
            :today="calendar?.today ?? today"
            :has-any-plans="(calendar?.totals.activePlanCount ?? 0) > 0"
            :busy="pending || payPending || incomePending"
            :linked-id="linkedOccurrenceId"
            @pay="onPay"
            @skip="onSkip"
            @record-income="onRecordIncome"
            @add-plan="openPlanDialog($event)"
          />
        </div>
      </template>
    </ReferencePageLayout>

    <ObligationPaySheet
      :open="payTarget !== null"
      :occurrence="payOccurrence"
      :category-name="categoryById.get(payOccurrence.categoryId ?? '')?.name ?? 'Без категории'"
      :accounts="accounts"
      :today="today"
      :pending="payPending"
      :error="payError"
      :field-errors="payFieldErrors"
      @submit="submitPay"
      @close="closePay"
    />

    <IncomeRecordSheet
      :open="incomeTarget !== null"
      :occurrence="incomeOccurrence"
      :category-name="categoryById.get(incomeOccurrence.categoryId ?? '')?.name ?? 'Без категории'"
      :accounts="accounts"
      :today="today"
      :pending="incomePending"
      :error="incomeError"
      :field-errors="incomeFieldErrors"
      @submit="submitIncomeRecord"
      @close="closeIncomeRecord"
    />

    <PlanCreateDialog
      :open="planDialogOpen"
      :categories="categories"
      :initial-kind="planDialogKind"
      :initial-date="planDialogDate"
      :pending="planPending"
      :error="planError"
      :field-errors="planFieldErrors"
      @submit="submitPlan"
      @close="closePlanDialog"
    />

    <UiConfirmDialog
      :open="confirmation !== null"
      title="Пропустить обязательство?"
      description="Обязательство будет пропущено и перестанет защищать деньги на счетах."
      confirm-label="Подтвердить"
      cancel-label="Отмена"
      variant="primary"
      :loading="pending"
      @confirm="runConfirmation"
      @cancel="confirmation = null"
    />
  </div>
</template>

<style scoped>
.plans-page__status,
.plans-page__error {
  margin: 0 0 var(--hf-space-4);
}
.plans-page__status {
  color: var(--hf-color-text-muted);
}
.plans-page__error {
  color: var(--hf-color-text-danger);
}
.plans-page__stack {
  display: grid;
  gap: var(--hf-space-4);
}
.plans-page__overdue {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hf-space-2);
  margin: 0;
  color: var(--hf-color-text-danger);
  font-weight: var(--hf-font-weight-semibold);
}
.plans-page__board {
  display: grid;
  gap: var(--hf-space-4);
  grid-template-columns: minmax(0, 1fr);
}
@media (min-width: 64rem) {
  .plans-page__board {
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    align-items: start;
  }
}
</style>
