<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { definePageMeta, useRoute } from '#imports';

import OperationDrawer from '../../components/operations/OperationDrawer.vue';
import OperationForm from '../../components/operations/OperationForm.vue';
import OperationGroup from '../../components/operations/OperationGroup.vue';
import OperationRow from '../../components/operations/OperationRow.vue';
import OperationsToolbar from '../../components/operations/OperationsToolbar.vue';
import { groupByDay } from '../../components/operations/group-by-day.js';
import { periodChipOptions } from '../../components/operations/period-options.js';
import FinanceMoney from '../../components/finance/FinanceMoney.vue';
import UiActionMenu from '../../components/ui/ActionMenu.vue';
import UiButton from '../../components/ui/Button.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiModal from '../../components/ui/Modal.vue';
import UiReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiSkeleton from '../../components/ui/Skeleton.vue';
import {
  createOperationForm,
  type OperationFormModel,
} from '../../composables/useOperationForm.js';
import {
  type CreateTransactionInput,
  type TransactionDto,
  type UpdateTransactionInput,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';
import { useAuth } from '../../composables/useAuth.js';
import {
  useOperationFilters,
  type OperationFilters,
} from '../../composables/useOperationFilters.js';
import { useOperationMutations } from '../../composables/useOperationMutations.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';
import { useToast } from '../../composables/useToast.js';
import { ApiRequestError } from '../../composables/useApiClient.js';

defineOptions({ name: 'OperationsJournalPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

type ConfirmationAction = 'confirm' | 'cancel' | 'delete' | 'restore' | 'create' | 'update';

const auth = useAuth();
const route = useRoute();
const api = useBudgetReferenceData();
const { push } = useToast();
const { filters, activeCount, isGrouped, toListInput, set, reset, syncQuery } =
  useOperationFilters();
const mutations = useOperationMutations();

const transactions = ref<TransactionDto[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(true);
const hydrated = ref(false);
const pending = ref(false);
const exportPending = ref(false);
const exportStatus = ref('');
const exportError = ref('');
const error = ref('');
const formErrors = ref<Partial<Record<string, string>>>({});
const formOpen = ref(false);
const form = ref<OperationFormModel>(createOperationForm());
const selectedTransaction = ref<TransactionDto | null>(null);
const preloadedDraftId = ref<string | null>(null);
const detailed = ref<TransactionDto | null>(null);
const allocationChoice = ref<TransactionDto | null>(null);
const mutationKeys = new Map<string, string>();
const confirmation = ref<null | {
  action: ConfirmationAction;
  transaction: TransactionDto | null;
  input?: CreateTransactionInput | UpdateTransactionInput;
  allocationResolution?: 'CANCEL' | 'DELETE';
}>(null);
let requestVersion = 0;

const workspace = computed(() => auth.currentData.value?.workspaces[0] ?? null);
const budget = computed(() => workspace.value?.budgets[0] ?? null);
const isOwner = computed(() => workspace.value?.role === 'OWNER');
// Accounts, categories and envelopes come from the shared cache the global add
// dialogs already use, so opening the journal does not re-read them every time.
const { accounts, categories, envelopes, load: loadReferenceData } = useOperationReferenceData();
const periods = ref<Array<{ value: string; label: string }>>([]);

const categoryOptions = computed(() =>
  categories.value.map((category) => ({ value: category.id, label: category.name })),
);
const categoryById = computed(
  () => new Map(categories.value.map((category) => [category.id, category])),
);
const accountNameById = computed(
  () => new Map(accounts.value.map((account) => [account.value, account.label])),
);
const envelopeNameById = computed(
  () => new Map(envelopes.value.map((envelope) => [envelope.value, envelope.label])),
);

const today = new Date().toISOString().slice(0, 10);

// One list of sections drives both shapes: grouped by day, or one flat section
// when the server sorted by amount and day headings would lie about the order.
const sections = computed(() =>
  isGrouped.value
    ? groupByDay(transactions.value, today)
    : [{ date: 'all', label: '', items: transactions.value }],
);

const unallocatedIncome = computed(() =>
  transactions.value.find(
    (item) =>
      item.transactionType === 'INCOME' &&
      item.status === 'CONFIRMED' &&
      item.unallocatedMinor !== '0',
  ),
);

onMounted(() => {
  hydrated.value = true;
  void load();
});

// The cycle and the period are the server's arithmetic; the journal only asks
// for them once to fill the period chip.
async function loadPeriods() {
  if (!budget.value) return;
  try {
    const summary = await api.getDashboardSummary(budget.value.id);
    periods.value = periodChipOptions(summary.period);
  } catch {
    periods.value = [];
  }
}

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
    const [result] = await Promise.all([
      api.listTransactions(budget.value.id, {
        ...toListInput(),
        ...(append && nextCursor.value ? { cursor: nextCursor.value } : {}),
      }),
      loadReferenceData(),
    ]);
    if (version !== requestVersion) return;
    transactions.value = append ? [...transactions.value, ...result.items] : result.items;
    nextCursor.value = result.nextCursor;
    if (periods.value.length === 0) void loadPeriods();
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
  // The draftId query param stays in the URL for deep-linking, but we only want to
  // auto-open the edit modal for it once per visit — otherwise closing the modal
  // (e.g. after saving changes, which reloads the list) would immediately reopen it.
  if (preloadedDraftId.value === draftId) return;
  preloadedDraftId.value = draftId;
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

function categoryName(transaction: TransactionDto): string {
  return categoryById.value.get(transaction.categoryId)?.name ?? 'Без категории';
}

function categoryTemplateKey(transaction: TransactionDto): string | null {
  return categoryById.value.get(transaction.categoryId)?.templateKey ?? null;
}

function accountName(transaction: TransactionDto): string {
  return accountNameById.value.get(transaction.accountId) ?? 'Счёт';
}

function envelopeName(transaction: TransactionDto): string | null {
  return transaction.envelopeId === null
    ? null
    : (envelopeNameById.value.get(transaction.envelopeId) ?? 'Конверт');
}

function onFilterChange(key: keyof OperationFilters, value: string): void {
  set(key, value as never);
  void load();
}

function onSearch(value: string): void {
  filters.value.search = value;
  void syncQuery();
  void load();
}

function onReset(): void {
  reset();
  void load();
}

// A closed drawer must not cost a full reload: replace the one row that changed.
function applyChanged(updated: TransactionDto): void {
  transactions.value = transactions.value.map((item) => (item.id === updated.id ? updated : item));
  if (detailed.value?.id === updated.id) detailed.value = updated;
}

function openCreate() {
  form.value = createOperationForm();
  formErrors.value = {};
  selectedTransaction.value = null;
  formOpen.value = true;
}

function openEdit(transaction: TransactionDto) {
  detailed.value = null;
  form.value = createOperationForm(transaction);
  formErrors.value = {};
  selectedTransaction.value = transaction;
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
  return Object.keys(fieldErrors).length > 0 ? 'Укажите данные формы.' : exception.problem.detail;
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
    push({
      tone: 'success',
      title: input.status === 'DRAFT' ? 'Черновик сохранён' : 'Операция подтверждена',
    });
    await load();
  } catch (exception) {
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

  if (current.action === 'update' && current.input) {
    await saveUpdate(current.transaction, current.input as UpdateTransactionInput);
    return;
  }

  const transaction = current.transaction;
  if (current.action === 'confirm') {
    apply(await mutations.confirm(budget.value.id, transaction));
    return;
  }
  if (current.action === 'cancel') {
    apply(await mutations.cancel(budget.value.id, transaction));
    return;
  }
  if (current.action === 'restore') {
    apply(await mutations.restore(budget.value.id, transaction));
    return;
  }

  const removed = await mutations.remove(budget.value.id, transaction);
  if (removed) {
    apply(removed);
    return;
  }
  // Deleting an income that still carries confirmed allocations is a deliberate
  // second decision: cancel those allocations, or delete them with the income.
  const failure = mutations.lastError.value;
  if (
    failure instanceof ApiRequestError &&
    failure.problem.code === 'INCOME_HAS_CONFIRMED_ALLOCATIONS'
  ) {
    allocationChoice.value = transaction;
  }
}

function apply(updated: TransactionDto | null): void {
  if (!updated) return;
  applyChanged(updated);
  void load();
}

async function saveUpdate(transaction: TransactionDto, input: UpdateTransactionInput) {
  if (!budget.value) return;
  pending.value = true;
  error.value = '';
  const operation = `update:${transaction.id}`;
  const key = keyFor(operation);
  try {
    await api.updateTransaction(budget.value.id, transaction.id, input, key);
    mutationKeys.delete(operation);
    formOpen.value = false;
    selectedTransaction.value = null;
    push({ tone: 'success', title: 'Операция обновлена' });
    await load();
  } catch (exception) {
    error.value = mapFormError(exception);
  } finally {
    pending.value = false;
  }
}

// Deletion was already confirmed once; this dialog only asks what happens to
// the allocations, so the answer runs the mutation instead of asking again.
async function chooseAllocationResolution(resolution: 'CANCEL' | 'DELETE'): Promise<void> {
  const transaction = allocationChoice.value;
  allocationChoice.value = null;
  if (!transaction || !budget.value) return;
  apply(await mutations.removeWithAllocations(budget.value.id, transaction, resolution));
}

async function downloadCsv() {
  if (!budget.value || !isOwner.value) return;
  exportPending.value = true;
  exportStatus.value = '';
  exportError.value = '';
  try {
    const blob = await api.downloadTransactionsCsv(budget.value.id, toListInput());
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'harmofin-operations.csv';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    }
    exportStatus.value = 'Экспорт CSV подготовлен.';
  } catch {
    exportError.value = 'Не удалось скачать CSV. Сузьте фильтры или повторите попытку.';
  } finally {
    exportPending.value = false;
  }
}
</script>

<template>
  <div v-if="hydrated" class="operations-page">
    <UiEmptyState
      v-if="!budget"
      title="Бюджет не выбран"
      description="Создайте или выберите активный бюджет, чтобы вести операции."
    />
    <UiReferencePageLayout v-else>
      <template #kicker>Журнал</template>
      <template #title>Операции</template>

      <template #actions>
        <UiButton
          v-if="isOwner"
          data-action="download-csv"
          variant="secondary"
          :disabled="exportPending"
          @click="downloadCsv"
        >
          {{ exportPending ? 'Подготовка CSV…' : 'Экспорт CSV' }}
        </UiButton>
        <UiButton data-action="create-operation" @click="openCreate">Добавить операцию</UiButton>
      </template>

      <template #filters>
        <OperationsToolbar
          :filters="filters"
          :active-count="activeCount"
          :accounts="accounts"
          :categories="categoryOptions"
          :envelopes="envelopes"
          :periods="periods"
          @change="onFilterChange"
          @search="onSearch"
          @reset="onReset"
        />
      </template>

      <template #content>
        <p v-if="exportStatus" class="operations-page__status" role="status">{{ exportStatus }}</p>
        <p v-if="exportError" class="operations-page__error" role="alert">{{ exportError }}</p>
        <p v-if="error" class="operations-page__error" role="alert">
          {{ error }} <UiButton variant="tertiary" @click="load()">Повторить</UiButton>
        </p>

        <p v-if="unallocatedIncome" class="operations-page__unallocated">
          Не распределено
          <FinanceMoney
            :minor-units="unallocatedIncome.unallocatedMinor"
            :currency="unallocatedIncome.currency"
            :scale="unallocatedIncome.scale"
          />
          <UiButton
            variant="tertiary"
            data-testid="open-unallocated"
            @click="detailed = unallocatedIncome"
          >
            Распределить
          </UiButton>
        </p>

        <div
          v-if="loading && transactions.length === 0"
          data-testid="operations-loading"
          aria-busy="true"
        >
          <UiSkeleton variant="row" :count="6" />
        </div>

        <UiEmptyState
          v-else-if="transactions.length === 0 && activeCount === 0"
          title="Операций пока нет"
          description="Добавьте доход или расход, чтобы начать журнал."
        />

        <UiEmptyState
          v-else-if="transactions.length === 0"
          title="Ничего не найдено"
          description="Под текущие фильтры не подошла ни одна операция."
        />

        <template v-else>
          <p v-if="!isGrouped" class="operations-page__sorted">Отсортировано по сумме</p>

          <div class="operations-page__sections">
            <OperationGroup v-for="section in sections" :key="section.date" :label="section.label">
              <li v-for="transaction in section.items" :key="transaction.id">
                <OperationRow
                  :transaction="transaction"
                  :category-name="categoryName(transaction)"
                  :category-template-key="categoryTemplateKey(transaction)"
                  :account-name="accountName(transaction)"
                  :envelope-name="envelopeName(transaction)"
                  @select="detailed = transaction"
                >
                  <template #actions>
                    <UiActionMenu label="Действия над операцией">
                      <button
                        v-if="mutations.availableActions(transaction.status).includes('confirm')"
                        type="button"
                        role="menuitem"
                        data-testid="row-confirm"
                        @click="ask('confirm', transaction)"
                      >
                        Подтвердить
                      </button>
                      <button
                        v-if="transaction.status !== 'DELETED'"
                        type="button"
                        role="menuitem"
                        data-testid="row-edit"
                        @click="openEdit(transaction)"
                      >
                        Изменить
                      </button>
                      <button
                        v-if="mutations.availableActions(transaction.status).includes('cancel')"
                        type="button"
                        role="menuitem"
                        data-testid="row-cancel"
                        @click="ask('cancel', transaction)"
                      >
                        Отменить
                      </button>
                      <button
                        v-if="mutations.availableActions(transaction.status).includes('delete')"
                        type="button"
                        role="menuitem"
                        data-testid="row-delete"
                        @click="ask('delete', transaction)"
                      >
                        Удалить
                      </button>
                      <button
                        v-if="mutations.availableActions(transaction.status).includes('restore')"
                        type="button"
                        role="menuitem"
                        data-testid="row-restore"
                        @click="ask('restore', transaction)"
                      >
                        Восстановить
                      </button>
                    </UiActionMenu>
                  </template>
                </OperationRow>
              </li>
            </OperationGroup>
          </div>
        </template>

        <UiButton v-if="nextCursor" variant="secondary" :disabled="loading" @click="load(true)">
          Показать ещё
        </UiButton>
      </template>
    </UiReferencePageLayout>

    <OperationDrawer
      v-if="budget"
      :transaction="detailed"
      :budget-id="budget.id"
      :account-name="detailed ? accountName(detailed) : ''"
      :category-name="detailed ? categoryName(detailed) : ''"
      :envelope-name="detailed ? envelopeName(detailed) : null"
      :accounts="accounts"
      :envelopes="envelopes"
      @close="detailed = null"
      @changed="applyChanged"
      @edit="openEdit"
      @request-delete="ask('delete', $event)"
    />

    <UiModal
      :open="formOpen"
      :title="selectedTransaction ? 'Изменить операцию' : 'Добавить операцию'"
      @close="formOpen = false"
    >
      <OperationForm
        :mode="selectedTransaction ? 'edit' : 'create'"
        :model="form"
        :accounts="accounts"
        :categories="categories"
        :envelopes="envelopes"
        :errors="formErrors"
        :pending="pending"
        :current="selectedTransaction"
        @submit="receiveForm"
      />
    </UiModal>

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
      :loading="pending || mutations.pending.value"
      @confirm="runConfirmation"
      @cancel="confirmation = null"
    />

    <UiConfirmDialog
      :open="allocationChoice !== null"
      title="У дохода есть распределения"
      description="Отменить распределения и оставить их в истории или удалить вместе с доходом?"
      confirm-label="Удалить распределения"
      cancel-label="Отменить распределения"
      variant="danger"
      :loading="mutations.pending.value"
      @confirm="chooseAllocationResolution('DELETE')"
      @cancel="chooseAllocationResolution('CANCEL')"
    />
  </div>
</template>

<style scoped>
/* Grid items default to min-width: auto, so without this the widest row sets
   the page width and a phone gets horizontal scrolling. */
.operations-page__sections {
  display: grid;
  gap: var(--hf-space-5);
  min-width: 0;
}

.operations-page__sorted,
.operations-page__status {
  margin-bottom: var(--hf-space-4);
  color: var(--hf-color-text-muted);
}

.operations-page__status {
  color: var(--hf-color-status-success);
}

.operations-page__unallocated {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: center;
  margin-bottom: var(--hf-space-4);
  color: var(--hf-color-status-warning);
}

.operations-page__error {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  margin-bottom: var(--hf-space-4);
  color: var(--hf-color-text-danger);
}
</style>
