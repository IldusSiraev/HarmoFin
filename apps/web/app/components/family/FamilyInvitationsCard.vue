<script setup lang="ts">
import { useId } from 'vue';

import UiActionMenu from '../ui/ActionMenu.vue';
import UiCard from '../ui/Card.vue';
import UiEmptyState from '../ui/EmptyState.vue';
import type { Invitation } from '../../composables/useFamily.js';

defineOptions({ name: 'FamilyInvitationsCard' });

defineProps<{
  invitations: Invitation[];
}>();

defineEmits<{
  resend: [id: string];
  revoke: [id: string];
}>();

const ROLE_LABELS: Record<Invitation['role'], string> = {
  EDITOR: 'Участник',
  VIEWER: 'Наблюдатель',
};

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' });

function expiryLabel(invitation: Invitation): string {
  if (invitation.status === 'EXPIRED') return 'истекло';
  return `действует до ${dateFormatter.format(new Date(invitation.expiresAt))}`;
}

const menuIdPrefix = useId();

function menuListId(invitation: Invitation): string {
  return `family-invitation-menu-${menuIdPrefix}-${invitation.id}`;
}
</script>

<template>
  <UiCard as="section" class="family-invitations-card" aria-labelledby="family-invitations-title">
    <template #header><h2 id="family-invitations-title">Приглашения</h2></template>
    <UiEmptyState
      v-if="invitations.length === 0"
      title="Приглашений нет"
      description="Пригласите участника семьи, чтобы он получил доступ к бюджету."
    />
    <ul v-else class="family-invitations-card__list">
      <li
        v-for="invitation in invitations"
        :key="invitation.id"
        class="family-invitations-card__row"
      >
        <span class="family-invitations-card__identity">
          <span class="family-invitations-card__email">{{ invitation.email }}</span>
          <span class="family-invitations-card__meta">
            {{ ROLE_LABELS[invitation.role] }} · {{ expiryLabel(invitation) }}
          </span>
        </span>
        <UiActionMenu
          :label="`Действия: приглашение ${invitation.email}`"
          :list-id="menuListId(invitation)"
        >
          <button type="button" role="menuitem" @click="$emit('resend', invitation.id)">
            Отправить повторно
          </button>
          <button type="button" role="menuitem" @click="$emit('revoke', invitation.id)">
            Отозвать
          </button>
        </UiActionMenu>
      </li>
    </ul>
  </UiCard>
</template>

<style scoped>
.family-invitations-card__list {
  display: grid;
  gap: var(--hf-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.family-invitations-card__row {
  display: flex;
  align-items: center;
  gap: var(--hf-space-3);
  padding: var(--hf-space-2) 0;
}

.family-invitations-card__identity {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 0.125rem;
}

.family-invitations-card__email {
  overflow: hidden;
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.family-invitations-card__meta {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
</style>
