<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { definePageMeta, useRoute } from '#imports';
import { Download } from '@lucide/vue';

import OperationDialog from '../../components/operations/OperationDialog.vue';
import OperationForm from '../../components/operations/OperationForm.vue';
import OperationGroup from '../../components/operations/OperationGroup.vue';
import OperationRow from '../../components/operations/OperationRow.vue';
import OperationsToolbar from '../../components/operations/OperationsToolbar.vue';
import TransferDialog from '../../components/operations/TransferDialog.vue';
import TransferRow from '../../components/operations/TransferRow.vue';
import { groupByDay } from '../../components/operations/group-by-day.js';
import UiActionMenu from '../../components/ui/ActionMenu.vue';
import UiButton from '../../components/ui/Button.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiModal from '../../components/ui/Modal.vue';
import UiReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiSkeleton from '../../components/ui/Skeleton.vue';
import { ApiRequestError } from '../../composables/useApiClient.js';
import { useAuth } from '../../composables/useAuth.js';
import {
  useEnvelopePlanV2,
  type JournalItem,
  type TransactionJournalV2Item,
  type TransferJournalItem,
  type UpdateTransactionV2Request,
} from '../../composables/useEnvelopePlanV2.js';
import {
  useOperationFilters,
  type OperationFilters,
} from '../../composables/useOperationFilters.js';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
import {
  availableActions,
  canEditTransaction,
  useOperationMutations,
} from '../../composables/useOperationMutations.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';
import { useToast } from '../../composables/useToast.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';

