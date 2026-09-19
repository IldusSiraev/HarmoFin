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
import { useOperationDialogs, type EntryType } from '../../composables/useOperationDialogs.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';
import { createTransferForm, type TransferFormModel } from '../../composables/useTransferForm.js';
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
const { accounts, categories, envelopes, budgetId, load } = useOperationReferenceData();
const { push } = useToast();

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
  if (!id) return;
  pending.value = true;
  try {
    await api.createTransaction(id, input, crypto.randomUUID());
    close();
    push({ tone: 'success', title: 'Операция сохранена' });
    emit('saved');
  } catch (error) {
    formError.value = error instanceof Error ? error.message : 'Не удалось сохранить операцию.';
    push({ tone: 'error', title: 'Не удалось сохранить операцию' });
  } finally {
    pending.value = false;
  }
}

async function saveTransfer(input: CreateTransferInput): Promise<void> {
  const id = budgetId.value;
  if (!id) return;
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
      :pending="pending"
      :error="formError"
      @close="close"
      @back="openChoose"
      @submit-operation="saveOperation"
      @submit-transfer="saveTransfer"
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
