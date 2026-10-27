<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { definePageMeta, navigateTo, useRoute } from '#imports';

import AccountDialog from '../../components/accounts/AccountDialog.vue';
import AccountRow from '../../components/accounts/AccountRow.vue';
import OwnerFilter from '../../components/app/OwnerFilter.vue';
import FinanceMoney from '../../components/finance/FinanceMoney.vue';
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../components/ui/Button.vue';
import UiButtonGroup from '../../components/ui/ButtonGroup.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import UiDatePicker from '../../components/ui/DatePicker.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiInput from '../../components/ui/Input.vue';
import UiModal from '../../components/ui/Modal.vue';
import UiSelect from '../../components/ui/Select.vue';
import UiSkeleton from '../../components/ui/Skeleton.vue';
import UiStatus from '../../components/ui/Status.vue';
import { ApiRequestError } from '../../composables/useApiClient.js';
import { useActiveWorkspace } from '../../composables/useActiveWorkspace.js';
import { useAuth } from '../../composables/useAuth.js';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
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
import { useEnvelopePlanV2 } from '../../composables/useEnvelopePlanV2.js';
import { useFundingEntry } from '../../composables/useFundingEntry.js';
import { useOwnerFilter } from '../../composables/useOwnerFilter.js';
import { usePermissions } from '../../composables/usePermissions.js';
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
const funding = useFundingEntry();
const v2 = useEnvelopePlanV2();
const { openDialog: globalOperationDialog } = useOperationDialogs();
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

