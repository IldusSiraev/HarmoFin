<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { definePageMeta } from '#imports';

import AccountCard from '../../components/accounts/AccountCard.vue';
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../components/ui/Button.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiInput from '../../components/ui/Input.vue';
import UiModal from '../../components/ui/Modal.vue';
import UiSelect from '../../components/ui/Select.vue';
import UiStatus from '../../components/ui/Status.vue';
import { useAuth } from '../../composables/useAuth.js';
import {
  type AccountDto,
  type AccountType,
  type CreateAccountInput,
  type ReferenceStatus,
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
const api = useBudgetReferenceData();
const formHelper = useReferenceDataForm(accountFields);
const { push } = useToast();
const accounts = ref<AccountDto[]>([]);
const loading = ref(true);
const loadError = ref('');
const summary = ref('');
const saving = ref(false);
const archiving = ref(false);
const formVisible = ref(false);
const editingId = ref<string | null>(null);
const editingAccount = ref<AccountDto | null>(null);
const archiveTarget = ref<AccountDto | null>(null);
const status = ref<ReferenceStatus>('active');
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
function getStatusOptions() {
  return [
    { value: 'active', label: 'Активные' },
    { value: 'archived', label: 'В архиве' },
    { value: 'all', label: 'Все' },
  ];
}

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
  summary.value = '';
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
  formVisible.value = true;
  summary.value = '';
}

function cancelForm() {
  formVisible.value = false;
  editingId.value = null;
  editingAccount.value = null;
  resetForm();
}

async function loadAccounts() {
  const id = budgetId.value;
  if (!id) return;
  accounts.value = await api.listAccounts(id, status.value);
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

async function changeStatus(value: string) {
  status.value = value as ReferenceStatus;
  await loadAccounts();
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
  summary.value = '';
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
        summary.value = 'Нет изменений для сохранения.';
        cancelForm();
        return;
      }

      await api.updateAccount(id, editingId.value, input);
      await loadAccounts();
      summary.value = 'Счёт обновлён.';
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
      summary.value = 'Счёт создан.';
      push({ tone: 'success', title: 'Счёт создан' });
    }
    cancelForm();
  } catch (error) {
    const mapped = formHelper.errorMessage(error);
    fieldErrors.value = mapped.fields;
    summary.value = mapped.summary;
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
    await loadAccounts();
    summary.value = 'Счёт перемещён в архив.';
    push({ tone: 'success', title: 'Счёт перемещён в архив' });
  } catch {
    summary.value = 'Не удалось выполнить действие. Повторите попытку.';
  } finally {
    archiving.value = false;
  }
}

onMounted(() => {
  void loadPage();
});
</script>

<template>
  <div class="reference-page">
    <template v-if="loading">
      <UiStatus label="Загрузка счетов…" tone="info" aria-live="polite" />
    </template>
    <template v-else-if="loadError">
      <UiEmptyState title="Счета недоступны" :description="loadError">
        <template #action><UiButton @click="loadPage">Повторить</UiButton></template>
      </UiEmptyState>
    </template>
    <UiEmptyState
      v-else-if="!budgetId"
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
        <UiSelect
          class="reference-status-filter"
          :model-value="status"
          name="status"
          label="Показать счета"
          :options="getStatusOptions()"
          @update:model-value="changeStatus"
        />
      </template>
      <template #content>
        <UiStatus v-if="summary" :label="summary" tone="info" aria-live="polite" />
        <UiEmptyState
          v-if="accounts.length === 0"
          title="Счетов пока нет"
          description="Добавьте счёт, чтобы начать вести учёт."
        >
          <template #action><UiButton @click="startCreate">Создать счёт</UiButton></template>
        </UiEmptyState>
        <div v-else class="reference-grid">
          <AccountCard v-for="account in accounts" :key="account.id" :account="account">
            <template #actions>
              <UiButton variant="secondary" data-action="edit-account" @click="startEdit(account)"
                >Изменить</UiButton
              >
              <NuxtLink
                class="account-transfer-link"
                :to="`/app/operations?accountId=${encodeURIComponent(account.id)}`"
                >Операции счёта</NuxtLink
              >
              <NuxtLink
                v-if="!account.archivedAt"
                class="account-transfer-link"
                data-action="transfer-from-account"
                :to="`/app/transfers?sourceAccountId=${encodeURIComponent(account.id)}`"
                >Перевести со счёта</NuxtLink
              >
              <UiButton
                v-if="!account.archivedAt"
                variant="danger"
                data-action="archive-account"
                @click="requestArchive(account)"
                >Переместить в архив</UiButton
              >
            </template>
          </AccountCard>
        </div>
      </template>
    </ReferencePageLayout>

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
.reference-status-filter {
  max-width: 18rem;
}
.reference-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
  gap: var(--hf-space-5);
}
.account-transfer-link {
  display: inline-flex;
  align-items: center;
  min-height: var(--hf-control-height-md);
  color: var(--hf-color-action-primary-hover);
  font-weight: var(--hf-font-weight-medium);
  text-decoration: none;
}
.account-transfer-link:hover {
  text-decoration: underline;
}
</style>
