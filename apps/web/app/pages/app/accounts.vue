<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { definePageMeta, navigateTo, useRoute } from '#imports';

import AccountDrawer from '../../components/accounts/AccountDrawer.vue';
import AccountRow from '../../components/accounts/AccountRow.vue';
import FinanceMoney from '../../components/finance/FinanceMoney.vue';
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiActionMenu from '../../components/ui/ActionMenu.vue';
import UiButton from '../../components/ui/Button.vue';
import UiChip from '../../components/ui/Chip.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiInput from '../../components/ui/Input.vue';
import UiModal from '../../components/ui/Modal.vue';
import UiSelect from '../../components/ui/Select.vue';
import UiSkeleton from '../../components/ui/Skeleton.vue';
import UiStatus from '../../components/ui/Status.vue';
import { useAuth } from '../../composables/useAuth.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';
import {
  type AccountDto,
  type AccountType,
  type CreateAccountInput,
  type ReferenceStatus,
  type ReferenceSummaryDto,
  type UpdateAccountInput,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';
import { useReferenceDataForm } from '../../composables/useReferenceDataForm.js';
import { useToast } from '../../composables/useToast.js';

defineOptions({ name: 'AppAccountsPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const accountFields = [
  'name',
  'accountType',
  'bankName',
  'lastFourDigits',
  'startingBalance',
  'accountingStartDate',
  'comment',
] as const;
const { currentData, loadMe } = useAuth();
const route = useRoute();
const api = useBudgetReferenceData();
const formHelper = useReferenceDataForm(accountFields);
const { push } = useToast();
const accounts = ref<AccountDto[]>([]);
const summary = ref<ReferenceSummaryDto | null>(null);
const detailed = ref<AccountDto | null>(null);
const loading = ref(true);
const loadError = ref('');
// A short-lived confirmation/failure line for form and archive actions,
// separate from the server-computed accounts summary above the list.
const statusMessage = ref('');
const saving = ref(false);
const archiving = ref(false);
const formVisible = ref(false);
const editingId = ref<string | null>(null);
const editingAccount = ref<AccountDto | null>(null);
const archiveTarget = ref<AccountDto | null>(null);
const hydrated = ref(false);
// The archive filter lives in the URL so the view survives a reload and can be shared.
const status = ref<ReferenceStatus>(route.query.status === 'archived' ? 'archived' : 'active');
const fieldErrors = ref<Partial<Record<(typeof accountFields)[number], string>>>({});
const form = reactive({
  name: '',
  accountType: 'BANK_ACCOUNT' as AccountType,
  bankName: '',
  lastFourDigits: '',
  startingBalance: '',
  accountingStartDate: '',
  comment: '',
});

const budgetId = computed(() => currentData.value?.workspaces[0]?.budgets[0]?.id);

function getAccountTypeOptions() {
  return [
    { value: 'BANK_ACCOUNT', label: 'Банковский счёт' },
    { value: 'BANK_CARD', label: 'Банковская карта' },
    { value: 'CASH', label: 'Наличные' },
  ];
}

function resetForm() {
  form.name = '';
  form.accountType = 'BANK_ACCOUNT';
  form.bankName = '';
  form.lastFourDigits = '';
  form.startingBalance = '';
  form.accountingStartDate = '';
  form.comment = '';
  fieldErrors.value = {};
}

function startCreate() {
  resetForm();
  editingId.value = null;
  editingAccount.value = null;
  formVisible.value = true;
  statusMessage.value = '';
}

function startEdit(account: AccountDto) {
  form.name = account.name;
  form.accountType = account.accountType;
  form.bankName = account.bankName ?? '';
  form.lastFourDigits = account.lastFourDigits ?? '';
  form.startingBalance = '';
  form.accountingStartDate = account.accountingStartDate;
  form.comment = account.comment ?? '';
  fieldErrors.value = {};
  editingId.value = account.id;
  editingAccount.value = account;
  // Close the drawer first, otherwise the modal opens stacked on top of it.
  detailed.value = null;
  formVisible.value = true;
  statusMessage.value = '';
}

function cancelForm() {
  formVisible.value = false;
  editingId.value = null;
  editingAccount.value = null;
  resetForm();
}

async function loadAccounts(): Promise<void> {
  const id = budgetId.value;
  if (!id) return;
  // A reference record may have just changed, so the shared cache the journal,
  // the transfers page and the global dialogs read must not stay on old names.
  useOperationReferenceData().invalidate();
  const [items, totals] = await Promise.all([
    api.listAccounts(id, status.value),
    api.getAccountsSummary(id, status.value),
  ]);
  accounts.value = items;
  summary.value = totals;
}

async function loadPage() {
  loading.value = true;
  loadError.value = '';
  try {
    if (!currentData.value) await loadMe();
    await loadAccounts();
  } catch {
    loadError.value = 'Не удалось загрузить счета. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

async function toggleArchived(): Promise<void> {
  status.value = status.value === 'archived' ? 'active' : 'archived';
  await navigateTo(
    { path: route.path, query: status.value === 'archived' ? { status: 'archived' } : {} },
    { replace: true },
  );
  await loadPage();
}

function getFieldError(field: (typeof accountFields)[number]) {
  return fieldErrors.value[field];
}

function optionalText(value: string) {
  return value.trim() || null;
}

async function saveAccount() {
  const id = budgetId.value;
  if (!id) return;
  saving.value = true;
  statusMessage.value = '';
  fieldErrors.value = {};

  try {
    if (editingId.value && editingAccount.value) {
      const current = editingAccount.value;
      const input: UpdateAccountInput = {};
      const bankName = optionalText(form.bankName);
      const lastFourDigits = optionalText(form.lastFourDigits);
      const comment = optionalText(form.comment);

      if (form.name !== current.name) input.name = form.name;
      if (form.accountType !== current.accountType) input.accountType = form.accountType;
      if (bankName !== current.bankName) input.bankName = bankName;
      if (lastFourDigits !== current.lastFourDigits) input.lastFourDigits = lastFourDigits;
      if (form.accountingStartDate !== current.accountingStartDate) {
        input.accountingStartDate = form.accountingStartDate;
      }
      if (comment !== current.comment) input.comment = comment;
      if (form.startingBalance.trim()) {
        input.startingBalance = formHelper.normalizeDecimal(form.startingBalance);
      }
      if (Object.keys(input).length === 0) {
        statusMessage.value = 'Нет изменений для сохранения.';
        cancelForm();
        return;
      }

      await api.updateAccount(id, editingId.value, input);
      await loadAccounts();
      statusMessage.value = 'Счёт обновлён.';
      push({ tone: 'success', title: 'Счёт обновлён' });
    } else {
      const input: CreateAccountInput = {
        name: form.name,
        accountType: form.accountType,
        bankName: optionalText(form.bankName),
        lastFourDigits: optionalText(form.lastFourDigits),
        currency: 'RUB',
        startingBalance: formHelper.normalizeDecimal(form.startingBalance),
        accountingStartDate: form.accountingStartDate,
        comment: optionalText(form.comment),
      };
      await api.createAccount(id, input);
      await loadAccounts();
      statusMessage.value = 'Счёт создан.';
      push({ tone: 'success', title: 'Счёт создан' });
    }
    cancelForm();
  } catch (error) {
    const mapped = formHelper.errorMessage(error);
    fieldErrors.value = mapped.fields;
    statusMessage.value = mapped.summary;
    push({ tone: 'error', title: 'Не удалось сохранить', description: mapped.summary });
  } finally {
    saving.value = false;
  }
}

function requestArchive(account: AccountDto) {
  archiveTarget.value = account;
}

function cancelArchive() {
  if (!archiving.value) archiveTarget.value = null;
}

async function confirmArchive() {
  const id = budgetId.value;
  const target = archiveTarget.value;
  if (!id || !target) return;
  archiving.value = true;
  try {
    await api.archiveAccount(id, target.id);
    archiveTarget.value = null;
    detailed.value = null;
    await loadAccounts();
    statusMessage.value = 'Счёт перемещён в архив.';
    push({ tone: 'success', title: 'Счёт перемещён в архив' });
  } catch {
    statusMessage.value = 'Не удалось выполнить действие. Повторите попытку.';
  } finally {
    archiving.value = false;
  }
}

onMounted(() => {
  hydrated.value = true;
  void loadPage();
});
</script>

<template>
  <div v-if="hydrated" class="reference-page" data-hydrated="true">
    <template v-if="loadError">
      <UiEmptyState title="Счета недоступны" :description="loadError">
        <template #action><UiButton @click="loadPage">Повторить</UiButton></template>
      </UiEmptyState>
    </template>
    <UiEmptyState
      v-else-if="!loading && !budgetId"
      title="Бюджет не выбран"
      description="Выберите бюджет, чтобы управлять счетами."
    />
    <ReferencePageLayout v-else>
      <template #kicker>Справочники</template>
      <template #title>Счета</template>
      <template #description>Храните счета и их подтверждённые остатки.</template>
      <template #actions>
        <UiButton data-action="create-account" @click="startCreate">Создать счёт</UiButton>
      </template>
      <template #filters>
        <UiChip
          label="В архиве"
          :active="status === 'archived'"
          data-testid="chip-archived"
          @click="toggleArchived"
        />
      </template>
      <template #content>
        <UiStatus v-if="statusMessage" :label="statusMessage" tone="info" aria-live="polite" />

        <div
          v-if="loading && accounts.length === 0"
          data-testid="accounts-loading"
          aria-busy="true"
        >
          <UiSkeleton variant="row" :count="4" />
        </div>

        <template v-else>
          <p v-if="summary" class="accounts-page__total" data-testid="accounts-total">
            Всего на счетах
            <FinanceMoney
              :minor-units="summary.totalMinor"
              :currency="summary.currency"
              :scale="summary.scale"
            />
          </p>

          <UiEmptyState
            v-if="accounts.length === 0 && status === 'archived'"
            title="В архиве пусто"
            description="Архивные счета появятся здесь после архивирования."
          />
          <UiEmptyState
            v-else-if="accounts.length === 0"
            title="Счетов пока нет"
            description="Создайте счёт, чтобы вести на нём операции."
          >
            <template #action><UiButton @click="startCreate">Создать счёт</UiButton></template>
          </UiEmptyState>

          <div v-else class="accounts-page__panel">
            <ul class="accounts-page__list" aria-label="Список счетов">
              <li v-for="account in accounts" :key="account.id" class="accounts-page__list-item">
                <AccountRow :account="account" @select="detailed = account">
                  <template #actions>
                    <UiActionMenu
                      label="Действия над счётом"
                      :trigger-test-id="`row-actions-${account.id}`"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        data-testid="row-edit"
                        data-action="edit-account"
                        @click="startEdit(account)"
                      >
                        Изменить
                      </button>
                      <NuxtLink
                        role="menuitem"
                        data-testid="row-operations"
                        :to="`/app/operations?accountId=${encodeURIComponent(account.id)}`"
                      >
                        Операции счёта
                      </NuxtLink>
                      <NuxtLink
                        v-if="!account.archivedAt"
                        role="menuitem"
                        data-testid="row-transfer"
                        data-action="transfer-from-account"
                        :to="`/app/transfers?sourceAccountId=${encodeURIComponent(account.id)}`"
                      >
                        Перевести со счёта
                      </NuxtLink>
                      <button
                        v-if="!account.archivedAt"
                        type="button"
                        role="menuitem"
                        data-testid="row-archive"
                        data-action="archive-account"
                        @click="requestArchive(account)"
                      >
                        Переместить в архив
                      </button>
                    </UiActionMenu>
                  </template>
                </AccountRow>
              </li>
            </ul>
          </div>
        </template>
      </template>
    </ReferencePageLayout>

    <AccountDrawer
      :account="detailed"
      @close="detailed = null"
      @edit="startEdit"
      @archive="requestArchive"
    />

    <UiModal
      :open="formVisible"
      :title="editingId ? 'Изменить счёт' : 'Новый счёт'"
      @close="cancelForm"
    >
      <form data-account-form @submit.prevent="saveAccount">
        <UiInput
          v-model="form.name"
          name="name"
          label="Название счёта"
          :error="getFieldError('name')"
          required
        />
        <UiSelect
          v-model="form.accountType"
          name="accountType"
          label="Тип счёта"
          :options="getAccountTypeOptions()"
          :error="getFieldError('accountType')"
          required
        />
        <UiInput
          v-model="form.bankName"
          name="bankName"
          label="Банк"
          :error="getFieldError('bankName')"
        />
        <UiInput
          v-model="form.lastFourDigits"
          name="lastFourDigits"
          label="Последние четыре цифры карты"
          inputmode="numeric"
          :error="getFieldError('lastFourDigits')"
        />
        <UiInput
          v-model="form.startingBalance"
          name="startingBalance"
          label="Начальный баланс"
          tooltip="Сумма на счёте на дату начала учёта — используется только один раз, при создании счёта."
          hint="Оставьте пустым при редактировании, чтобы сохранить текущий баланс."
          :error="getFieldError('startingBalance')"
          :required="!editingId"
        />
        <UiInput
          v-model="form.accountingStartDate"
          name="accountingStartDate"
          label="Дата начала учёта"
          type="date"
          :error="getFieldError('accountingStartDate')"
          required
        />
        <label class="reference-form__field">
          <span>Комментарий</span>
          <textarea
            v-model="form.comment"
            name="comment"
            :aria-invalid="getFieldError('comment') ? 'true' : undefined"
          />
          <small v-if="getFieldError('comment')">{{ getFieldError('comment') }}</small>
        </label>
        <div class="reference-form__actions">
          <UiButton type="submit" :loading="saving">Сохранить счёт</UiButton>
          <UiButton type="button" variant="tertiary" :disabled="saving" @click="cancelForm"
            >Отмена</UiButton
          >
        </div>
      </form>
    </UiModal>

    <UiConfirmDialog
      :open="archiveTarget !== null"
      title="Архивировать счёт?"
      description="Счёт останется в истории, но будет недоступен для новых операций."
      confirm-label="Архивировать счёт"
      cancel-label="Отмена"
      variant="danger"
      :loading="archiving"
      @confirm="confirmArchive"
      @cancel="cancelArchive"
    />
  </div>
</template>

<style scoped>
form[data-account-form] {
  display: grid;
  gap: var(--hf-space-5);
}
.reference-form__field {
  display: grid;
  gap: var(--hf-space-2);
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
}
.reference-form__field textarea {
  min-height: 6rem;
  padding: var(--hf-space-3);
  resize: vertical;
  color: var(--hf-color-text);
  border: 1px solid var(--hf-color-border-strong);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  font: inherit;
}
.reference-form__field small {
  color: var(--hf-color-text-danger);
  font-weight: var(--hf-font-weight-regular);
}
.reference-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
}
.accounts-page__total {
  margin: 0;
  display: flex;
  gap: var(--hf-space-2);
  align-items: baseline;
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-h3);
  font-weight: var(--hf-font-weight-semibold);
}
.accounts-page__panel {
  padding: var(--hf-space-2);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.accounts-page__list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}
.accounts-page__list-item {
  min-width: 0;
}
.accounts-page__list-item + .accounts-page__list-item {
  border-top: 1px solid var(--hf-color-border);
}
</style>
