<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { format } from 'date-fns';
import { AlertTriangle, Check, SkipForward, X } from '@lucide/vue';
import { definePageMeta, navigateTo, useRoute } from '#imports';

import { buildCalendarGrid } from '../../components/plans/calendar-grid.js';
import { buildDayAggregates } from '../../components/plans/day-aggregates.js';
import { computePlanKpi } from '../../components/plans/plan-kpi.js';
import PlanDayPanel, { type DayOperationView } from '../../components/plans/PlanDayPanel.vue';
import FinanceMoney from '../../components/finance/FinanceMoney.vue';
import ObligationPaySheet, {
  type ObligationPaySubmit,
} from '../../components/obligations/ObligationPaySheet.vue';
import { formatPlainDateShort } from '../../components/obligations/format-plain-date.js';
import PlanForm from '../../components/plans/PlanForm.vue';
import PlanKpiRow from '../../components/plans/PlanKpiRow.vue';
import PlanList from '../../components/plans/PlanList.vue';
import PlansCalendar from '../../components/plans/PlansCalendar.vue';
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../components/ui/Button.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import UiModal from '../../components/ui/Modal.vue';
import { useAuth } from '../../composables/useAuth.js';
import {
  type ObligationOccurrenceItem,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
import { ApiRequestError } from '../../composables/useApiClient.js';
import {
  type CategoryDto,
  type CreateRegularPlanInput,
  type EnvelopeType,
  type PlanOccurrenceDto,
  type RegularPlanDto,
  type TransactionDto,
  type UpdateRegularPlanInput,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'PlansPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const auth = useAuth();
const route = useRoute();
const api = useBudgetReferenceData();
const v2 = useEnvelopePlanV2();

const today = format(new Date(), 'yyyy-MM-dd');

const plans = ref<RegularPlanDto[]>([]);
const rangeOccurrences = ref<PlanOccurrenceDto[]>([]);
const upcomingOccurrences = ref<PlanOccurrenceDto[]>([]);
const rangeTransactions = ref<TransactionDto[]>([]);
const accounts = ref<Array<{ value: string; label: string }>>([]);
const categories = ref<CategoryDto[]>([]);
const envelopes = ref<Array<{ value: string; label: string; envelopeType?: EnvelopeType }>>([]);

const loading = ref(true); // gates only the very first full page load
const rangeLoading = ref(false); // month-change reload; page content stays mounted
let requestToken = 0;
let deepLinkApplied = false;
const hydrated = ref(false);
const pending = ref(false);
const error = ref('');
const statusText = ref('');
const formErrors = ref<Partial<Record<string, string>>>({});
const formOpen = ref(false);
const listTab = ref<'upcoming' | 'all'>('upcoming');
const monthAnchor = ref(today.slice(0, 8) + '01');
const selectedDate = ref(today);
const selectedPlan = ref<RegularPlanDto | null>(null);
const formPlanType = ref<'INCOME' | 'EXPENSE' | 'SAVINGS'>('EXPENSE');

// Mirrors AppOperationEntryDialog's Расход/Доход/Перевод header tabs —
// Накопление has no direct equivalent there, so it takes the neutral "info"
// accent.
const PLAN_TYPE_TABS: ReadonlyArray<{
  value: 'INCOME' | 'EXPENSE' | 'SAVINGS';
  label: string;
  modifier: string;
}> = [
  { value: 'EXPENSE', label: 'Расход', modifier: 'plan-form-modal__tab--expense' },
  { value: 'INCOME', label: 'Доход', modifier: 'plan-form-modal__tab--income' },
  { value: 'SAVINGS', label: 'Накопление', modifier: 'plan-form-modal__tab--savings' },
];
const confirmation = ref<null | {
  action: 'remove' | 'skip';
  planId?: string;
  occurrenceId?: string;
}>(null);
const mutationKeys = new Map<string, string>();

const budget = computed(() => auth.currentData.value?.workspaces[0]?.budgets[0] ?? null);
// The budget decides the plans model; v1 budgets keep the legacy page below.
const isV2 = computed(() => budget.value?.planModelVersion === 2);

// v2 obligations: every status and remainder comes from the server DTO.
const obligations = ref<ObligationOccurrenceItem[]>([]);
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
const obligationListEl = ref<HTMLElement | null>(null);
const isOpenObligation = (item: ObligationOccurrenceItem) =>
  item.status === 'DUE' || item.status === 'PENDING';
// Open obligations first (overdue stay visible until paid or skipped).
const sortedObligations = computed(() => [
  ...obligations.value.filter(isOpenObligation),
  ...obligations.value.filter((item) => !isOpenObligation(item)),
]);
const obligationStatusLabel: Partial<Record<ObligationOccurrenceItem['status'], string>> = {
  COMPLETED: 'Выполнено',
  SKIPPED: 'Пропущено',
  CANCELLED: 'Отменено',
};
const PAY_ERROR_TEXT: Record<string, string> = {
  OCCURRENCE_NOT_OPEN: 'Обязательство уже закрыто, пропущено или отменено. Обновите список.',
  OCCURRENCE_NOT_PAYABLE: 'Этот план нельзя оплатить: у него нет обязательного конверта.',
  OCCURRENCE_HAS_PAYMENTS: 'По обязательству уже есть оплаты, пропустить его нельзя.',
  INSUFFICIENT_BALANCE: 'На выбранном счёте недостаточно средств.',
  IDEMPOTENCY_CONFLICT: 'Данные оплаты изменились. Проверьте форму и повторите.',
  MODEL_VERSION_MISMATCH: 'Этот бюджет работает по другой модели планов. Обновите страницу.',
};

const grid = computed(() => buildCalendarGrid(monthAnchor.value));
const aggregates = computed(() =>
  buildDayAggregates(rangeTransactions.value, rangeOccurrences.value, today),
);

const monthOccurrences = computed(() =>
  rangeOccurrences.value.filter((occurrence) =>
    occurrence.scheduledOn.startsWith(monthAnchor.value.slice(0, 7)),
  ),
);
const kpi = computed(() =>
  computePlanKpi(monthOccurrences.value, plans.value.filter((plan) => plan.isActive).length),
);

const categoryById = computed(
  () => new Map(categories.value.map((category) => [category.id, category])),
);
const categoryIconById = computed<Record<string, string | null>>(() =>
  Object.fromEntries(categories.value.map((category) => [category.id, category.icon])),
);

const selectedDayOperations = computed<DayOperationView[]>(() =>
  rangeTransactions.value
    .filter((transaction) => transaction.occurredOn === selectedDate.value)
    .map((transaction) => ({
      id: transaction.id,
      categoryName: categoryById.value.get(transaction.categoryId)?.name ?? 'Без категории',
      categoryIcon: categoryById.value.get(transaction.categoryId)?.icon ?? null,
      transactionType: transaction.transactionType,
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
      scale: transaction.scale,
    })),
);
const selectedDayOccurrences = computed(() =>
  rangeOccurrences.value.filter((occurrence) => occurrence.scheduledOn === selectedDate.value),
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
    await (isV2.value ? loadObligations(true) : Promise.all([loadReference(), loadRange()]));
  } catch {
    error.value = 'Не удалось загрузить планы. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

// Reference data does not depend on the visible month — loaded on mount and
// after mutations that change the plans list, never on month navigation.
async function loadReference() {
  if (!budget.value) return;
  const [planData, accountData, categoryData, envelopeData] = await Promise.all([
    api.listRegularPlans(budget.value.id, 'all'),
    api.listAccounts(budget.value.id, 'active'),
    api.listCategories(budget.value.id, undefined, 'active'),
    api.listEnvelopes(budget.value.id, 'active'),
  ]);
  plans.value = planData;
  accounts.value = accountData.map((account) => ({ value: account.id, label: account.name }));
  categories.value = categoryData;
  envelopes.value = envelopeData.map((envelope) => ({
    value: envelope.id,
    label: envelope.name,
    envelopeType: envelope.envelopeType,
  }));
}

async function loadObligations(withReference = false): Promise<void> {
  if (!budget.value) return;
  const budgetId = budget.value.id;
  const [list, accountData, categoryData] = await Promise.all([
    v2.listObligationOccurrences(budgetId, {}),
    withReference ? api.listAccounts(budgetId, 'active') : Promise.resolve(null),
    withReference ? api.listCategories(budgetId, undefined, 'active') : Promise.resolve(null),
  ]);
  obligations.value = list.items;
  if (accountData) {
    accounts.value = accountData.map((account) => ({ value: account.id, label: account.name }));
  }
  if (categoryData) categories.value = categoryData;
}

function isOverdue(item: ObligationOccurrenceItem): boolean {
  return isOpenObligation(item) && item.scheduledOn < today;
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
      await loadObligations();
    } catch {
      error.value = 'Оплата записана, но список не обновился. Обновите страницу.';
    }
    // The paid row may have moved or changed; park focus on the list.
    await nextTick();
    obligationListEl.value?.focus();
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

async function loadRange(): Promise<void> {
  if (!budget.value) return;
  // Request token: two quick month clicks must not let the slower, older
  // response overwrite the newer one.
  const token = ++requestToken;
  rangeLoading.value = true;
  try {
    const from = grid.value[0]?.date ?? monthAnchor.value;
    const to = grid.value[41]?.date ?? monthAnchor.value;
    const [rangeOccurrenceData, dueOccurrenceData, pendingOccurrenceData, transactionData] =
      await Promise.all([
        api.listPlanOccurrences(budget.value.id, { from, to }),
        api.listPlanOccurrences(budget.value.id, { status: 'DUE' }),
        api.listPlanOccurrences(budget.value.id, { status: 'PENDING' }),
        loadAllTransactions(budget.value.id, from, to),
      ]);
    if (token !== requestToken) return;

    rangeOccurrences.value = rangeOccurrenceData;
    upcomingOccurrences.value = [...dueOccurrenceData, ...pendingOccurrenceData];
    rangeTransactions.value = transactionData;

    // A `?occurrence=` deep link is consumed once, on the first completed range
    // load. `upcomingOccurrences` is not range-scoped, so re-running this on
    // every reload would drag the user back to the linked month each time they
    // tried to navigate away.
    if (!deepLinkApplied) {
      const highlighted = String(route.query.occurrence ?? '');
      const target =
        rangeOccurrenceData.find((occurrence) => occurrence.id === highlighted) ??
        upcomingOccurrences.value.find((occurrence) => occurrence.id === highlighted);
      deepLinkApplied = true;
      if (target) {
        const targetMonth = target.scheduledOn.slice(0, 7);
        selectedDate.value = target.scheduledOn;
        if (targetMonth !== monthAnchor.value.slice(0, 7)) {
          monthAnchor.value = `${targetMonth}-01`;
          return loadRange();
        }
      }
    }
  } catch {
    error.value = 'Не удалось загрузить планы. Повторите попытку.';
  } finally {
    if (token === requestToken) rangeLoading.value = false;
  }
}

async function loadAllTransactions(
  budgetId: string,
  from: string,
  to: string,
): Promise<TransactionDto[]> {
  const items: TransactionDto[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await api.listTransactions(budgetId, {
      from,
      to,
      status: 'CONFIRMED',
      limit: 100,
      cursor,
    });
    items.push(...page.items);
    if (!page.nextCursor || page.nextCursor === cursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

function selectDay(date: string) {
  selectedDate.value = date;
}

function changeMonth(nextMonthAnchor: string) {
  monthAnchor.value = nextMonthAnchor;
  reconcileSelectedDate();
  void loadRange();
}

function reconcileSelectedDate() {
  const monthPrefix = monthAnchor.value.slice(0, 7);
  if (selectedDate.value.startsWith(monthPrefix)) return;
  selectedDate.value = today.startsWith(monthPrefix) ? today : `${monthPrefix}-01`;
}

function openCreate() {
  selectedPlan.value = null;
  formPlanType.value = 'EXPENSE';
  formErrors.value = {};
  formOpen.value = true;
}

function openEditPlan(plan: RegularPlanDto) {
  selectedPlan.value = plan;
  formPlanType.value = plan.planType;
  formErrors.value = {};
  formOpen.value = true;
}

function openEditOccurrence(occurrence: PlanOccurrenceDto) {
  const plan = plans.value.find((candidate) => candidate.id === occurrence.planId);
  if (plan) openEditPlan(plan);
}

async function savePlan(input: CreateRegularPlanInput | UpdateRegularPlanInput) {
  if (!budget.value) return;
  pending.value = true;
  error.value = '';
  formErrors.value = {};
  const operation = selectedPlan.value ? `update:${selectedPlan.value.id}` : 'create';
  try {
    if (selectedPlan.value) {
      await api.updateRegularPlan(budget.value.id, selectedPlan.value.id, input, keyFor(operation));
    } else {
      await api.createRegularPlan(
        budget.value.id,
        input as CreateRegularPlanInput,
        keyFor(operation),
      );
    }
    mutationKeys.delete(operation);
    formOpen.value = false;
    selectedPlan.value = null;
    statusText.value = 'План сохранён.';
    await Promise.all([loadReference(), loadRange()]);
  } catch (exception) {
    mapFormError(exception);
  } finally {
    pending.value = false;
  }
}

async function removePlan(planId: string) {
  if (!budget.value) return;
  pending.value = true;
  error.value = '';
  const operation = `remove:${planId}`;
  try {
    await api.deleteRegularPlan(budget.value.id, planId, keyFor(operation));
    mutationKeys.delete(operation);
    formOpen.value = false;
    selectedPlan.value = null;
    statusText.value = 'План удалён.';
    await Promise.all([loadReference(), loadRange()]);
  } catch (exception) {
    error.value = errorMessage(exception);
  } finally {
    pending.value = false;
  }
}

async function completeOccurrence(occurrence: PlanOccurrenceDto) {
  if (!budget.value) return;
  pending.value = true;
  error.value = '';
  const operation = `complete:${occurrence.id}`;
  try {
    await api.completePlanOccurrence(budget.value.id, occurrence.id, keyFor(operation));
    mutationKeys.delete(operation);
    statusText.value = 'Данные обновлены на сервере.';
    await loadRange();
  } catch (exception) {
    error.value = errorMessage(exception);
  } finally {
    pending.value = false;
  }
}

async function draftOccurrence(occurrence: PlanOccurrenceDto) {
  if (!budget.value) return;
  pending.value = true;
  error.value = '';
  const operation = `draft:${occurrence.id}`;
  try {
    const draft = await api.createPlanOccurrenceDraft(
      budget.value.id,
      occurrence.id,
      keyFor(operation),
    );
    await navigateTo(`/app/operations?draftId=${encodeURIComponent(draft.id)}`);
  } catch (exception) {
    error.value = errorMessage(exception);
  } finally {
    pending.value = false;
  }
}

async function runConfirmation() {
  if (!budget.value || !confirmation.value) return;
  const current = confirmation.value;
  confirmation.value = null;
  pending.value = true;
  error.value = '';
  try {
    if (current.action === 'remove' && current.planId) {
      await removePlan(current.planId);
    }
    if (current.action === 'skip' && current.occurrenceId && isV2.value) {
      const operation = `skip:${current.occurrenceId}`;
      await v2.skipObligationOccurrence(budget.value.id, current.occurrenceId, keyFor(operation));
      mutationKeys.delete(operation);
      statusText.value = 'Данные обновлены на сервере.';
      await loadObligations();
    } else if (current.action === 'skip' && current.occurrenceId) {
      const key = keyFor(`skip:${current.occurrenceId}`);
      await api.skipPlanOccurrence(budget.value.id, current.occurrenceId, key);
      mutationKeys.delete(`skip:${current.occurrenceId}`);
      statusText.value = 'Данные обновлены на сервере.';
      await loadRange();
    }
  } catch (exception) {
    error.value =
      isV2.value && exception instanceof ApiRequestError
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

function mapFormError(exception: unknown) {
  if (exception instanceof ApiRequestError) {
    formErrors.value = Object.fromEntries(
      (exception.problem.fieldErrors ?? []).map((field) => [field.field, field.message]),
    );
  }
  error.value = errorMessage(exception);
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
        <UiButton v-if="!isV2" data-action="create-plan" @click="openCreate"
          >+ Создать план</UiButton
        >
      </template>
      <template #content>
        <p v-if="statusText" class="plans-page__status" role="status">{{ statusText }}</p>
        <p v-if="error" class="plans-page__error" role="alert">{{ error }}</p>
        <p v-if="loading">Загрузка планов…</p>
        <section
          v-else-if="budget && isV2"
          ref="obligationListEl"
          class="obligation-list"
          tabindex="-1"
          data-testid="obligation-list"
          aria-label="Обязательные платежи"
        >
          <p v-if="sortedObligations.length === 0" class="obligation-list__empty">
            Обязательных платежей пока нет.
          </p>
          <ul v-else class="obligation-list__items">
            <li
              v-for="item in sortedObligations"
              :key="item.id"
              class="obligation-row"
              :data-testid="`obligation-row-${item.id}`"
            >
              <div class="obligation-row__main">
                <span class="obligation-row__name">{{ item.name }}</span>
                <span class="obligation-row__meta">{{
                  formatPlainDateShort(item.scheduledOn)
                }}</span>
                <span
                  v-if="isOverdue(item)"
                  class="obligation-row__badge"
                  data-testid="obligation-overdue"
                >
                  <AlertTriangle :size="14" aria-hidden="true" />
                  Просрочено
                </span>
                <span v-if="obligationStatusLabel[item.status]" class="obligation-row__meta">
                  {{ obligationStatusLabel[item.status] }}
                </span>
              </div>
              <div class="obligation-row__amounts">
                <FinanceMoney :minor-units="item.expectedMinor" currency="RUB" :scale="2" />
                <span v-if="item.unpaidMinor !== '0'" class="obligation-row__meta">
                  Остаток
                  <FinanceMoney :minor-units="item.unpaidMinor" currency="RUB" :scale="2" />
                </span>
              </div>
              <div v-if="isOpenObligation(item)" class="obligation-row__actions">
                <UiButton
                  variant="tertiary"
                  size="sm"
                  class="obligation-row__icon-btn"
                  :aria-label="`Оплатить ${item.name}`"
                  :title="`Оплатить ${item.name}`"
                  :data-testid="`obligation-pay-${item.id}`"
                  :disabled="pending"
                  @click="openPay(item)"
                >
                  <Check :size="16" aria-hidden="true" />
                </UiButton>
                <UiButton
                  v-if="item.paidMinor === '0'"
                  size="sm"
                  variant="tertiary"
                  class="obligation-row__icon-btn"
                  :aria-label="`Пропустить ${item.name}`"
                  :title="`Пропустить ${item.name}`"
                  :data-testid="`obligation-skip-${item.id}`"
                  :disabled="pending"
                  @click="confirmation = { action: 'skip', occurrenceId: item.id }"
                >
                  <SkipForward :size="16" aria-hidden="true" />
                </UiButton>
              </div>
            </li>
          </ul>
        </section>
        <template v-else-if="budget">
          <PlanKpiRow
            :planned-income-minor="kpi.plannedIncomeMinor"
            :planned-expense-minor="kpi.plannedExpenseMinor"
            :balance-minor="kpi.balanceMinor"
            :total-plans="kpi.totalPlans"
          />

          <div class="plans-page__main">
            <PlansCalendar
              :month-anchor="monthAnchor"
              :selected-date="selectedDate"
              :today="today"
              :aggregates="aggregates"
              :loading="rangeLoading"
              @select-day="selectDay"
              @change-month="changeMonth"
            />

            <PlanDayPanel
              :date="selectedDate"
              :operations="selectedDayOperations"
              :occurrences="selectedDayOccurrences"
              :category-icon-by-id="categoryIconById"
              :pending="pending"
              @complete-occurrence="completeOccurrence"
              @draft-occurrence="draftOccurrence"
              @skip-occurrence="
                (occurrence) => (confirmation = { action: 'skip', occurrenceId: occurrence.id })
              "
              @edit-occurrence="openEditOccurrence"
              @remove-occurrence="
                (occurrence) => (confirmation = { action: 'remove', planId: occurrence.planId })
              "
              @add-plan="openCreate"
            />

            <PlanList
              :active-tab="listTab"
              :upcoming-occurrences="upcomingOccurrences"
              :all-plans="plans"
              :category-icon-by-id="categoryIconById"
              :pending="pending"
              @update:active-tab="listTab = $event"
              @complete-occurrence="completeOccurrence"
              @draft-occurrence="draftOccurrence"
              @skip-occurrence="
                (occurrence) => (confirmation = { action: 'skip', occurrenceId: occurrence.id })
              "
              @edit-occurrence="openEditOccurrence"
              @remove-occurrence="
                (occurrence) => (confirmation = { action: 'remove', planId: occurrence.planId })
              "
              @edit-plan="openEditPlan"
              @remove-plan="(plan) => (confirmation = { action: 'remove', planId: plan.id })"
            />
          </div>
        </template>
      </template>
    </ReferencePageLayout>

    <UiModal
      :open="formOpen"
      :title="selectedPlan ? 'Изменить план' : 'Новый план'"
      @close="formOpen = false"
    >
      <template #header>
        <div class="plan-form-modal__tabs" role="tablist" aria-label="Тип плана">
          <button
            v-for="tab in PLAN_TYPE_TABS"
            :key="tab.value"
            type="button"
            role="tab"
            class="plan-form-modal__tab"
            :class="[tab.modifier, { 'plan-form-modal__tab--active': formPlanType === tab.value }]"
            :aria-selected="formPlanType === tab.value"
            :data-plan-type="tab.value"
            @click="formPlanType = tab.value"
          >
            {{ tab.label }}
          </button>
        </div>
        <button
          type="button"
          class="plan-form-modal__close"
          aria-label="Закрыть"
          @click="formOpen = false"
        >
          <X :size="20" aria-hidden="true" />
        </button>
      </template>

      <PlanForm
        :plan="selectedPlan"
        :plan-type="formPlanType"
        :default-date="selectedDate"
        :accounts="accounts"
        :categories="categories"
        :envelopes="envelopes"
        :errors="formErrors"
        :pending="pending"
        @submit="savePlan"
        @remove="selectedPlan && (confirmation = { action: 'remove', planId: selectedPlan.id })"
      />
    </UiModal>

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

    <UiConfirmDialog
      :open="confirmation !== null"
      :title="confirmation?.action === 'remove' ? 'Удалить план?' : 'Подтвердить действие?'"
      :description="
        confirmation?.action === 'remove'
          ? 'Будущие возникновения будут отменены.'
          : 'Изменения вступят в силу сразу.'
      "
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
.obligation-list__empty {
  margin: 0;
  color: var(--hf-color-text-muted);
}
.obligation-list__items {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.obligation-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-3);
  padding: var(--hf-space-3) var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
}
.obligation-row__main,
.obligation-row__amounts {
  display: grid;
  gap: var(--hf-space-1);
  min-width: 0;
}
.obligation-row__name {
  font-weight: var(--hf-font-weight-medium);
  overflow-wrap: anywhere;
}
.obligation-row__meta {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
.obligation-row__badge {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
}
.obligation-row__icon-btn {
  min-width: 2.75rem;
  min-height: 2.75rem;
  padding-inline: 0;
}
.obligation-list:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}
.obligation-row__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}
.plans-page__main {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--hf-space-4);
  margin-top: var(--hf-space-4);
}
@media (max-width: 61.9375rem) {
  .plans-page__main {
    grid-template-columns: 1fr;
  }
}
.plan-form-modal__tabs {
  display: flex;
  flex: 1;
  justify-content: center;
  gap: var(--hf-space-1);
}
.plan-form-modal__tab {
  min-height: 2.25rem;
  padding: 0 var(--hf-space-3);
  border: none;
  border-radius: var(--hf-radius-xl);
  background: transparent;
  color: var(--hf-color-text-muted);
  font: inherit;
  font-weight: var(--hf-font-weight-medium);
  cursor: pointer;
}
.plan-form-modal__tab:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}
.plan-form-modal__tab--expense.plan-form-modal__tab--active {
  background: var(--hf-color-status-danger-background);
  color: var(--hf-color-status-danger);
}
.plan-form-modal__tab--income.plan-form-modal__tab--active {
  background: var(--hf-color-status-success-background);
  color: var(--hf-color-status-success);
}
.plan-form-modal__tab--savings.plan-form-modal__tab--active {
  background: var(--hf-color-status-info-background);
  color: var(--hf-color-status-info);
}
.plan-form-modal__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  flex-shrink: 0;
  border: none;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text-muted);
  cursor: pointer;
}
.plan-form-modal__close:hover {
  background: var(--hf-color-action-secondary-hover);
  color: var(--hf-color-text);
}
</style>
