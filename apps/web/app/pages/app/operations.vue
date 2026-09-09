<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { definePageMeta, navigateTo, useRoute } from '#imports';

import IncomeAllocationForm from '../../components/operations/IncomeAllocationForm.vue';
import OperationCard from '../../components/operations/OperationCard.vue';
import OperationDetails from '../../components/operations/OperationDetails.vue';
import OperationForm from '../../components/operations/OperationForm.vue';
import UiButton from '../../components/ui/Button.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiInput from '../../components/ui/Input.vue';
import UiSelect from '../../components/ui/Select.vue';
import {
  createOperationForm,
  type OperationFormModel,
} from '../../composables/useOperationForm.js';
import {
  type AuditEventDto,
  type CreateTransactionInput,
  type IncomeAllocationDto,
  type TransactionDto,
  type UpdateTransactionInput,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';
import { useAuth } from '../../composables/useAuth.js';
import { ApiRequestError } from '../../composables/useApiClient.js';

defineOptions({ name: 'OperationsJournalPage' });
definePageMeta({ middleware: 'auth' });

type ConfirmationAction =
  'confirm' | 'cancel' | 'delete' | 'restore' | 'create' | 'update' | 'resolveDelete';
type Filters = {
  search: string;
  type: '' | 'INCOME' | 'EXPENSE';
  status: '' | 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED' | 'all';
  from: string;
  to: string;
  cycleStart: string;
  periodStart: string;
  accountId: string;
  categoryId: string;
  envelopeId: string;
  sortBy: 'occurredOn' | 'amount';
  sortDirection: 'asc' | 'desc';
};

const auth = useAuth();
const route = useRoute();
const api = useBudgetReferenceData();
const transactions = ref<TransactionDto[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(true);
const hydrated = ref(false);
const pending = ref(false);
const error = ref('');
const formErrors = ref<Partial<Record<string, string>>>({});
const statusText = ref('');
const rejectedProposalIds = ref<Set<string>>(new Set());
const formOpen = ref(false);
const form = ref<OperationFormModel>(createOperationForm());
const selectedTransaction = ref<TransactionDto | null>(null);
const detailsTransaction = ref<TransactionDto | null>(null);
const allocations = ref<IncomeAllocationDto[]>([]);
const auditEvents = ref<AuditEventDto[]>([]);
const mutationKeys = new Map<string, string>();
const confirmation = ref<null | {
  action: ConfirmationAction;
  transaction: TransactionDto | null;
  input?: CreateTransactionInput | UpdateTransactionInput;
  allocationResolution?: 'CANCEL' | 'DELETE';
}>(null);
const filters = ref<Filters>(filtersFromQuery(route.query));
let requestVersion = 0;

const budget = computed(() => auth.currentData.value?.workspaces[0]?.budgets[0] ?? null);
const accounts = ref<Array<{ value: string; label: string }>>([]);
const categories = ref<
  Array<{
    id: string;
    budgetId: string;
    templateKey: string | null;
    name: string;
    categoryType: 'INCOME' | 'EXPENSE';
    parentId: string | null;
    displayOrder: number;
    comment: string | null;
    archivedAt: string | null;
  }>
>([]);
const envelopes = ref<Array<{ value: string; label: string }>>([]);

onMounted(() => {
  hydrated.value = true;
  void load();
});

async function load(append = false) {
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
  const version = ++requestVersion;
  loading.value = true;
  error.value = '';
  try {
    const [result, accountData, categoryData, envelopeData] = await Promise.all([
      api.listTransactions(budget.value.id, {
        ...transactionFilters(),
        ...(append && nextCursor.value ? { cursor: nextCursor.value } : {}),
      }),
      api.listAccounts(budget.value.id, 'active'),
      api.listCategories(budget.value.id, undefined, 'active'),
      api.listEnvelopes(budget.value.id, 'active'),
    ]);
    if (version !== requestVersion) return;
    transactions.value = append ? [...transactions.value, ...result.items] : result.items;
    nextCursor.value = result.nextCursor;
    accounts.value = accountData.map((item) => ({ value: item.id, label: item.name }));
    categories.value = categoryData;
    envelopes.value = envelopeData.map((item) => ({ value: item.id, label: item.name }));
    await preloadDraft();
  } catch {
    if (version === requestVersion)
      error.value = 'Не удалось загрузить операции. Повторите попытку.';
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}

async function preloadDraft() {
  if (!budget.value || selectedTransaction.value || formOpen.value) return;
  const draftId = typeof route.query.draftId === 'string' ? route.query.draftId : null;
  if (!draftId || !isUuid(draftId)) return;
  try {
    const draft = await api.getTransaction(budget.value.id, draftId);
    if (draft.status !== 'DRAFT') return;
    openEdit(draft);
  } catch {
    error.value = 'Не удалось открыть черновик операции.';
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function openCreate() {
  form.value = createOperationForm();
  formErrors.value = {};
  selectedTransaction.value = null;
  formOpen.value = true;
}

function openEdit(transaction: TransactionDto) {
  form.value = createOperationForm(transaction);
  formErrors.value = {};
  selectedTransaction.value = transaction;
  formOpen.value = true;
}

async function openDetails(transaction: TransactionDto) {
  if (!budget.value) return;
  detailsTransaction.value = transaction;
  try {
    const [allocationData, auditData] = await Promise.all([
      transaction.transactionType === 'INCOME'
        ? api.listTransactionAllocations(budget.value.id, transaction.id)
        : Promise.resolve([]),
      api.listTransactionAudit(budget.value.id, transaction.id).catch(() => []),
    ]);
    if (detailsTransaction.value?.id !== transaction.id) return;
    allocations.value = allocationData;
    auditEvents.value = auditData;
  } catch {
    error.value = 'Не удалось загрузить детали операции.';
  }
}

function mapFormError(exception: unknown): string {
  if (!(exception instanceof ApiRequestError))
    return 'Не удалось сохранить операцию. Повторите попытку.';
  const fieldErrors = Object.fromEntries(
    (exception.problem.fieldErrors ?? []).map((field) => [field.field, field.message]),
  );
  if (
    Object.keys(fieldErrors).length === 0 &&
    exception.problem.code === 'VALIDATION_FAILED' &&
    /денеж|знак/iu.test(exception.problem.detail)
  ) {
    fieldErrors.amount = exception.problem.detail;
  }
  formErrors.value = fieldErrors;
  return Object.keys(fieldErrors).length > 0
    ? 'Укажите данные формы.'
    : exception instanceof ApiRequestError
      ? exception.problem.detail
      : 'Не удалось сохранить операцию. Повторите попытку.';
}

function receiveForm(input: CreateTransactionInput | UpdateTransactionInput) {
  if (selectedTransaction.value) {
    confirmation.value = { action: 'update', transaction: selectedTransaction.value, input };
    return;
  }
  const createInput = input as CreateTransactionInput;
  if (createInput.status === 'CONFIRMED') {
    confirmation.value = { action: 'create', transaction: null, input: createInput };
    return;
  }
  void saveCreate(createInput);
}

async function saveCreate(input: CreateTransactionInput) {
  if (!budget.value) return;
  pending.value = true;
  error.value = '';
  formErrors.value = {};
  const key = keyFor('create');
  try {
    await api.createTransaction(budget.value.id, input, key);
    mutationKeys.delete('create');
    formOpen.value = false;
    statusText.value = input.status === 'DRAFT' ? 'Черновик сохранён.' : 'Операция подтверждена.';
    await load();
  } catch (exception) {
    error.value = mapFormError(exception);
  } finally {
    pending.value = false;
  }
}

function ask(
  action: Exclude<ConfirmationAction, 'create' | 'update'>,
  transaction: TransactionDto,
) {
  confirmation.value = { action, transaction };
}

async function runConfirmation() {
  const current = confirmation.value;
  if (!current || !budget.value) return;
  confirmation.value = null;
  if (current.action === 'create' && current.input) {
    await saveCreate(current.input as CreateTransactionInput);
    return;
  }
  if (!current.transaction) return;
  pending.value = true;
  error.value = '';
  try {
    const operation = `${current.action}:${current.transaction.id}`;
    const key = keyFor(operation);
    if (current.action === 'update' && current.input) {
      await api.updateTransaction(
        budget.value.id,
        current.transaction.id,
        current.input as UpdateTransactionInput,
        key,
      );
      formOpen.value = false;
      selectedTransaction.value = null;
    }
    if (current.action === 'confirm')
      await api.confirmTransaction(budget.value.id, current.transaction.id, key);
    if (current.action === 'cancel')
      await api.cancelTransaction(budget.value.id, current.transaction.id, key);
    if (current.action === 'delete')
      await api.deleteTransaction(budget.value.id, current.transaction.id, key);
    if (current.action === 'restore')
      await api.restoreTransaction(budget.value.id, current.transaction.id, key);
    if (current.action === 'resolveDelete')
      await api.deleteTransactionWithAllocations(
        budget.value.id,
        current.transaction.id,
        { allocationResolution: current.allocationResolution ?? 'DELETE' },
        key,
      );
    mutationKeys.delete(operation);
    statusText.value = 'Данные обновлены на сервере.';
    await load();
  } catch (exception) {
    if (
      current.action === 'delete' &&
      exception instanceof ApiRequestError &&
      exception.problem.code === 'INCOME_HAS_CONFIRMED_ALLOCATIONS'
    ) {
      statusText.value = 'Удалите связанные распределения, чтобы удалить доход.';
      confirmation.value = {
        action: 'resolveDelete',
        transaction: current.transaction,
        allocationResolution: 'DELETE',
      };
      return;
    }
    error.value = mapFormError(exception);
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

function applyFilters() {
  void navigateTo({ query: filterQuery() }, { replace: true });
  void load();
}

function filterQuery() {
  return Object.fromEntries(
    Object.entries({
      ...transactionFilters(),
      sortBy: filters.value.sortBy === 'occurredOn' ? undefined : filters.value.sortBy,
      sortDirection:
        filters.value.sortDirection === 'desc' ? undefined : filters.value.sortDirection,
    }).filter(([, value]) => value !== '' && value !== undefined),
  );
}

function filtersFromQuery(
  query: Record<string, string | null | Array<string | null> | undefined>,
): Filters {
  const value = (name: string) => {
    const candidate = query[name];
    return typeof candidate === 'string' ? candidate : '';
  };
  const type = value('type');
  const status = value('status');
  const sortBy = value('sortBy');
  const sortDirection = value('sortDirection');
  return {
    search: value('search'),
    type: type === 'INCOME' || type === 'EXPENSE' ? type : '',
    status: ['DRAFT', 'CONFIRMED', 'CANCELLED', 'DELETED', 'all'].includes(status)
      ? (status as Filters['status'])
      : '',
    from: value('from'),
    to: value('to'),
    cycleStart: value('cycleStart'),
    periodStart: value('periodStart'),
    accountId: value('accountId'),
    categoryId: value('categoryId'),
    envelopeId: value('envelopeId'),
    sortBy: sortBy === 'amount' ? 'amount' : 'occurredOn',
    sortDirection: sortDirection === 'asc' ? 'asc' : 'desc',
  };
}
function transactionFilters() {
  return {
    ...(filters.value.search ? { search: filters.value.search } : {}),
    ...(filters.value.type ? { type: filters.value.type } : {}),
    ...(filters.value.status ? { status: filters.value.status } : {}),
    ...(filters.value.from ? { from: filters.value.from } : {}),
    ...(filters.value.to ? { to: filters.value.to } : {}),
    ...(filters.value.cycleStart ? { cycleStart: filters.value.cycleStart } : {}),
    ...(filters.value.periodStart ? { periodStart: filters.value.periodStart } : {}),
    ...(filters.value.accountId ? { accountId: filters.value.accountId } : {}),
    ...(filters.value.categoryId ? { categoryId: filters.value.categoryId } : {}),
    ...(filters.value.envelopeId ? { envelopeId: filters.value.envelopeId } : {}),
    sortBy: filters.value.sortBy,
    sortDirection: filters.value.sortDirection,
  };
}

function resetFilters() {
  filters.value = {
    search: '',
    type: '',
    status: '',
    from: '',
    to: '',
    cycleStart: '',
    periodStart: '',
    accountId: '',
    categoryId: '',
    envelopeId: '',
    sortBy: 'occurredOn',
    sortDirection: 'desc',
  };
  applyFilters();
}

function toggleSort(sortBy: Filters['sortBy']) {
  filters.value.sortDirection =
    filters.value.sortBy === sortBy && filters.value.sortDirection === 'desc' ? 'asc' : 'desc';
  filters.value.sortBy = sortBy;
  applyFilters();
}

async function saveAllocation(
  transaction: TransactionDto,
  input: { amount: string; occurredOn: string; accountId: string; envelopeId: string },
) {
  if (!budget.value) return;
  pending.value = true;
  try {
    await api.createIncomeAllocation(
      budget.value.id,
      transaction.id,
      input,
      keyFor(`allocation:${transaction.id}`),
    );
    mutationKeys.delete(`allocation:${transaction.id}`);
    await load();
  } catch {
    error.value = 'Не удалось сохранить распределение. Повторите попытку.';
  } finally {
    pending.value = false;
  }
}

function rejectAllocationProposal(transactionId: string) {
  rejectedProposalIds.value = new Set([...rejectedProposalIds.value, transactionId]);
  statusText.value = 'Предложение распределения отклонено.';
}
</script>

<template>
  <main v-if="hydrated" class="operations-page">
    <header class="operations-page__header">
      <div>
        <p class="operations-page__eyebrow">Журнал</p>
        <h1>Операции</h1>
      </div>
      <UiButton data-action="create-operation" @click="openCreate">Добавить операцию</UiButton>
    </header>
    <p v-if="statusText" class="operations-page__status" role="status">{{ statusText }}</p>
    <p v-if="error" class="operations-page__error" role="alert">
      {{ error }} <UiButton variant="tertiary" @click="load()">Повторить</UiButton>
    </p>
    <UiEmptyState
      v-if="!loading && !budget"
      title="Бюджет не выбран"
      description="Создайте или выберите активный бюджет, чтобы вести операции."
    />
    <template v-else>
      <section class="operations-page__filters" aria-label="Фильтры операций">
        <UiInput
          v-model="filters.search"
          name="search"
          label="Поиск"
          @update:model-value="applyFilters"
        />
        <UiSelect
          v-model="filters.type"
          name="type"
          label="Тип"
          :options="[
            { value: '', label: 'Все типы' },
            { value: 'INCOME', label: 'Доходы' },
            { value: 'EXPENSE', label: 'Расходы' },
          ]"
          @update:model-value="applyFilters"
        />
        <UiSelect
          v-model="filters.status"
          name="status"
          label="Статус"
          :options="[
            { value: '', label: 'Все активные' },
            { value: 'DRAFT', label: 'Черновики' },
            { value: 'CONFIRMED', label: 'Подтверждённые' },
            { value: 'CANCELLED', label: 'Отменённые' },
            { value: 'DELETED', label: 'Удалённые' },
            { value: 'all', label: 'Все статусы' },
          ]"
          @update:model-value="applyFilters"
        />
        <UiInput
          v-model="filters.from"
          name="from"
          label="С даты"
          type="date"
          @update:model-value="applyFilters"
        />
        <UiInput
          v-model="filters.to"
          name="to"
          label="По дату"
          type="date"
          @update:model-value="applyFilters"
        />
        <UiInput
          v-model="filters.cycleStart"
          name="cycleStart"
          label="Дата цикла"
          type="date"
          @update:model-value="applyFilters"
        />
        <UiInput
          v-model="filters.periodStart"
          name="periodStart"
          label="Дата периода"
          type="date"
          @update:model-value="applyFilters"
        />
        <UiSelect
          v-model="filters.accountId"
          name="journal-account-id"
          label="Счёт в журнале"
          :options="[{ value: '', label: 'Все счета' }, ...accounts]"
          @update:model-value="applyFilters"
        />
        <UiSelect
          v-model="filters.categoryId"
          name="journal-category-id"
          label="Категория в журнале"
          :options="[
            { value: '', label: 'Все категории' },
            ...categories.map((item) => ({ value: item.id, label: item.name })),
          ]"
          @update:model-value="applyFilters"
        />
        <UiSelect
          v-model="filters.envelopeId"
          name="journal-envelope-id"
          label="Конверт в журнале"
          :options="[{ value: '', label: 'Все конверты' }, ...envelopes]"
          @update:model-value="applyFilters"
        />
        <UiButton variant="tertiary" @click="resetFilters">Сбросить фильтры</UiButton>
      </section>
      <div class="operations-page__sort" aria-label="Сортировка операций">
        <UiButton
          :aria-sort="filters.sortBy === 'occurredOn' ? filters.sortDirection : 'none'"
          variant="tertiary"
          @click="toggleSort('occurredOn')"
          >Сортировать по дате</UiButton
        >
        <UiButton
          :aria-sort="filters.sortBy === 'amount' ? filters.sortDirection : 'none'"
          variant="tertiary"
          @click="toggleSort('amount')"
          >Сортировать по сумме</UiButton
        >
      </div>
      <OperationForm
        v-if="formOpen"
        :mode="selectedTransaction ? 'edit' : 'create'"
        :model="form"
        :current="selectedTransaction"
        :accounts="accounts"
        :categories="categories"
        :envelopes="envelopes"
        :errors="formErrors"
        :pending="pending"
        @submit="receiveForm"
      />
      <p v-if="loading">Загрузка операций…</p>
      <UiEmptyState
        v-else-if="transactions.length === 0"
        title="Операций пока нет"
        description="Добавьте доход или расход, чтобы начать журнал."
      />
      <section v-else class="operations-page__list" aria-label="Список операций">
        <article
          v-for="transaction in transactions"
          :key="transaction.id"
          class="operations-page__item"
        >
          <OperationCard :transaction="transaction" />
          <div class="operations-page__actions">
            <UiButton
              data-action="show-operation-details"
              variant="tertiary"
              @click="openDetails(transaction)"
              >Детали</UiButton
            >
            <UiButton
              v-if="transaction.status !== 'DELETED'"
              data-action="edit-operation"
              variant="secondary"
              @click="openEdit(transaction)"
              >Изменить</UiButton
            >
            <UiButton
              v-if="transaction.status === 'DRAFT'"
              variant="secondary"
              @click="ask('confirm', transaction)"
              >Подтвердить операцию</UiButton
            >
            <UiButton
              v-if="transaction.status === 'DRAFT'"
              variant="tertiary"
              @click="ask('cancel', transaction)"
              >Отменить</UiButton
            >
            <UiButton
              v-if="transaction.status !== 'DELETED'"
              variant="tertiary"
              @click="ask('delete', transaction)"
              >Удалить</UiButton
            >
            <UiButton
              v-if="transaction.status === 'DELETED'"
              variant="secondary"
              @click="ask('restore', transaction)"
              >Восстановить</UiButton
            >
          </div>
          <IncomeAllocationForm
            v-if="
              transaction.status === 'CONFIRMED' &&
              transaction.transactionType === 'INCOME' &&
              !rejectedProposalIds.has(transaction.id)
            "
            :proposal="transaction.allocationProposal"
            :remaining-minor="transaction.unallocatedMinor"
            :accounts="accounts"
            :envelopes="envelopes"
            :pending="pending"
            @submit="saveAllocation(transaction, $event)"
            @reject="rejectAllocationProposal(transaction.id)"
          />
        </article>
      </section>
      <UiButton v-if="nextCursor" variant="secondary" :disabled="loading" @click="load(true)"
        >Загрузить ещё</UiButton
      >
    </template>
    <OperationDetails
      v-if="detailsTransaction"
      :allocations="allocations"
      :audit-events="auditEvents"
    />
    <UiConfirmDialog
      :open="confirmation !== null"
      :title="
        confirmation?.action === 'delete'
          ? 'Удалить операцию?'
          : confirmation?.action === 'restore'
            ? 'Восстановить операцию?'
            : 'Подтвердить действие?'
      "
      :description="
        confirmation?.action === 'delete'
          ? 'Операция останется в истории, но перестанет влиять на балансы.'
          : 'Действие изменит серверные финансовые данные.'
      "
      confirm-label="Подтвердить"
      cancel-label="Отмена"
      :variant="confirmation?.action === 'delete' ? 'danger' : 'primary'"
      :loading="pending"
      @confirm="runConfirmation"
      @cancel="confirmation = null"
    />
  </main>
</template>

<style scoped>
.operations-page {
  max-width: 70rem;
  margin: 0 auto;
  padding: var(--hf-space-8);
}
.operations-page__header {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: var(--hf-space-5);
  margin-bottom: var(--hf-space-6);
}
.operations-page__header h1,
.operations-page__eyebrow,
.operations-page__status,
.operations-page__error {
  margin: 0;
}
.operations-page__header h1 {
  font-size: clamp(2rem, 4vw, 3.5rem);
  letter-spacing: -0.04em;
}
.operations-page__eyebrow {
  color: var(--hf-color-action-primary-hover);
  font-size: 0.75rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.operations-page__filters {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--hf-space-3);
  margin-bottom: var(--hf-space-4);
}
.operations-page__sort,
.operations-page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}
.operations-page__sort {
  margin-bottom: var(--hf-space-6);
}
.operations-page__list {
  display: grid;
  gap: var(--hf-space-4);
}
.operations-page__item {
  display: grid;
  gap: var(--hf-space-3);
}
.operations-page__status {
  margin-bottom: var(--hf-space-4);
  color: var(--hf-color-status-success);
}
.operations-page__error {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  margin-bottom: var(--hf-space-4);
  color: var(--hf-color-text-danger);
}
@media (max-width: 47.9375rem) {
  .operations-page {
    padding: var(--hf-space-5);
  }
  .operations-page__header {
    align-items: start;
    flex-direction: column;
  }
  .operations-page__filters {
    grid-template-columns: 1fr;
  }
}
</style>
