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
    tooltip="Добавить операцию или перевод"
    trigger-test-id="add-menu-trigger"
    list-id="app-add-menu"
  >
    <template #trigger>
      <Plus :size="18" aria-hidden="true" />
    </template>

    <button
      type="button"
      role="menuitem"
      data-testid="add-menu-income"
      @click="openOperation('INCOME')"
    >
      <Plus :size="16" aria-hidden="true" />
      Доход
    </button>
    <button
      type="button"
      role="menuitem"
      data-testid="add-menu-expense"
      @click="openOperation('EXPENSE')"
    >
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
  border-radius: var(--hf-button-radius);
  background: var(--hf-color-action-brand);
  color: var(--hf-color-white);
}

.app-add-menu :deep(.ui-action-menu__trigger:hover) {
  background: var(--hf-color-action-brand-hover);
  color: var(--hf-color-white);
}
</style>
