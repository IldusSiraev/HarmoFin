<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { ArrowLeftRight, Minus, Plus } from '@lucide/vue';

import UiButton from '../ui/Button.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';

defineOptions({ name: 'AppAddMenu' });

const { openOperation, openTransfer } = useOperationDialogs();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

function focusTrigger(): void {
  root.value?.querySelector<HTMLElement>('[data-testid="add-menu-trigger"]')?.focus();
}

function toggle(): void {
  open.value = !open.value;
}

function chooseOperation(): void {
  open.value = false;
  openOperation();
}

function chooseTransfer(): void {
  open.value = false;
  openTransfer();
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !open.value) return;
  open.value = false;
  focusTrigger();
}

function handleClick(event: MouseEvent): void {
  if (!open.value) return;
  const target = event.target;
  if (target instanceof Node && root.value?.contains(target)) return;
  open.value = false;
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('click', handleClick);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('click', handleClick);
});
</script>

<template>
  <div ref="root" class="app-add-menu">
    <UiButton
      variant="brand"
      size="md"
      data-testid="add-menu-trigger"
      :aria-expanded="open ? 'true' : 'false'"
      aria-controls="app-add-menu"
      aria-haspopup="menu"
      @click="toggle"
    >
      <Plus :size="18" aria-hidden="true" />
      Добавить
    </UiButton>

    <div v-if="open" id="app-add-menu" class="app-add-menu__list" role="menu">
      <button
        type="button"
        role="menuitem"
        class="app-add-menu__item"
        data-testid="add-menu-income"
        @click="chooseOperation"
      >
        <Plus :size="16" aria-hidden="true" />
        Доход
      </button>
      <button
        type="button"
        role="menuitem"
        class="app-add-menu__item"
        data-testid="add-menu-expense"
        @click="chooseOperation"
      >
        <Minus :size="16" aria-hidden="true" />
        Расход
      </button>
      <button
        type="button"
        role="menuitem"
        class="app-add-menu__item"
        data-testid="add-menu-transfer"
        @click="chooseTransfer"
      >
        <ArrowLeftRight :size="16" aria-hidden="true" />
        Перевод
      </button>
    </div>
  </div>
</template>

<style scoped>
.app-add-menu {
  position: relative;
}

.app-add-menu__list {
  position: absolute;
  right: 0;
  z-index: 110;
  display: grid;
  min-width: 12rem;
  margin-top: var(--hf-space-2);
  padding: var(--hf-space-2);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-md);
}

.app-add-menu__item {
  display: flex;
  gap: var(--hf-space-2);
  align-items: center;
  min-height: 2.75rem;
  padding: 0 var(--hf-space-3);
  border: 0;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.app-add-menu__item:hover {
  background: var(--hf-color-action-secondary-hover);
}

.app-add-menu__item:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: -2px;
}
</style>
