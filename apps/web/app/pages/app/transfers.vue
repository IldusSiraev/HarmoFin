<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { definePageMeta, useRoute } from '#imports';

import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import DirectTransferCard from '../../components/transfers/DirectTransferCard.vue';
import DirectTransferForm from '../../components/transfers/DirectTransferForm.vue';
import UiButton from '../../components/ui/Button.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiModal from '../../components/ui/Modal.vue';
import { useAuth } from '../../composables/useAuth.js';
import { ApiRequestError } from '../../composables/useApiClient.js';
import {
  useEnvelopePlanV2,
  type CreateDirectTransferRequest,
  type DirectTransferResponse,
} from '../../composables/useEnvelopePlanV2.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import { createTransferForm, type TransferFormModel } from '../../composables/useTransferForm.js';

defineOptions({ name: 'TransfersPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const auth = useAuth();
const route = useRoute();
// Transfers move money account to account only; transfers that were recorded
// with parts stay in the list as read-only history.
const transfers = ref<DirectTransferResponse[]>([]);
// Same cached reference lists the journal and the global dialogs read.
const { accounts, load: loadReferenceData } = useOperationReferenceData();
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
let directAttempt: { fingerprint: string; key: string } | null = null;

const accountNames = computed(
  () => new Map(accounts.value.map((account) => [account.value, account.label])),
);
const currency = computed(
  () => auth.currentData.value?.workspaces[0]?.budgets[0]?.primaryCurrency ?? 'RUB',
);
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
    // The list is strict: cursor/limit only, never a status filter.
    const cursor = append && nextCursor.value ? { cursor: nextCursor.value } : {};
    const [result] = await Promise.all([
      useEnvelopePlanV2().listDirectTransfers(id, cursor),
      loadReferenceData(),
    ]);
    transfers.value = append ? [...transfers.value, ...result.items] : result.items;
    nextCursor.value = result.nextCursor;
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

async function save(input: CreateDirectTransferRequest) {
  const id = budgetId.value;
  if (!id || pending.value) return;
  pending.value = true;
  error.value = '';
  formErrors.value = {};
  try {
    const fingerprint = JSON.stringify(input);
    if (directAttempt?.fingerprint !== fingerprint) {
      directAttempt = { fingerprint, key: crypto.randomUUID() };
    }
    await useEnvelopePlanV2().createTransfer(id, input, directAttempt.key);
    directAttempt = null;
    formOpen.value = false;
    statusText.value = 'Перевод сохранён.';
    await load();
  } catch (exception) {
    error.value = mapFormError(exception, v2ErrorMessage(exception, ''));
  } finally {
    pending.value = false;
  }
}

function mapFormError(exception: unknown, fallback = ''): string {
  if (!(exception instanceof ApiRequestError))
    return fallback || 'Не удалось сохранить перевод. Повторите попытку.';
  formErrors.value = Object.fromEntries(
    (exception.problem.fieldErrors ?? []).map((field) => [field.field, field.message]),
  );
  return Object.keys(formErrors.value).length > 0
    ? 'Укажите данные формы.'
    : fallback || 'Не удалось сохранить перевод. Повторите попытку.';
}
</script>

<template>
  <div v-if="hydrated" class="transfers-page" data-hydrated="true">
    <ReferencePageLayout>
      <template #kicker>Движение денег</template>
      <template #title>Переводы</template>
      <template #description>Перемещайте деньги между счетами.</template>
      <template #actions>
        <UiButton data-action="create-transfer" :disabled="loading" @click="openCreate"
          >Новый перевод</UiButton
        >
      </template>
      <template #content>
        <p v-if="statusText" class="transfers-page__status" role="status">{{ statusText }}</p>
        <p v-if="error && !formOpen" class="transfers-page__error" role="alert">
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
              <DirectTransferCard
                :transfer="transfer"
                :currency="currency"
                :account-names="accountNames"
              />
            </article>
          </section>
          <UiButton v-if="nextCursor" variant="secondary" :disabled="loading" @click="load(true)"
            >Загрузить ещё</UiButton
          >
        </template>
      </template>
    </ReferencePageLayout>

    <UiModal :open="formOpen" title="Новый перевод" @close="formOpen = false">
      <p v-if="error" class="transfers-page__error" role="alert">{{ error }}</p>
      <DirectTransferForm
        :model="form"
        :accounts="accounts"
        :errors="formErrors"
        :pending="pending"
        @submit="save"
      />
    </UiModal>
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
</style>
