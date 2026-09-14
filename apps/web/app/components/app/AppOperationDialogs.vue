<script setup lang="ts">
import { computed } from 'vue';

import AddOperationModal from '../dashboard/AddOperationModal.vue';
import AddTransferModal from '../dashboard/AddTransferModal.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
import { useToast } from '../../composables/useToast.js';

defineOptions({ name: 'AppOperationDialogs' });

const emit = defineEmits<{ saved: [] }>();

const { openDialog, close } = useOperationDialogs();
const { push } = useToast();

const operationOpen = computed(() => openDialog.value === 'operation');
const transferOpen = computed(() => openDialog.value === 'transfer');

function handleSaved(title: string): void {
  close();
  push({ tone: 'success', title });
  emit('saved');
}
</script>

<template>
  <div class="app-operation-dialogs">
    <AddOperationModal
      :open="operationOpen"
      @close="close"
      @submit="handleSaved('Операция сохранена')"
    />
    <AddTransferModal
      :open="transferOpen"
      @close="close"
      @submit="handleSaved('Перевод сохранён')"
    />
  </div>
</template>
