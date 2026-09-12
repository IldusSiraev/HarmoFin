<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { definePageMeta, useRoute } from '#imports';

import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import TransferCard from '../../components/transfers/TransferCard.vue';
import TransferForm from '../../components/transfers/TransferForm.vue';
import UiButton from '../../components/ui/Button.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiModal from '../../components/ui/Modal.vue';
import UiSelect from '../../components/ui/Select.vue';
import { useAuth } from '../../composables/useAuth.js';
import { ApiRequestError } from '../../composables/useApiClient.js';
import {
  type CreateTransferInput,
  type TransferDto,
  type TransferStatus,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';
import { createTransferForm, type TransferFormModel } from '../../composables/useTransferForm.js';

defineOptions({ name: 'TransfersPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const auth = useAuth();
const api = useBudgetReferenceData();
const route = useRoute();
const transfers = ref<TransferDto[]>([]);
const accounts = ref<Array<{ value: string; label: string }>>([]);
const envelopes = ref<Array<{ value: string; label: string }>>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(true);
const hydrated = ref(false);
const pending = ref(false);
const error = ref('');
const statusText = ref('');
const formErrors = ref<Partial<Record<string, string>>>({});
const formOpen = ref(false);
const prefilledSourceAccountId = ref('');
const form = ref<TransferFormModel>(createTransferForm());
const statusFilter = ref<TransferStatus | ''>('');
const confirmation = ref<
  | { action: 'create'; input: CreateTransferInput }
  | { action: 'confirm' | 'cancel' | 'delete'; transfer: TransferDto }
  | null
>(null);

const budgetId = computed(() => auth.currentData.value?.workspaces[0]?.budgets[0]?.id ?? null);

onMounted(() => {
  hydrated.value = true;
  void load();
});

async function load(append = false) {
  if (!budgetId.value) {
    try {
      await auth.loadMe();
    } catch {
      error.value = 'Не удалось загрузить бюджет.';
    }
  }
  const id = budgetId.value;
  if (!id) {
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const [result, accountData, envelopeData] = await Promise.all([
      api.listTransfers(id, {
        ...(statusFilter.value ? { status: statusFilter.value } : {}),
        ...(append && nextCursor.value ? { cursor: nextCursor.value } : {}),
      }),
      api.listAccounts(id, 'active'),
      api.listEnvelopes(id, 'active'),
    ]);
    transfers.value = append ? [...transfers.value, ...result.items] : result.items;
    nextCursor.value = result.nextCursor;
    accounts.value = accountData.map((account) => ({ value: account.id, label: account.name }));
    envelopes.value = envelopeData.map((envelope) => ({
      value: envelope.id,
      label: envelope.name,
    }));
    const sourceAccountId = route.query.sourceAccountId;
    prefilledSourceAccountId.value =
      typeof sourceAccountId === 'string' &&
      accounts.value.some((account) => account.value === sourceAccountId)
        ? sourceAccountId
        : '';
  } catch {
    error.value = 'Не удалось загрузить переводы. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  form.value = createTransferForm(prefilledSourceAccountId.value);
  formErrors.value = {};
  error.value = '';
  formOpen.value = true;
}

function receiveForm(input: CreateTransferInput) {
  if (input.status === 'CONFIRMED') {
    confirmation.value = { action: 'create', input };
    return;
  }
  void saveCreate(input);
}

async function saveCreate(input: CreateTransferInput) {
  const id = budgetId.value;
  if (!id) return;
  pending.value = true;
  error.value = '';
  formErrors.value = {};
  try {
    await api.createTransfer(id, input, crypto.randomUUID());
    formOpen.value = false;
    statusText.value =
      input.status === 'DRAFT' ? 'Черновик перевода сохранён.' : 'Перевод подтверждён.';
    await load();
  } catch (exception) {
    error.value = mapFormError(exception);
  } finally {
    pending.value = false;
  }
}

function requestAction(action: 'confirm' | 'cancel' | 'delete', transfer: TransferDto) {
  confirmation.value = { action, transfer };
}

async function confirmAction() {
  const current = confirmation.value;
  const id = budgetId.value;
  if (!current || !id) return;
  confirmation.value = null;
  if (current.action === 'create') {
    await saveCreate(current.input);
    return;
  }
  pending.value = true;
  error.value = '';
  try {
    const key = crypto.randomUUID();
    if (current.action === 'confirm') await api.confirmTransfer(id, current.transfer.id, key);
    if (current.action === 'cancel') await api.cancelTransfer(id, current.transfer.id, key);
    if (current.action === 'delete') await api.deleteTransfer(id, current.transfer.id, key);
    statusText.value = 'Данные обновлены на сервере.';
    await load();
  } catch {
    error.value = 'Не удалось выполнить действие. Повторите попытку.';
  } finally {
    pending.value = false;
  }
}

function mapFormError(exception: unknown): string {
  if (!(exception instanceof ApiRequestError))
    return 'Не удалось сохранить перевод. Повторите попытку.';
  formErrors.value = Object.fromEntries(
    (exception.problem.fieldErrors ?? []).map((field) => [field.field, field.message]),
  );
  return Object.keys(formErrors.value).length > 0
    ? 'Укажите данные формы.'
    : 'Не удалось сохранить перевод. Повторите попытку.';
}

async function changeStatus(value: string) {
  statusFilter.value = value as TransferStatus | '';
  await load();
}

function dialogTitle() {
  if (confirmation.value?.action === 'delete') return 'Удалить перевод?';
  if (confirmation.value?.action === 'cancel') return 'Отменить перевод?';
  return 'Подтвердить действие?';
}

function dialogDescription() {
  return confirmation.value?.action === 'delete'
    ? 'Перевод останется в истории, но перестанет влиять на балансы.'
    : 'Действие изменит серверные финансовые данные.';
}
</script>

<template>
  <div v-if="hydrated" class="transfers-page" data-hydrated="true">
    <ReferencePageLayout>
      <template #kicker>Движение денег</template>
      <template #title>Переводы</template>
      <template #description
        >Перемещайте деньги между счетами, сохраняя назначение по конвертам.</template
      >
      <template #actions>
        <UiButton data-action="create-transfer" :disabled="loading" @click="openCreate"
          >Новый перевод</UiButton
        >
      </template>
      <template v-if="!loading && budgetId" #filters>
        <UiSelect
          :model-value="statusFilter"
          name="status"
          label="Статус перевода"
          :options="[
            { value: '', label: 'Все статусы' },
            { value: 'DRAFT', label: 'Черновики' },
            { value: 'CONFIRMED', label: 'Подтверждённые' },
            { value: 'CANCELLED', label: 'Отменённые' },
            { value: 'DELETED', label: 'Удалённые' },
          ]"
          @update:model-value="changeStatus"
        />
      </template>
      <template #content>
        <p v-if="statusText" class="transfers-page__status" role="status">{{ statusText }}</p>
        <p v-if="error" class="transfers-page__error" role="alert">
          {{ error }} <UiButton variant="tertiary" @click="load()">Повторить</UiButton>
        </p>
        <UiEmptyState
          v-if="!loading && !budgetId"
          title="Бюджет не выбран"
          description="Выберите бюджет, чтобы управлять переводами."
        />
        <template v-else>
          <p v-if="loading">Загрузка переводов…</p>
          <UiEmptyState
            v-else-if="transfers.length === 0"
            title="Переводов пока нет"
            description="Создайте перевод, чтобы переместить деньги между счетами."
          />
          <section v-else class="transfers-page__list" aria-label="Список переводов">
            <article v-for="transfer in transfers" :key="transfer.id" class="transfers-page__item">
              <TransferCard :transfer="transfer" />
              <div class="transfers-page__actions">
                <UiButton
                  v-if="transfer.status === 'DRAFT'"
                  variant="secondary"
                  @click="requestAction('confirm', transfer)"
                  >Подтвердить</UiButton
                >
                <UiButton
                  v-if="transfer.status === 'DRAFT'"
                  variant="tertiary"
                  @click="requestAction('cancel', transfer)"
                  >Отменить</UiButton
                >
                <UiButton
                  v-if="transfer.status !== 'DELETED'"
                  variant="tertiary"
                  @click="requestAction('delete', transfer)"
                  >Удалить</UiButton
                >
              </div>
            </article>
          </section>
          <UiButton v-if="nextCursor" variant="secondary" :disabled="loading" @click="load(true)"
            >Загрузить ещё</UiButton
          >
        </template>
      </template>
    </ReferencePageLayout>

    <UiModal :open="formOpen" title="Новый перевод" @close="formOpen = false">
      <TransferForm
        :model="form"
        :accounts="accounts"
        :envelopes="envelopes"
        :errors="formErrors"
        :pending="pending"
        @submit="receiveForm"
      />
    </UiModal>

    <UiConfirmDialog
      :open="confirmation !== null"
      :title="dialogTitle()"
      :description="dialogDescription()"
      confirm-label="Подтвердить"
      cancel-label="Отмена"
      :variant="confirmation?.action === 'delete' ? 'danger' : 'primary'"
      :loading="pending"
      @confirm="confirmAction"
      @cancel="confirmation = null"
    />
  </div>
</template>

<style scoped>
.transfers-page__status {
  margin-bottom: var(--hf-space-4);
  color: var(--hf-color-status-success);
}
.transfers-page__error {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  margin-bottom: var(--hf-space-4);
  color: var(--hf-color-text-danger);
}
.transfers-page__list {
  display: grid;
  gap: var(--hf-space-4);
}
.transfers-page__item {
  display: grid;
  gap: var(--hf-space-3);
}
.transfers-page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}
</style>
