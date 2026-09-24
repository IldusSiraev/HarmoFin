<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { format } from 'date-fns';
import { definePageMeta, navigateTo, useRoute } from '#imports';

import { buildCalendarGrid } from '../../components/plans/calendar-grid.js';
import { buildDayAggregates } from '../../components/plans/day-aggregates.js';
import { computePlanKpi } from '../../components/plans/plan-kpi.js';
import PlanDayPanel, { type DayOperationView } from '../../components/plans/PlanDayPanel.vue';
import PlanForm from '../../components/plans/PlanForm.vue';
import PlanKpiRow from '../../components/plans/PlanKpiRow.vue';
import PlanList from '../../components/plans/PlanList.vue';
import PlansCalendar from '../../components/plans/PlansCalendar.vue';
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../components/ui/Button.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import UiModal from '../../components/ui/Modal.vue';
import { useAuth } from '../../composables/useAuth.js';
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
const confirmation = ref<null | {
  action: 'remove' | 'skip';
  planId?: string;
  occurrenceId?: string;
}>(null);
const mutationKeys = new Map<string, string>();

const budget = computed(() => auth.currentData.value?.workspaces[0]?.budgets[0] ?? null);

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
    await Promise.all([loadReference(), loadRange()]);
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
  formErrors.value = {};
  formOpen.value = true;
}

function openEditPlan(plan: RegularPlanDto) {
  selectedPlan.value = plan;
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
    if (current.action === 'skip' && current.occurrenceId) {
      const key = keyFor(`skip:${current.occurrenceId}`);
      await api.skipPlanOccurrence(budget.value.id, current.occurrenceId, key);
      mutationKeys.delete(`skip:${current.occurrenceId}`);
      statusText.value = 'Данные обновлены на сервере.';
      await loadRange();
    }
  } catch (exception) {
    error.value = errorMessage(exception);
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
        <UiButton data-action="create-plan" @click="openCreate">+ Создать план</UiButton>
      </template>
      <template #content>
        <p v-if="statusText" class="plans-page__status" role="status">{{ statusText }}</p>
        <p v-if="error" class="plans-page__error" role="alert">{{ error }}</p>
        <p v-if="loading">Загрузка планов…</p>
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
              @add-plan="
                selectedPlan = null;
                formErrors = {};
                formOpen = true;
              "
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
      <PlanForm
        :plan="selectedPlan"
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
</style>
