<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import TransferForm from '../transfers/TransferForm.vue';
import UiModal from '../ui/Modal.vue';
import AppOperationEntryDialog from './AppOperationEntryDialog.vue';
import AppOperationTypeDialog from './AppOperationTypeDialog.vue';
import {
  useBudgetReferenceData,
  type CreateTransactionInput,
  type CreateTransferInput,
} from '../../composables/useBudgetReferenceData.js';
import {
  useEnvelopePlanV2,
  type CreateDirectTransferRequest,
  type CreateTransactionV2Request,
  type OneTimeObligationPayRequest,
} from '../../composables/useEnvelopePlanV2.js';
import { useFundingEntry } from '../../composables/useFundingEntry.js';
import { useOperationDialogs, type EntryType } from '../../composables/useOperationDialogs.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';
import type { OneTimePayEntry } from '../../composables/useOperationForm.js';
import { createTransferForm, type TransferFormModel } from '../../composables/useTransferForm.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import { useToast } from '../../composables/useToast.js';

defineOptions({ name: 'AppOperationDialogs' });

const emit = defineEmits<{ saved: [] }>();

const api = useBudgetReferenceData();
const {
  openDialog,
  entryType,
  openChoose,
  openOperation,
  openTransfer,
  openTransferAdvanced,
  close,
} = useOperationDialogs();
const { accounts, categories, envelopes, envelopePlans, budgetId, load } =
  useOperationReferenceData();
const { push } = useToast();
const funding = useFundingEntry();

const chooseOpen = computed(() => openDialog.value === 'choose');
const entryOpen = computed(() => openDialog.value === 'entry');
const advancedOpen = computed(() => openDialog.value === 'transferAdvanced');

function chooseType(type: EntryType): void {
  if (type === 'TRANSFER') {
    openTransfer();
  } else {
    openOperation(type);
  }
}

const modelV2 = computed(() => funding.isModelV2());
const mandatoryEnvelopeIds = computed(() =>
  envelopePlans.value
    .filter((envelope) => envelope.envelopeType === 'MANDATORY_EXPENSES')
    .map((envelope) => envelope.id),
);

// One Idempotency-Key per user attempt: a retry of the same request reuses it,
// any changed field starts a new attempt with a new key.
let attempt: { fingerprint: string; key: string } | null = null;
function attemptKey(kind: string, payload: unknown): string {
  const fingerprint = `${kind}:${JSON.stringify(payload)}`;
  if (attempt?.fingerprint !== fingerprint) {
    attempt = { fingerprint, key: crypto.randomUUID() };
  }
  return attempt.key;
}

// Plain Errors keep their own message; API errors of v2 flows get the shared
// Russian text for known codes.
function describeV2(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  return modelV2.value ? v2ErrorMessage(error, message) : message;
}

const transferModel = ref<TransferFormModel>(createTransferForm());
const pending = ref(false);
const formError = ref('');

watch(openDialog, async (value) => {
  if (value === 'none') return;
  formError.value = '';
  await load();
});

// The quick transfer view hands over its already-filled-in fields so the
// rare split-by-envelope case does not force retyping the amount and accounts.
function startAdvancedTransfer(model: TransferFormModel): void {
  transferModel.value = model;
  openTransferAdvanced();
}

async function saveOperation(input: CreateTransactionInput): Promise<void> {
  const id = budgetId.value;
  if (!id || pending.value) return;
  pending.value = true;
  try {
    // Envelope Plan v2.2 budgets save income through the v2 endpoint (the v1
    // create is closed to them). The money fact is saved first and on its own;
    // assigning it is an optional second step offered afterwards.
    let incomeId: string | null = null;
    if (modelV2.value) {
      const isIncome = input.transactionType === 'INCOME';
      const comment = isIncome ? input.sourceDescription : input.merchantName;
      const body: CreateTransactionV2Request = {
        transactionType: input.transactionType,
        status: 'CONFIRMED',
        amount: input.amount,
        occurredOn: input.occurredOn,
        accountId: input.accountId,
        categoryId: input.categoryId,
        // An expense without a chosen envelope is explicitly unassigned.
        ...(isIncome ? {} : { envelopeId: input.envelopeId ? input.envelopeId : null }),
        ...(comment ? { comment } : {}),
      };
      const saved = await useEnvelopePlanV2().createTransaction(
        id,
        body,
        attemptKey('transaction', body),
      );
      if (isIncome) incomeId = saved.id;
    } else {
      await api.createTransaction(id, input, crypto.randomUUID());
    }
    attempt = null;
    close();
    push({ tone: 'success', title: 'Операция сохранена' });
    emit('saved');
    if (incomeId !== null) funding.offer({ sourceKind: 'INCOME', incomeTransactionId: incomeId });
  } catch (error) {
    formError.value = describeV2(error, 'Не удалось сохранить операцию.');
    push({ tone: 'error', title: 'Не удалось сохранить операцию' });
  } finally {
    pending.value = false;
  }
}

