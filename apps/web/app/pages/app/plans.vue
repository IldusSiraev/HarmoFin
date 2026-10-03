<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { format } from 'date-fns';
import { AlertTriangle, Bell, Check, Plus, SkipForward, TrendingUp } from '@lucide/vue';
import { definePageMeta, useRoute } from '#imports';

import FinanceMoney from '../../components/finance/FinanceMoney.vue';
import ObligationPaySheet, {
  type ObligationPaySubmit,
} from '../../components/obligations/ObligationPaySheet.vue';
import IncomeRecordSheet, {
  type IncomeRecordSubmit,
} from '../../components/obligations/IncomeRecordSheet.vue';
import { formatPlainDateShort } from '../../components/obligations/format-plain-date.js';
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../components/ui/Button.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import { useAuth } from '../../composables/useAuth.js';
import {
  type IncomeOccurrenceItem,
  type ObligationOccurrenceItem,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
import { useFundingEntry } from '../../composables/useFundingEntry.js';
import { ApiRequestError } from '../../composables/useApiClient.js';
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
// Obligations: every status and remainder comes from the server DTO.
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
// `?occurrence=` from a notification: highlight that obligation once, no automatic action.
const linkedOccurrenceId = ref<string | null>(null);
let linkApplied = false;
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

// v2 expected income: a forecast only. Loading or viewing never creates a
// transaction; only the explicit "Записать доход" action does.
const incomeOccurrences = ref<IncomeOccurrenceItem[]>([]);
const incomeLoadFailed = ref(false);
const incomeTarget = ref<IncomeOccurrenceItem | null>(null);
const incomePending = ref(false);
const incomeError = ref<string | null>(null);
const incomeFieldErrors = ref<
  Partial<Record<'amount' | 'accountId' | 'occurredOn' | 'categoryId', string>>
>({});
const incomeListEl = ref<HTMLElement | null>(null);
const EMPTY_INCOME_OCCURRENCE = {
  id: '',
  name: '',
  scheduledOn: '',
  expectedMinor: '0',
  categoryId: null,
};
const incomeOccurrence = computed(() => incomeTarget.value ?? EMPTY_INCOME_OCCURRENCE);
const isOpenIncome = (item: IncomeOccurrenceItem) =>
  item.status === 'DUE' || item.status === 'PENDING';
const visibleIncome = computed(() => [
  ...incomeOccurrences.value.filter(isOpenIncome),
  ...incomeOccurrences.value.filter((item) => item.status === 'COMPLETED'),
]);
const INCOME_ERROR_TEXT: Record<string, string> = {
  OCCURRENCE_NOT_OPEN: 'Доход по этому плану уже записан или план отключён. Обновите список.',
  IDEMPOTENCY_CONFLICT: 'Данные дохода изменились. Проверьте форму и повторите.',
  MODEL_VERSION_MISMATCH: 'Этот бюджет работает по другой модели планов. Обновите страницу.',
};

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
    await loadObligations(true);
    applyOccurrenceLink();
  } catch {
    error.value = 'Не удалось загрузить планы. Повторите попытку.';
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

async function loadObligations(withReference = false): Promise<void> {
  if (!budget.value) return;
  const budgetId = budget.value.id;
  const [list, accountData, categoryData, incomeList] = await Promise.all([
    v2.listObligationOccurrences(budgetId, {}),
    withReference ? api.listAccounts(budgetId, 'active') : Promise.resolve(null),
    withReference ? api.listCategories(budgetId, undefined, 'active') : Promise.resolve(null),
    // A failed forecast read must not hide the obligations.
    v2.listIncomeOccurrences(budgetId, {}).catch(() => null),
  ]);
  obligations.value = list.items;
  incomeLoadFailed.value = incomeList === null;
  if (incomeList) incomeOccurrences.value = incomeList.items;
  if (accountData) {
    accounts.value = accountData.map((account) => ({ value: account.id, label: account.name }));
  }
  if (categoryData) categories.value = categoryData;
}

function applyOccurrenceLink() {
  if (linkApplied) return;
  linkApplied = true;
  const wanted = route.query.occurrence;
  if (typeof wanted !== 'string') return;
  // Unknown or foreign ids are ignored: the highlight needs a row from the server list.
  if (!obligations.value.some((item) => item.id === wanted)) return;
  linkedOccurrenceId.value = wanted;
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
      await loadObligations();
    } catch {
      error.value = 'Доход записан, но список не обновился. Обновите страницу.';
    }
    await nextTick();
    incomeListEl.value?.focus();
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
    await loadObligations();
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
      <template #content>
        <p v-if="statusText" class="plans-page__status" role="status">{{ statusText }}</p>
        <p v-if="error" class="plans-page__error" role="alert">{{ error }}</p>
        <p v-if="loading">Загрузка планов…</p>
        <template v-else-if="budget">
          <section
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
                :id="`obligation-${item.id}`"
                :key="item.id"
                class="obligation-row"
                :class="{ 'obligation-row--linked': linkedOccurrenceId === item.id }"
                :aria-current="linkedOccurrenceId === item.id ? 'true' : undefined"
                :data-testid="`obligation-row-${item.id}`"
              >
                <div class="obligation-row__main">
                  <span class="obligation-row__name">{{ item.name }}</span>
                  <span
                    v-if="linkedOccurrenceId === item.id"
                    class="obligation-row__linked"
                    data-testid="obligation-linked"
                  >
                    <Bell :size="14" aria-hidden="true" />
                    Из уведомления
                  </span>
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
          <section
            ref="incomeListEl"
            class="income-list"
            tabindex="-1"
            data-testid="income-list"
            aria-label="Ожидаемые доходы"
          >
            <h2 class="income-list__title">Ожидаемые доходы</h2>
            <p class="income-list__warning">
              <AlertTriangle :size="14" aria-hidden="true" />
              Ожидаемое поступление не защищает текущие обязательства.
            </p>
            <p v-if="incomeLoadFailed" class="plans-page__error" role="alert">
              Не удалось загрузить ожидаемые доходы.
            </p>
            <p v-else-if="visibleIncome.length === 0" class="obligation-list__empty">
              Плановых доходов пока нет.
            </p>
            <ul v-else class="obligation-list__items">
              <li
                v-for="item in visibleIncome"
                :key="item.id"
                class="obligation-row"
                :data-testid="`income-row-${item.id}`"
              >
                <div class="obligation-row__main">
                  <span class="obligation-row__name">{{ item.name }}</span>
                  <span class="obligation-row__meta">{{
                    formatPlainDateShort(item.scheduledOn)
                  }}</span>
                  <span v-if="isOpenIncome(item)" class="income-row__forecast">
                    <TrendingUp :size="14" aria-hidden="true" />
                    Прогноз — не входит в «На счетах»
                  </span>
                  <span v-else class="obligation-row__meta">
                    <Check :size="14" aria-hidden="true" />
                    Записан
                  </span>
                </div>
                <div class="obligation-row__amounts">
                  <FinanceMoney :minor-units="item.expectedMinor" currency="RUB" :scale="2" />
                </div>
                <div v-if="isOpenIncome(item)" class="obligation-row__actions">
                  <UiButton
                    variant="tertiary"
                    size="sm"
                    class="obligation-row__icon-btn"
                    :aria-label="`Записать доход ${item.name}`"
                    :title="`Записать доход ${item.name}`"
                    :data-testid="`income-record-${item.id}`"
                    :disabled="incomePending"
                    @click="openIncomeRecord(item)"
                  >
                    <Plus :size="16" aria-hidden="true" />
                  </UiButton>
                </div>
              </li>
            </ul>
          </section>
        </template>
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
.obligation-row__linked {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  color: var(--hf-color-action-primary-hover);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
}
.obligation-row--linked {
  border-color: var(--hf-color-action-primary);
  box-shadow: 0 0 0 2px var(--hf-color-action-primary);
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
.income-list {
  display: grid;
  gap: var(--hf-space-2);
  margin-top: var(--hf-space-6);
}
.income-list__title {
  margin: 0;
  font-size: var(--hf-font-size-body);
  font-weight: var(--hf-font-weight-semibold);
}
.income-list__warning {
  display: flex;
  align-items: center;
  gap: var(--hf-space-1);
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
.income-row__forecast {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  color: var(--hf-color-status-info);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
}
.income-list:focus-visible,
.obligation-list:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}
.obligation-row__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}
</style>
