<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { navigateTo, useRoute } from '#imports';

import { ACCOUNT_TYPE_ICONS } from '../accounts/account-type.js';
import AppOperationEntryDialog from './AppOperationEntryDialog.vue';
import AppOperationTypeDialog from './AppOperationTypeDialog.vue';
import type { CreateTransactionInput } from '../../composables/useBudgetReferenceData.js';
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
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import { useToast } from '../../composables/useToast.js';

defineOptions({ name: 'AppOperationDialogs' });

const emit = defineEmits<{ saved: [] }>();

const { openDialog, entryType, transferSourceAccountId, openChoose, openOperation, openTransfer, close } =
  useOperationDialogs();
const { accountDetails, categories, envelopes, envelopePlans, budgetId, load } =
  useOperationReferenceData();
const { push } = useToast();
const funding = useFundingEntry();

const chooseOpen = computed(() => openDialog.value === 'choose');
const entryOpen = computed(() => openDialog.value === 'entry');

function chooseType(type: EntryType): void {
  if (type === 'TRANSFER') {
    openTransfer();
  } else {
    openOperation(type);
  }
}

const accountOptions = computed(() =>
  accountDetails.value.map((account) => ({
    value: account.id,
    label: account.name,
    icon: ACCOUNT_TYPE_ICONS[account.accountType],
  })),
);

// "Current" is the server's flag on the envelope's period bucket. Half-month
// envelopes are what "the current period" means to the user; a budget without
// them falls back to any current-expenses envelope with a running period.
const currentPeriodEnvelopeIds = computed(() => {
  const running = envelopePlans.value.filter(
    (envelope) =>
      envelope.envelopeType === 'CURRENT_EXPENSES' &&
      (envelope.periods ?? []).some((period) => period.current),
  );
  const halves = running.filter((envelope) => envelope.periodSlot !== null);
  return (halves.length > 0 ? halves : running).map((envelope) => envelope.id);
});

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

// Plain Errors keep their own message; API errors get the shared Russian text
// for known codes.
function describeV2(error: unknown, fallback: string): string {
  return v2ErrorMessage(error, error instanceof Error ? error.message : fallback);
}

const pending = ref(false);
const formError = ref('');

watch(openDialog, async (value) => {
  if (value === 'none') return;
  formError.value = '';
  await load();
});

// The installed app's «Добавить расход» shortcut (manifest.webmanifest) opens
// /app?entry=expense. Drop the parameter right away so a reload or the back
// button doesn't reopen the dialog.
const route = useRoute();
onMounted(() => {
  if (route.query.entry !== 'expense') return;
  openOperation('EXPENSE');
  const query = { ...route.query };
  delete query.entry;
  void navigateTo({ path: route.path, query }, { replace: true });
});

const entryDialog = ref<InstanceType<typeof AppOperationEntryDialog> | null>(null);

// "Save and add another" keeps the dialog open and hands it back a fresh
// entry; a plain save closes it.
async function saveOperation(input: CreateTransactionInput, addAnother = false): Promise<void> {
  const id = budgetId.value;
  if (!id || pending.value) return;
  pending.value = true;
  formError.value = '';
  try {
    // The money fact is saved first and on its own; assigning it is an
    // optional second step offered afterwards.
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
    const incomeId = isIncome ? saved.id : null;
    attempt = null;
    // On "add another" the dialog confirms the save in its own status line;
    // a toast too would be announced twice and could cover the form.
    if (addAnother) {
      entryDialog.value?.startNext(saved);
    } else {
      close();
      push({ tone: 'success', title: 'Операция сохранена' });
    }
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
</script>

<template>
  <div class="app-operation-dialogs">
    <AppOperationTypeDialog :open="chooseOpen" @close="close" @select="chooseType" />

    <AppOperationEntryDialog
      ref="entryDialog"
      :open="entryOpen"
      :initial-type="entryType ?? 'EXPENSE'"
      :accounts="accountOptions"
      :categories="categories"
      :envelopes="envelopes"
      :mandatory-envelope-ids="mandatoryEnvelopeIds"
      :current-period-envelope-ids="currentPeriodEnvelopeIds"
      :initial-source-account-id="transferSourceAccountId"
      :pending="pending"
      :error="formError"
      @close="close"
      @back="openChoose"
      @submit-operation="saveOperation"
      @submit-direct-transfer="saveDirectTransfer"
      @submit-one-time-pay="saveOneTimePayment"
    />
  </div>
</template>