defineOptions({ name: 'OperationsJournalPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const JOURNAL_OVERRIDES = { RESOURCE_NOT_FOUND: 'Операция не найдена. Обновите журнал.' };

type ConfirmationAction = 'delete' | 'restore' | 'update';

const auth = useAuth();
const route = useRoute();
const planV2 = useEnvelopePlanV2();
const { push } = useToast();
const { filters, activeCount, toListInput, set, reset } = useOperationFilters();
const mutations = useOperationMutations();
const { openDialog: globalOperationDialog, openChoose } = useOperationDialogs();

const items = ref<JournalItem[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(true);
const hydrated = ref(false);
const pending = ref(false);
const exportPending = ref(false);
const exportStatus = ref('');
const exportError = ref('');
const error = ref('');
const formError = ref('');
const formErrors = ref<Partial<Record<string, string>>>({});
const formOpen = ref(false);
const selectedTransaction = ref<TransactionJournalV2Item | null>(null);
const preloadedOperationId = ref<string | null>(null);
const detailed = ref<TransactionJournalV2Item | null>(null);
const detailedTransfer = ref<TransferJournalItem | null>(null);
const mutationKeys = new Map<string, string>();
const confirmation = ref<null | {
  action: ConfirmationAction;
  transaction: TransactionJournalV2Item;
  input?: UpdateTransactionV2Request;
}>(null);
let requestVersion = 0;

const workspace = computed(() => auth.currentData.value?.workspaces[0] ?? null);
const budget = computed(() => workspace.value?.budgets[0] ?? null);
const isOwner = computed(() => workspace.value?.role === 'OWNER');
// Accounts, categories and envelopes come from the shared cache the global add
// dialogs already use, so opening the journal does not re-read them every time.
const { accounts, categories, envelopes, load: loadReferenceData } = useOperationReferenceData();

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

// The server fixes the order (newest first), so day headings never lie about it.
const sections = computed(() => groupByDay(items.value, today));

function isTransfer(item: JournalItem): item is TransferJournalItem {
  return item.kind === 'TRANSFER';
}

function transferRoute(item: TransferJournalItem) {
  return {
    sourceName: accountNameById.value.get(item.sourceAccountId) ?? 'Счёт',
    destinationName: accountNameById.value.get(item.destinationAccountId) ?? 'Счёт',
  };
}

function onTransferChanged(): void {
  detailedTransfer.value = null;
  void load();
}

const confirmationCopy = computed(() => {
  if (confirmation.value?.action === 'delete') {
    return {
      title: 'Удалить операцию?',
      description: 'Операция останется в истории, но перестанет влиять на балансы.',
    };
  }
  if (confirmation.value?.action === 'restore') {
    return {
      title: 'Восстановить операцию?',
      description: 'Операция снова начнёт влиять на балансы.',
    };
  }
  return {
    title: 'Сохранить изменения?',
    description: 'Изменения сразу повлияют на операции и баланс.',
  };
});

onMounted(() => {
  hydrated.value = true;
  void load();
});

// The quick-add and transfer dialogs live in the layout now, so the journal
// reloads its list whenever one of them closes instead of owning their state.
watch(globalOperationDialog, (value, previous) => {
  if (value === 'none' && previous !== 'none') void load();
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
    const [result] = await Promise.all([
      planV2.listJournal(budget.value.id, {
        ...toListInput(),
        ...(append && nextCursor.value ? { cursor: nextCursor.value } : {}),
      }),
      loadReferenceData(),
    ]);
    if (version !== requestVersion) return;
    items.value = append ? [...items.value, ...result.items] : result.items;
    nextCursor.value = result.nextCursor;
    await preloadDetailed();
  } catch (exception) {
    if (version === requestVersion) {
      error.value = v2ErrorMessage(
        exception,
        'Не удалось загрузить операции. Повторите попытку.',
        JOURNAL_OVERRIDES,
      );
    }
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}

// A row on the dashboard links here: without this the click would land on the
// journal and lose the operation the reader asked for.
async function preloadDetailed(): Promise<void> {
  if (!budget.value || detailed.value) return;
  const operationId = typeof route.query.operationId === 'string' ? route.query.operationId : null;
  if (!operationId || !isUuid(operationId)) return;
  if (preloadedOperationId.value === operationId) return;
  preloadedOperationId.value = operationId;
  try {
    detailed.value = await planV2.getTransaction(budget.value.id, operationId);
  } catch {
    error.value = 'Не удалось открыть операцию.';
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function categoryName(transaction: TransactionJournalV2Item): string {
  return categoryById.value.get(transaction.categoryId)?.name ?? 'Без категории';
}

function categoryIcon(transaction: TransactionJournalV2Item): string | null {
  return categoryById.value.get(transaction.categoryId)?.icon ?? null;
}

function accountName(transaction: TransactionJournalV2Item): string {
  return accountNameById.value.get(transaction.accountId) ?? 'Счёт';
}

function envelopeName(transaction: TransactionJournalV2Item): string | null {
  return transaction.envelopeId === null
    ? null
    : (envelopeNameById.value.get(transaction.envelopeId) ?? 'Конверт');
}

// An operation from before model 2 has no actions at all: an empty menu would
// only be a dead control.
function hasRowActions(transaction: TransactionJournalV2Item): boolean {
  return canEditTransaction(transaction) || availableActions(transaction).length > 0;
}

function onFilterChange(key: keyof OperationFilters, value: string): void {
  set(key, value as never);
  void load();
}

function onReset(): void {
  reset();
  void load();
}

function openEdit(transaction: TransactionJournalV2Item) {
  detailed.value = null;
  formErrors.value = {};
  formError.value = '';
  selectedTransaction.value = transaction;
  formOpen.value = true;
}

function closeForm() {
  formOpen.value = false;
  selectedTransaction.value = null;
}

// Field errors go next to their fields; anything else is one Russian sentence.
// A validation problem without fields still carries a user-facing server detail
// (for example a future date), which names the field better than generic text.
function mapFormError(exception: unknown): void {
  const fallback = 'Не удалось сохранить операцию. Повторите попытку.';
  if (!(exception instanceof ApiRequestError)) {
    formErrors.value = {};
    formError.value = fallback;
    return;
  }
  const fieldErrors: Partial<Record<string, string>> = Object.fromEntries(
    (exception.problem.fieldErrors ?? []).map((field) => [field.field, field.message]),
  );
  const detail = exception.problem.detail;
  if (
    Object.keys(fieldErrors).length === 0 &&
    exception.problem.code === 'VALIDATION_FAILED' &&
    /[а-яё]/iu.test(detail)
  ) {
    if (/сумм|денеж|знак/iu.test(detail)) fieldErrors.amount = detail;
    else if (/дат/iu.test(detail)) fieldErrors.occurredOn = detail;
  }
  formErrors.value = fieldErrors;
  formError.value = v2ErrorMessage(exception, fallback, JOURNAL_OVERRIDES);
}

function keyFor(operation: string) {
  const existing = mutationKeys.get(operation);
  if (existing) return existing;
  const key = crypto.randomUUID();
  mutationKeys.set(operation, key);
  return key;
}

// The form already emits only the changed fields; saving is still confirmed once
// because a correction moves balances immediately.
function receiveForm(input: UpdateTransactionV2Request) {
  if (!selectedTransaction.value) return;
  confirmation.value = { action: 'update', transaction: selectedTransaction.value, input };
}

function ask(action: Exclude<ConfirmationAction, 'update'>, transaction: TransactionJournalV2Item) {
  confirmation.value = { action, transaction };
}

async function runConfirmation() {
  const current = confirmation.value;
  if (!current || !budget.value) return;
  confirmation.value = null;

  if (current.action === 'update' && current.input) {
    await saveUpdate(current.transaction, current.input);
    return;
  }

  const result =
    current.action === 'delete'
      ? await mutations.remove(budget.value.id, current.transaction)
      : await mutations.restore(budget.value.id, current.transaction);
  if (!result) return;
  // The row changed shape (it left or re-entered the list): close its dialog and
  // read the list again instead of patching a half-known row.
  if (detailed.value?.id === current.transaction.id) detailed.value = null;
  void load();
}

async function saveUpdate(
  transaction: TransactionJournalV2Item,
  input: UpdateTransactionV2Request,
) {
  if (!budget.value || pending.value) return;
  pending.value = true;
  error.value = '';
  // The same edit retried keeps its key; a changed edit is a new request.
  const operation = `update:${transaction.id}:${JSON.stringify(input)}`;
  const key = keyFor(operation);
  try {
    await planV2.updateTransaction(budget.value.id, transaction.id, input, key);
    mutationKeys.delete(operation);
    closeForm();
    push({ tone: 'success', title: 'Операция обновлена' });
    await load();
  } catch (exception) {
    mapFormError(exception);
  } finally {
    pending.value = false;
  }
}

// The v2 export covers the whole budget history (both accounting models); it
// does not take the journal filters.
async function downloadCsv() {
  if (!budget.value || !isOwner.value) return;
  exportPending.value = true;
  exportStatus.value = '';
  exportError.value = '';
  try {
    const blob = await planV2.exportTransactions(budget.value.id);
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
    exportError.value = 'Не удалось скачать CSV. Повторите попытку.';
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
          class="operations-page__export"
          :loading="exportPending"
          :disabled="exportPending"
          :aria-label="exportPending ? 'Подготовка CSV…' : 'Экспорт CSV'"
          tooltip="Экспорт всех операций в CSV"
          @click="downloadCsv"
        >
          <Download :size="18" aria-hidden="true" />
        </UiButton>
        <UiButton data-action="create-operation" class="operations-page__add" @click="openChoose">
          Добавить операцию
        </UiButton>
      </template>

      <template #filters>
        <OperationsToolbar
          :filters="filters"
          :accounts="accounts"
          :categories="categoryOptions"
          :envelopes="envelopes"
          :can-view-deleted="isOwner"
          @change="onFilterChange"
          @reset="onReset"
        />
      </template>

      <template #content>
        <p v-if="exportStatus" class="operations-page__status" role="status">{{ exportStatus }}</p>
        <p v-if="exportError" class="operations-page__error" role="alert">{{ exportError }}</p>
        <p v-if="error" class="operations-page__error" role="alert">
          {{ error }} <UiButton variant="tertiary" @click="load()">Повторить</UiButton>
        </p>

        <div
          v-if="loading && items.length === 0"
          data-testid="operations-loading"
          aria-busy="true"
        >
          <UiSkeleton variant="row" :count="6" />
        </div>

        <UiEmptyState
          v-else-if="items.length === 0 && activeCount === 0"
          title="Операций пока нет"
          description="Добавьте доход, расход или перевод, чтобы начать журнал."
        />

        <UiEmptyState
          v-else-if="items.length === 0"
          title="Ничего не найдено"
          description="Под текущие фильтры не подошла ни одна операция."
        />

        <div v-else class="operations-page__sections">
          <OperationGroup v-for="section in sections" :key="section.date" :label="section.label">
            <li v-for="item in section.items" :key="item.id">
              <TransferRow
                v-if="isTransfer(item)"
                :transfer="item"
                v-bind="transferRoute(item)"
                @select="detailedTransfer = item"
              />
              <OperationRow
                v-else
                :transaction="item"
                :category-name="categoryName(item)"
                :category-icon="categoryIcon(item)"
                :account-name="accountName(item)"
                :envelope-name="envelopeName(item)"
                @select="detailed = item"
              >
                <template v-if="hasRowActions(item)" #actions>
                  <UiActionMenu label="Действия над операцией">
                    <button
                      v-if="canEditTransaction(item)"
                      type="button"
                      role="menuitem"
                      data-testid="row-edit"
                      @click="openEdit(item)"
                    >
                      Изменить
                    </button>
                    <button
                      v-if="availableActions(item).includes('delete')"
                      type="button"
                      role="menuitem"
                      data-testid="row-delete"
                      @click="ask('delete', item)"
                    >
                      Удалить
                    </button>
                    <button
                      v-if="availableActions(item).includes('restore')"
                      type="button"
                      role="menuitem"
                      data-testid="row-restore"
                      @click="ask('restore', item)"
                    >
                      Восстановить
                    </button>
                  </UiActionMenu>
                </template>
              </OperationRow>
            </li>
          </OperationGroup>
        </div>

        <UiButton v-if="nextCursor" variant="secondary" :disabled="loading" @click="load(true)">
          Показать ещё
        </UiButton>
      </template>
    </UiReferencePageLayout>

    <OperationDialog
      v-if="budget"
      :transaction="detailed"
      :budget-id="budget.id"
      :account-name="detailed ? accountName(detailed) : ''"
      :category-name="detailed ? categoryName(detailed) : ''"
      :envelope-name="detailed ? envelopeName(detailed) : null"
      :busy="pending || mutations.pending.value"
      @close="detailed = null"
      @edit="openEdit"
      @request-delete="ask('delete', $event)"
      @request-restore="ask('restore', $event)"
    />

    <TransferDialog
      v-if="budget"
      :transfer="detailedTransfer"
      :budget-id="budget.id"
      :accounts="accounts"
      :account-names="accountNameById"
      :can-restore="isOwner"
      @close="detailedTransfer = null"
      @changed="onTransferChanged"
    />

    <UiModal :open="formOpen" title="Изменить операцию" @close="closeForm">
      <OperationForm
        v-if="selectedTransaction"
        :key="selectedTransaction.id"
        :current="selectedTransaction"
        :accounts="accounts"
        :categories="categories"
        :envelopes="envelopes"
        :errors="formErrors"
        :form-error="formError"
        :pending="pending"
        @submit="receiveForm"
      />
    </UiModal>

    <UiConfirmDialog
      :open="confirmation !== null"
      :title="confirmationCopy.title"
      :description="confirmationCopy.description"
      confirm-label="Подтвердить"
      cancel-label="Отмена"
      :variant="confirmation?.action === 'delete' ? 'danger' : 'primary'"
      :loading="pending || mutations.pending.value"
      @confirm="runConfirmation"
      @cancel="confirmation = null"
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

.operations-page__export {
  padding-inline: 0;
}

/* Below 1024px the bottom navigation has its own "+" for the same dialog;
   a second add button would only push the list down. */
@media (max-width: 1023px) {
  .reference-page-layout__actions .operations-page__add {
    display: none;
  }
}
</style>
