<script setup lang="ts">
import { useId } from 'vue';

import UiActionMenu from '../ui/ActionMenu.vue';
import UiCard from '../ui/Card.vue';
import type { Member } from '../../composables/useFamily.js';

defineOptions({ name: 'FamilyMembersCard' });

defineProps<{
  members: Member[];
  canManage: boolean;
}>();

defineEmits<{
  changeRole: [membershipId: string, role: 'EDITOR' | 'VIEWER'];
  remove: [member: Member];
}>();

const ROLE_LABELS: Record<Member['role'], string> = {
  OWNER: 'Создатель',
  EDITOR: 'Участник',
  VIEWER: 'Наблюдатель',
};

function displayedName(member: Member): string {
  return member.displayName ?? member.email;
}

function initial(member: Member): string {
  return displayedName(member).charAt(0).toUpperCase();
}

// One useId() prefix per card instance, reused per row by membershipId: the
// guideline requires a generated (not hardcoded) id so two instances of this
// card never collide, while membershipId alone already makes each row's menu
// unique within one card.
const menuIdPrefix = useId();

function menuListId(member: Member): string {
  return `family-member-menu-${menuIdPrefix}-${member.membershipId}`;
}
</script>

<template>
  <UiCard as="section" class="family-members-card" aria-labelledby="family-members-title">
    <template #header><h2 id="family-members-title">Участники</h2></template>
    <ul class="family-members-card__list">
      <li v-for="member in members" :key="member.membershipId" class="family-members-card__row">
        <span class="family-members-card__avatar" aria-hidden="true">{{ initial(member) }}</span>
        <span class="family-members-card__identity">
          <span class="family-members-card__name">{{ displayedName(member) }}</span>
          <span class="family-members-card__email">{{ member.email }}</span>
        </span>
        <span class="family-members-card__role">{{ ROLE_LABELS[member.role] }}</span>
        <UiActionMenu
          v-if="canManage && !member.isCreator"
          :label="`Действия: ${displayedName(member)}`"
          :list-id="menuListId(member)"
        >
          <button
            v-if="member.role !== 'VIEWER'"
            type="button"
            role="menuitem"
            @click="$emit('changeRole', member.membershipId, 'VIEWER')"
          >
            Сделать наблюдателем
          </button>
          <button
            v-if="member.role !== 'EDITOR'"
            type="button"
            role="menuitem"
            @click="$emit('changeRole', member.membershipId, 'EDITOR')"
          >
            Сделать участником
          </button>
          <button type="button" role="menuitem" @click="$emit('remove', member)">
            Удалить из семьи
          </button>
        </UiActionMenu>
      </li>
    </ul>
  </UiCard>
</template>

<style scoped>
.family-members-card__list {
  display: grid;
  gap: var(--hf-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.family-members-card__row {
  display: flex;
  align-items: center;
  gap: var(--hf-space-3);
  padding: var(--hf-space-2) 0;
}

.family-members-card__avatar {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text-muted);
  font-weight: var(--hf-font-weight-semibold);
}

.family-members-card__identity {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 0.125rem;
}

.family-members-card__name {
  overflow: hidden;
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.family-members-card__email {
  overflow: hidden;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.family-members-card__role {
  flex-shrink: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
</style>