const { budgetId } = useActiveWorkspace();
// The server checks every action again; the buttons only hide an action the
// role or the account owner would not be allowed to do.
const { canCreate, userId } = usePermissions();
const ownerFilter = useOwnerFilter();

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
  // Close the account dialog first, otherwise the form opens stacked on top of it.
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
  // A reference record may have just changed, so the shared cache the journal
  // and the global dialogs read must not stay on old names.
  useOperationReferenceData().invalidate();
  const ownerUserId = ownerFilter.ownerUserId.value;
  const [items, totals] = await Promise.all([
    api.listAccounts(id, status.value, ownerUserId),
    api.getAccountsSummary(id, status.value, ownerUserId),
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

const STATUS_OPTIONS = [
  { value: 'active', label: 'Активные' },
  { value: 'archived', label: 'В архиве' },
];

async function changeStatus(value: string): Promise<void> {
  if (value === status.value) return;
  status.value = value === 'archived' ? 'archived' : 'active';
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

// Text check only (no arithmetic): is there a non-zero, non-negative amount.
function hasPositiveAmount(value: string): boolean {
  return /^\+?\d*\.?\d*$/.test(value) && /[1-9]/.test(value);
}

// The opening assignment opens right away only once the initial setup is over:
// before the first assignment the checklist leads to it after the mandatory
// payments and the period plan. The server decides; a failed read never opens it.
async function initialSetupPending(budgetId: string): Promise<boolean> {
  try {
    return (await v2.getDashboard(budgetId)).onboarding.needsOpeningAssignment;
  } catch {
    return true;
  }
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
      // Envelope Plan v2.2: initial money may be assigned, but only if the user
      // wants to; the account and its balance are already saved either way.
      const offerAssignment =
        hasPositiveAmount(input.startingBalance) && !(await initialSetupPending(id));
      push({
        tone: 'success',
        title: 'Счёт создан',
        ...(hasPositiveAmount(input.startingBalance) && !offerAssignment
          ? {
              description:
                'Распределить деньги по конвертам можно на главной, в мастере «Начало работы».',
            }
          : {}),
      });
      if (offerAssignment) funding.offer({ sourceKind: 'OPENING' });
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

function archiveErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.problem.code === 'ACCOUNT_HAS_BALANCE') {
    return 'Счёт нельзя архивировать: на нём есть остаток. Переведите остаток на другой счёт и повторите.';
  }
  return 'Не удалось выполнить действие. Повторите попытку.';
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
  } catch (error) {
    // A refused archive must not leave the modal dialog covering the page.
    archiveTarget.value = null;
    const summary = archiveErrorMessage(error);
    statusMessage.value = summary;
    push({ tone: 'error', title: 'Не удалось архивировать счёт', description: summary });
  } finally {
    archiving.value = false;
  }
}

onMounted(() => {
  hydrated.value = true;
  void loadPage();
});

// A transfer made through the global "Перевести со счёта" dialog changes account
// balances; without this the page would keep showing stale balances until reload.
watch(globalOperationDialog, (value, previous) => {
  if (value === 'none' && previous !== 'none') void loadAccounts();
});

// The owner filter is page-local state (not in the URL), so a change just
// re-requests the list and the total without switching the status segment.
watch(
  () => ownerFilter.mode.value,
  () => {
    if (budgetId.value) void loadAccounts();
  },
);
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
      <template #description>
        Счёт — это место, где физически находятся деньги: карта, банковский счёт или наличные.
      </template>
      <template #actions>
        <UiButton v-if="canCreate" data-action="create-account" @click="startCreate">
          Создать счёт
        </UiButton>
      </template>
      <template #filters>
        <UiButtonGroup
          :options="STATUS_OPTIONS"
          :model-value="status"
          label="Показать счета"
          testid-prefix="status"
          @update:model-value="changeStatus"
        />
        <OwnerFilter
          v-if="ownerFilter.kind.value !== 'none'"
          v-model="ownerFilter.mode.value"
          :kind="ownerFilter.kind.value"
          :options="ownerFilter.options.value"
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
            <template v-if="canCreate" #action>
              <UiButton @click="startCreate">Создать счёт</UiButton>
            </template>
          </UiEmptyState>

          <ul v-else class="accounts-page__grid" aria-label="Список счетов">
            <li v-for="account in accounts" :key="account.id">
              <AccountRow
                :account="account"
                :show-owner="ownerFilter.kind.value !== 'none'"
                :user-id="userId"
                @select="detailed = account"
              />
            </li>
          </ul>
        </template>
      </template>
    </ReferencePageLayout>

    <AccountDialog
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
        <div class="reference-form__row">
          <span class="reference-form__row-label">Справочно</span>
          <div class="reference-form__row-fields">
            <UiInput
              v-model="form.bankName"
              name="bankName"
              label="Банк"
              hint="Необязательно"
              :error="getFieldError('bankName')"
            />
            <UiInput
              v-model="form.lastFourDigits"
              name="lastFourDigits"
              label="Последние 4 цифры карты"
              hint="Необязательно"
              inputmode="numeric"
              :error="getFieldError('lastFourDigits')"
            />
          </div>
        </div>
        <UiInput
          v-model="form.startingBalance"
          name="startingBalance"
          label="Начальный баланс"
          tooltip="Сумма на счёте на дату начала учёта — используется только один раз, при создании счёта."
          hint="Оставьте пустым при редактировании, чтобы сохранить текущий баланс."
          :error="getFieldError('startingBalance')"
          :required="!editingId"
        />
        <UiDatePicker
          v-model="form.accountingStartDate"
          name="accountingStartDate"
          label="Дата начала учёта"
          :error="getFieldError('accountingStartDate')"
          required
        />
        <label class="reference-form__field">
          <span>Комментарий</span>
          <textarea
            v-model="form.comment"
            autocomplete="off"
            name="comment"
            :aria-invalid="getFieldError('comment') ? 'true' : undefined"
          />
          <small v-if="getFieldError('comment')">{{ getFieldError('comment') }}</small>
        </label>
        <div class="reference-form__actions">
          <UiButton type="submit" :loading="saving">Сохранить счёт</UiButton>
          <UiButton type="button" variant="tertiary" :disabled="saving" @click="cancelForm">
            Отмена
          </UiButton>
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
.reference-form__row {
  display: grid;
  gap: var(--hf-space-2);
}
.reference-form__row-label {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
}
.reference-form__row-fields {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--hf-space-4);
}
@media (min-width: 480px) {
  .reference-form__row-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
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
.accounts-page__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--hf-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}
.accounts-page__grid > li {
  min-width: 0;
}
@media (min-width: 640px) {
  .accounts-page__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
