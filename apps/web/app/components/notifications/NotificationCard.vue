<script setup lang="ts">
import { UserMinus, UserPlus, UserX } from '@lucide/vue';
import type { Component } from 'vue';

import type { NotificationDto, NotificationType } from '../../composables/useBudgetReferenceData.js';

const props = defineProps<{ notification: NotificationDto }>();
defineEmits<{ open: [event: MouseEvent] }>();

// Access-event types only: plan/financial notifications keep their plain
// title/body with no icon.
const MEMBER_EVENT_ICONS: Partial<Record<NotificationType, Component>> = {
  MEMBER_JOINED: UserPlus,
  MEMBER_LEFT: UserMinus,
  MEMBER_REMOVED: UserX,
};

function stateText() {
  return props.notification.readAt ? 'Прочитано' : 'Новое';
}

function memberEventIcon(): Component | null {
  return MEMBER_EVENT_ICONS[props.notification.notificationType] ?? null;
}
</script>

<template>
  <article class="notification-card" :class="{ 'notification-card--unread': !notification.readAt }">
    <div class="notification-card__meta">
      <span>{{ stateText() }}</span>
      <time :datetime="notification.createdAt">{{ notification.createdAt.slice(0, 10) }}</time>
    </div>
    <h2 class="notification-card__title">
      <component :is="memberEventIcon()" v-if="memberEventIcon()" class="notification-card__icon" aria-hidden="true" />
      {{ notification.title }}
    </h2>
    <p>{{ notification.body }}</p>
    <NuxtLink
      v-if="notification.actionPath"
      :to="notification.actionPath"
      data-action="notification-link"
      @click="$emit('open', $event)"
    >
      Открыть
    </NuxtLink>
  </article>
</template>

<style scoped>
.notification-card {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
  border-left: 4px solid transparent;
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.notification-card--unread {
  border-left-color: var(--hf-color-action-primary);
}
.notification-card h2,
.notification-card p {
  margin: 0;
}
.notification-card__title {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
}
.notification-card__icon {
  flex-shrink: 0;
  width: 1.1rem;
  height: 1.1rem;
  color: var(--hf-color-text-muted);
}
.notification-card p {
  color: var(--hf-color-text-muted);
}
.notification-card__meta {
  display: flex;
  justify-content: space-between;
  gap: var(--hf-space-3);
  color: var(--hf-color-text-muted);
  font-size: 0.875rem;
}
.notification-card--unread .notification-card__meta span {
  color: var(--hf-color-action-primary-hover);
  font-weight: var(--hf-font-weight-bold);
}
.notification-card a {
  justify-self: start;
  color: var(--hf-color-action-primary-hover);
  font-weight: var(--hf-font-weight-bold);
}
</style>
