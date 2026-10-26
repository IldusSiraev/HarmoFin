<script setup lang="ts">
import { useId } from 'vue';
import { Check, ChevronsUpDown, Plus } from '@lucide/vue';

import { useActiveWorkspace } from '../../composables/useActiveWorkspace.js';
import { useAuth } from '../../composables/useAuth.js';
import UiActionMenu from '../ui/ActionMenu.vue';

defineOptions({ name: 'AppWorkspaceSwitcher' });

const { workspaces, workspace } = useActiveWorkspace();
const { selectWorkspace, createPersonalWorkspace } = useAuth();
const listId = useId();

// A member without their own workspace could otherwise create several
// personal budgets by clicking this repeatedly — several budgets per creator
// are out of scope for v1, so the action disappears once they have one.
const hasOwnWorkspace = () => workspaces.value.some((item) => item.isCreator);
</script>

<template>
  <div class="workspace-switcher">
    <span class="workspace-switcher__name">{{ workspace?.name ?? 'Бюджет' }}</span>
    <UiActionMenu
      v-if="workspaces.length > 1 || !hasOwnWorkspace()"
      label="Сменить пространство"
      tooltip="Сменить пространство"
      tooltip-placement="bottom"
      align="start"
      :list-id="listId"
      trigger-test-id="workspace-switcher"
    >
      <template #trigger>
        <ChevronsUpDown :size="18" aria-hidden="true" />
      </template>
      <button
        v-for="item in workspaces"
        :key="item.id"
        type="button"
        role="menuitem"
        :aria-current="item.id === workspace?.id ? 'true' : undefined"
        :data-testid="`workspace-option-${item.id}`"
        @click="selectWorkspace(item.id)"
      >
        <Check v-if="item.id === workspace?.id" :size="16" aria-hidden="true" />
        <span>{{ item.name }}</span>
        <span v-if="item.id === workspace?.id" class="visually-hidden">(текущее)</span>
      </button>
      <button
        v-if="!hasOwnWorkspace()"
        type="button"
        role="menuitem"
        data-testid="workspace-create-personal"
        @click="createPersonalWorkspace()"
      >
        <Plus :size="16" aria-hidden="true" />
        <span>Создать личный бюджет</span>
      </button>
    </UiActionMenu>
  </div>
</template>

<style scoped>
.workspace-switcher {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-2);
  min-width: 0;
}

.workspace-switcher__name {
  overflow: hidden;
  min-width: 0;
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Visually hidden but still readable by assistive tech — the current item is
   already marked with a checkmark icon and aria-current, this text repeats
   that state for screen readers without taking visual space. */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
