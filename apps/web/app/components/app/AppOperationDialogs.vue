<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import OperationForm from '../operations/OperationForm.vue';
import TransferForm from '../transfers/TransferForm.vue';
import UiModal from '../ui/Modal.vue';
import AppOperationTypeDialog from './AppOperationTypeDialog.vue';
import {
  useBudgetReferenceData,
  type CreateTransactionInput,
  type CreateTransferInput,
  type UpdateTransactionInput,
} from '../../composables/useBudgetReferenceData.js';
import {
  createOperationForm,
  type OperationFormModel,
} from '../../composables/useOperationForm.js';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';
import { createTransferForm, type TransferFormModel } from '../../composables/useTransferForm.js';
import { useToast } from '../../composables/useToast.js';

defineOptions({ name: 'AppOperationDialogs' });

const emit = defineEmits<{ saved: [] }>();

const api = useBudgetReferenceData();
const { openDialog, presetType, openOperation, openTransfer, close } = useOperationDialogs();
const { accounts, categories, envelopes, budgetId, load } = useOperationReferenceData();
const { push } = useToast();

const chooseOpen = computed(() => openDialog.value === 'choose');
const operationOpen = computed(() => openDialog.value === 'operation');
const transferOpen = computed(() => openDialog.value === 'transfer');

function chooseType(type: 'EXPENSE' | 'INCOME' | 'TRANSFER'): void {
  if (type === 'TRANSFER') {
    openTransfer();
  } else {
    openOperation(type);
  }
}
const operationModel = ref<OperationFormModel>(createOperationForm());
const transferModel = ref<TransferFormModel>(createTransferForm());
const pending = ref(false);
const formError = ref('');

watch(openDialog, async (value) => {
  if (value === 'none') return;
  formError.value = '';
  await load();
  if (value === 'operation') {
    operationModel.value = {
      ...createOperationForm(),
      transactionType: presetType.value ?? 'EXPENSE',
    };
  } else {
    transferModel.value = createTransferForm();
  }
});

async function saveOperation(
  input: CreateTransactionInput | UpdateTransactionInput,
): Promise<void> {
  const id = budgetId.value;
  if (!id) return;
  pending.value = true;
  try {
    await api.createTransaction(id, input as CreateTransactionInput, crypto.randomUUID());
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

    <UiModal :open="operationOpen" title="Новая операция" @close="close">
      <p v-if="formError" class="app-operation-dialogs__error" role="alert">{{ formError }}</p>
      <OperationForm
        mode="create"
        :model="operationModel"
        :accounts="accounts"
        :categories="categories"
        :envelopes="envelopes"
        :pending="pending"
        @submit="saveOperation"
      />
    </UiModal>

    <UiModal :open="transferOpen" title="Новый перевод" @close="close">
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