async function saveOneTimePayment(entry: OneTimePayEntry): Promise<void> {
  const id = budgetId.value;
  if (!id || pending.value) return;
  pending.value = true;
  formError.value = '';
  try {
    const body: OneTimeObligationPayRequest = {
      name: entry.name,
      plannedAmount: entry.amount,
      actualAmount: entry.amount,
      occurredOn: entry.occurredOn,
      accountId: entry.accountId,
      categoryId: entry.categoryId,
      ...(entry.comment ? { comment: entry.comment } : {}),
    };
    await useEnvelopePlanV2().payOneTimeObligation(id, body, attemptKey('one-time', body));
    attempt = null;
    close();
    push({ tone: 'success', title: 'Разовый платёж оплачен' });
    emit('saved');
  } catch (error) {
    formError.value = describeV2(error, 'Не удалось оплатить платёж.');
    push({ tone: 'error', title: 'Не удалось оплатить платёж' });
  } finally {
    pending.value = false;
  }
}

async function saveDirectTransfer(input: CreateDirectTransferRequest): Promise<void> {
  const id = budgetId.value;
  if (!id || pending.value) return;
  pending.value = true;
  formError.value = '';
  try {
    await useEnvelopePlanV2().createTransfer(id, input, attemptKey('transfer', input));
    attempt = null;
    close();
    push({ tone: 'success', title: 'Перевод сохранён' });
    emit('saved');
  } catch (error) {
    formError.value = describeV2(error, 'Не удалось сохранить перевод.');
    push({ tone: 'error', title: 'Не удалось сохранить перевод' });
  } finally {
    pending.value = false;
  }
}

async function saveTransfer(input: CreateTransferInput): Promise<void> {
  const id = budgetId.value;
  if (!id || pending.value) return;
  pending.value = true;
  try {
    await api.createTransfer(id, input, crypto.randomUUID());
    close();
    push({ tone: 'success', title: 'Перевод сохранён' });
    emit('saved');
  } catch (error) {
    formError.value = error instanceof Error ? error.message : 'Не удалось сохранить перевод.';
    push({ tone: 'error', title: 'Не удалось сохранить перевод' });
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="app-operation-dialogs">
    <AppOperationTypeDialog :open="chooseOpen" @close="close" @select="chooseType" />

    <AppOperationEntryDialog
      :open="entryOpen"
      :initial-type="entryType ?? 'EXPENSE'"
      :accounts="accounts"
      :categories="categories"
      :envelopes="envelopes"
      :model-v2="modelV2"
      :mandatory-envelope-ids="mandatoryEnvelopeIds"
      :pending="pending"
      :error="formError"
      @close="close"
      @back="openChoose"
      @submit-operation="saveOperation"
      @submit-transfer="saveTransfer"
      @submit-direct-transfer="saveDirectTransfer"
      @submit-one-time-pay="saveOneTimePayment"
      @split-transfer="startAdvancedTransfer"
    />

    <UiModal :open="advancedOpen" title="Перевод с разбивкой по конвертам" @close="close">
      <p v-if="formError" class="app-operation-dialogs__error" role="alert">{{ formError }}</p>
      <TransferForm
        :model="transferModel"
        :accounts="accounts"
        :envelopes="envelopes"
        :pending="pending"
        @submit="saveTransfer"
      />
    </UiModal>
  </div>
</template>

<style scoped>
.app-operation-dialogs__error {
  margin: 0 0 var(--hf-space-3);
  color: var(--hf-color-text-danger);
}
</style>
