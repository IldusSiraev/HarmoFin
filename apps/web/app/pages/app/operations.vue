<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { definePageMeta } from '#imports';

import IncomeAllocationForm from '../../components/operations/IncomeAllocationForm.vue';
import OperationCard from '../../components/operations/OperationCard.vue';
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
  useBudgetReferenceData,
  type CreateTransactionInput,
  type TransactionDto,
} from '../../composables/useBudgetReferenceData.js';
import { useAuth } from '../../composables/useAuth.js';
import { ApiRequestError } from '../../composables/useApiClient.js';

defineOptions({ name: 'OperationsJournalPage' });
definePageMeta({ middleware: 'auth' });

const auth = useAuth();
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
const confirmation = ref<null | {
  action: 'confirm' | 'cancel' | 'delete' | 'create';
  transaction: TransactionDto | null;
  input?: CreateTransactionInput;
}>(null);
const filters = ref({ type: '', status: '', from: '', to: '' });

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
    transactions.value = append ? [...transactions.value, ...result.items] : result.items;
    nextCursor.value = result.nextCursor;
    accounts.value = accountData.map((item) => ({ value: item.id, label: item.name }));
    categories.value = categoryData;
    envelopes.value = envelopeData.map((item) => ({ value: item.id, label: item.name }));
  } catch {
    error.value = 'Не удалось загрузить операции. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  form.value = createOperationForm();
  formErrors.value = {};
  selectedTransaction.value = null;
  formOpen.value = true;
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
  return Object.keys(formErrors.value).length > 0
    ? 'Укажите данные формы.'
    : 'Не удалось сохранить операцию. Повторите попытку.';
}
function receiveForm(input: CreateTransactionInput) {
  if (input.status === 'CONFIRMED') {
    confirmation.value = { action: 'create', transaction: null, input };
    return;
  }
  void saveCreate(input);
}
async function saveCreate(input: CreateTransactionInput) {
  if (!budget.value) return;
  pending.value = true;
  error.value = '';
  formErrors.value = {};
  try {
    await api.createTransaction(budget.value.id, input, crypto.randomUUID());
    formOpen.value = false;
    statusText.value = input.status === 'DRAFT' ? 'Черновик сохранён.' : 'Операция подтверждена.';
    await load();
  } catch (exception) {
    error.value = mapFormError(exception);
  } finally {
    pending.value = false;
  }
}
function ask(action: 'confirm' | 'cancel' | 'delete', transaction: TransactionDto) {
  confirmation.value = { action, transaction };
}
async function runConfirmation() {
  const current = confirmation.value;
  if (!current || !budget.value) return;
  confirmation.value = null;
  if (current.action === 'create' && current.input) {
    await saveCreate(current.input);
    return;
  }
  if (!current.transaction) return;
  pending.value = true;
  try {
    const key = crypto.randomUUID();
    if (current.action === 'confirm')
      await api.confirmTransaction(budget.value.id, current.transaction.id, key);
    if (current.action === 'cancel')
      await api.cancelTransaction(budget.value.id, current.transaction.id, key);
    if (current.action === 'delete')
      await api.deleteTransaction(budget.value.id, current.transaction.id, key);
    statusText.value = 'Данные обновлены на сервере.';
    await load();
  } catch {
    error.value = 'Не удалось выполнить действие. Повторите попытку.';
  } finally {
    pending.value = false;
  }
}

function transactionFilters() {
  return {
    ...(filters.value.type ? { type: filters.value.type as 'INCOME' | 'EXPENSE' } : {}),
    ...(filters.value.status
      ? { status: filters.value.status as 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED' }
      : {}),
    ...(filters.value.from ? { from: filters.value.from } : {}),
    ...(filters.value.to ? { to: filters.value.to } : {}),
  };
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
      globalThis.crypto.randomUUID(),
    );
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
        <UiSelect
          v-model="filters.type"
          name="type"
          label="Тип"
          :options="[
            { value: '', label: 'Все типы' },
            { value: 'INCOME', label: 'Доходы' },
            { value: 'EXPENSE', label: 'Расходы' },
          ]"
          @update:model-value="load()"
        />
        <UiSelect
          v-model="filters.status"
          name="status"
          label="Статус"
          :options="[
            { value: '', label: 'Все статусы' },
            { value: 'DRAFT', label: 'Черновики' },
            { value: 'CONFIRMED', label: 'Подтверждённые' },
            { value: 'CANCELLED', label: 'Отменённые' },
            { value: 'DELETED', label: 'Удалённые' },
          ]"
          @update:model-value="load()"
        />
        <UiInput
          v-model="filters.from"
          name="from"
          label="С даты"
          type="date"
          @update:model-value="load()"
        />
        <UiInput
          v-model="filters.to"
          name="to"
          label="По дату"
          type="date"
          @update:model-value="load()"
        />
      </section>
      <OperationForm
        v-if="formOpen"
        mode="create"
        :model="form"
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
    <UiConfirmDialog
      :open="confirmation !== null"
      :title="confirmation?.action === 'delete' ? 'Удалить операцию?' : 'Подтвердить действие?'"
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
.operations-page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
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
