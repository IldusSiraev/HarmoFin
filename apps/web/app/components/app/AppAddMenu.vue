<script setup lang="ts">
import { ArrowLeftRight, Minus, Plus } from '@lucide/vue';

import UiActionMenu from '../ui/ActionMenu.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';

defineOptions({ name: 'AppAddMenu' });

const { openOperation, openTransfer } = useOperationDialogs();
</script>

<template>
  <UiActionMenu
    class="app-add-menu"
    label="Добавить операцию или перевод"
    trigger-test-id="add-menu-trigger"
    list-id="app-add-menu"
  >
    <template #trigger>
      <Plus :size="18" aria-hidden="true" />
      Добавить
    </template>

    <button type="button" role="menuitem" data-testid="add-menu-income" @click="openOperation()">
      <Plus :size="16" aria-hidden="true" />
      Доход
    </button>
    <button type="button" role="menuitem" data-testid="add-menu-expense" @click="openOperation()">
      <Minus :size="16" aria-hidden="true" />
      Расход
    </button>
    <button type="button" role="menuitem" data-testid="add-menu-transfer" @click="openTransfer()">
      <ArrowLeftRight :size="16" aria-hidden="true" />
      Перевод
    </button>
  </UiActionMenu>
</template>

<style scoped>
.app-add-menu :deep(.ui-action-menu__trigger) {
  gap: var(--hf-space-2);
  width: auto;
  min-width: 2.75rem;
  padding: 0 var(--hf-button-padding-inline);
  border: 1px solid var(--hf-color-action-brand);
  border-radius: var(--hf-button-radius);
  background: var(--hf-color-action-brand);
  color: var(--hf-color-white);
  font-weight: var(--hf-button-font-weight);
}

.app-add-menu :deep(.ui-action-menu__trigger:hover) {
  border-color: var(--hf-color-action-brand-hover);
  background: var(--hf-color-action-brand-hover);
  color: var(--hf-color-white);
}
</style>
