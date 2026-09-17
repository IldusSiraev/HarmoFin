<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { EllipsisVertical } from '@lucide/vue';

import UiTooltip from './Tooltip.vue';

defineOptions({ name: 'UiActionMenu' });

withDefaults(
  defineProps<{
    label: string;
    align?: 'start' | 'end';
    triggerTestId?: string | undefined;
    listId?: string | undefined;
    tooltip?: string | undefined;
    tooltipPlacement?: 'top' | 'bottom';
  }>(),
  {
    align: 'end',
    triggerTestId: undefined,
    listId: undefined,
    tooltip: undefined,
    tooltipPlacement: 'top',
  },
);

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);

function items(): HTMLElement[] {
  return [...(list.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
}

function focusTrigger(): void {
  root.value?.querySelector<HTMLElement>('.ui-action-menu__trigger')?.focus();
}

function toggle(): void {
  open.value = !open.value;
}

// Any menu item closes the menu: the consumer's click handler runs first,
// so the action still fires.
function handleItemClick(event: MouseEvent): void {
  const target = event.target;
  if (target instanceof HTMLElement && target.closest('[role="menuitem"]')) open.value = false;
}

function moveFocus(step: number): void {
  const all = items();
  if (all.length === 0) return;
  const current = all.indexOf(document.activeElement as HTMLElement);
  const next = current === -1 ? 0 : (current + step + all.length) % all.length;
  all[next]?.focus();
}

function handleListKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveFocus(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveFocus(-1);
  }
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !open.value) return;
  open.value = false;
  focusTrigger();
}

function handleDocumentClick(event: MouseEvent): void {
  if (!open.value) return;
  const target = event.target;
  if (target instanceof Node && root.value?.contains(target)) return;
  open.value = false;
}

onMounted(() => {
  document.addEventListener('keydown', handleDocumentKeydown);
  document.addEventListener('click', handleDocumentClick);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleDocumentKeydown);
  document.removeEventListener('click', handleDocumentClick);
});

function openAndFocusFirst(): void {
  open.value = true;
  void nextTick(() => items()[0]?.focus());
}

defineExpose({ openAndFocusFirst });
</script>

<template>
  <div ref="root" class="ui-action-menu">
    <UiTooltip v-slot="{ describedby }" :text="tooltip" :placement="tooltipPlacement">
      <button
        type="button"
        class="ui-action-menu__trigger"
        :data-testid="triggerTestId ?? 'action-menu-trigger'"
        :aria-label="label"
        aria-haspopup="menu"
        :aria-controls="listId"
        :aria-expanded="open ? 'true' : 'false'"
        :aria-describedby="describedby"
        @click="toggle"
      >
        <slot name="trigger"><EllipsisVertical :size="18" aria-hidden="true" /></slot>
      </button>
    </UiTooltip>

    <div
      v-if="open"
      :id="listId"
      ref="list"
      class="ui-action-menu__list"
      :class="`ui-action-menu__list--${align}`"
      data-testid="action-menu-list"
      role="menu"
      @click="handleItemClick"
      @keydown="handleListKeydown"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ui-action-menu {
  position: relative;
}

.ui-action-menu__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 0;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text-muted);
  cursor: pointer;
}

.ui-action-menu__trigger:hover {
  background: var(--hf-color-action-secondary-hover);
  color: var(--hf-color-text);
}

.ui-action-menu__trigger:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.ui-action-menu__list {
  position: absolute;
  top: 100%;
  z-index: 110;
  display: grid;
  min-width: 12rem;
  margin-top: var(--hf-space-1);
  padding: var(--hf-space-2);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-md);
}

.ui-action-menu__list--end {
  right: 0;
}

.ui-action-menu__list--start {
  left: 0;
}

.ui-action-menu__list :deep([role='menuitem']) {
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

.ui-action-menu__list :deep([role='menuitem']:hover) {
  background: var(--hf-color-action-secondary-hover);
}

.ui-action-menu__list :deep([role='menuitem']:focus-visible) {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: -2px;
}
</style>
