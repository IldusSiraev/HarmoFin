<script setup lang="ts">
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarClock,
  CalendarDays,
  Wallet,
  UserMinus,
  UserPlus,
  Users,
  UserX,
} from '@lucide/vue';
import type { Component } from 'vue';

import type {
  NotificationDto,
  NotificationType,
} from '../../composables/useBudgetReferenceData.js';

const props = defineProps<{ notification: NotificationDto }>();
defineEmits<{ open: [event: MouseEvent] }>();

type Tone = 'neutral' | 'warning' | 'danger' | 'info';

// Access events and calendar reminders keep a type caption; plan and
// financial notifications get a leading icon only.
const MEMBER_EVENT_TYPES: ReadonlySet<NotificationType> = new Set([
  'MEMBER_JOINED',
  'MEMBER_LEFT',
  'MEMBER_REMOVED',
  'OBJECTS_TRANSFERRED',
  'CALENDAR_REMINDER',
]);

const TYPE_ICONS: Record<NotificationType, Component> = {
  PLAN_UPCOMING: CalendarClock,
  PLAN_TODAY: CalendarClock,
  PLAN_OVERDUE: CalendarClock,
  UNALLOCATED_INCOME: Wallet,
  NEGATIVE_ACCOUNT: AlertTriangle,
  NEGATIVE_ENVELOPE: AlertTriangle,
  INSUFFICIENT_MANDATORY_OBLIGATIONS: AlertTriangle,
  MEMBER_JOINED: UserPlus,
  MEMBER_LEFT: UserMinus,
  MEMBER_REMOVED: UserX,
  OBJECTS_TRANSFERRED: Users,
  CALENDAR_REMINDER: Bell,
};

const TYPE_TONES: Partial<Record<NotificationType, Tone>> = {
  PLAN_TODAY: 'info',
  PLAN_OVERDUE: 'warning',
  UNALLOCATED_INCOME: 'info',
  NEGATIVE_ACCOUNT: 'danger',
  NEGATIVE_ENVELOPE: 'danger',
  INSUFFICIENT_MANDATORY_OBLIGATIONS: 'warning',
};

function stateText() {
  return props.notification.readAt ? 'Прочитано' : 'Новое';
}

function typeCaption(): string {
  return props.notification.notificationType === 'CALENDAR_REMINDER' ? 'Календарь' : 'Семья';
}

function linkText(): string {
  return props.notification.notificationType === 'CALENDAR_REMINDER'
    ? 'Открыть в календаре'
    : 'Открыть';
}

function hasCaption(): boolean {
  return MEMBER_EVENT_TYPES.has(props.notification.notificationType);
}

function typeIcon(): Component {
  return TYPE_ICONS[props.notification.notificationType] ?? CalendarDays;
}

function tone(): Tone {
  return TYPE_TONES[props.notification.notificationType] ?? 'neutral';
}

function dateText(): string {
  const date = new Date(props.notification.createdAt);
  if (Number.isNaN(date.getTime())) return props.notification.createdAt.slice(0, 10);
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
</script>

<template>
  <article class="notification-card" :class="{ 'notification-card--unread': !notification.readAt }">
    <span class="notification-card__tile" :class="`notification-card__tile--${tone()}`">
      <component :is="typeIcon()" class="notification-card__icon" :size="20" aria-hidden="true" />
    </span>
    <div class="notification-card__main">
      <div class="notification-card__meta">
        <span class="notification-card__state">
          <span v-if="!notification.readAt" class="notification-card__dot" aria-hidden="true" />
          {{ stateText() }}
        </span>
        <time :datetime="notification.createdAt">{{ dateText() }}</time>
      </div>
      <h2 class="notification-card__title">{{ notification.title }}</h2>
      <p
        v-if="hasCaption()"
        class="notification-card__type"
        data-testid="notification-type-caption"
      >
        {{ typeCaption() }}
      </p>
      <p class="notification-card__body">{{ notification.body }}</p>
      <NuxtLink
        v-if="notification.actionPath"
        :to="notification.actionPath"
        class="notification-card__link"
        data-action="notification-link"
        @click="$emit('open', $event)"
      >
        {{ linkText() }}
        <ArrowRight :size="14" aria-hidden="true" />
      </NuxtLink>
    </div>
  </article>
</template>

<style scoped>
.notification-card {
  display: flex;
  gap: var(--hf-space-4);
  align-items: flex-start;
  padding: var(--hf-space-4) var(--hf-space-5);
}
.notification-card__tile {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text-muted);
}
.notification-card--unread .notification-card__tile--neutral {
  background: var(--hf-color-brand-soft);
  color: var(--hf-color-envelope-current);
}
.notification-card__tile--info {
  background: var(--hf-color-status-info-background);
  color: var(--hf-color-status-info);
}
.notification-card__tile--warning {
  background: var(--hf-color-status-warning-background);
  color: var(--hf-color-status-warning);
}
.notification-card__tile--danger {
  background: var(--hf-color-status-danger-background);
  color: var(--hf-color-text-danger);
}
.notification-card__main {
  display: grid;
  flex: 1;
  gap: var(--hf-space-1);
  min-width: 0;
}
.notification-card h2,
.notification-card p {
  margin: 0;
}
.notification-card__meta {
  display: flex;
  justify-content: space-between;
  gap: var(--hf-space-3);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
.notification-card__state {
  display: inline-flex;
  gap: var(--hf-space-2);
  align-items: center;
}
.notification-card--unread .notification-card__state {
  color: var(--hf-color-envelope-current);
  font-weight: var(--hf-font-weight-semibold);
}
.notification-card__dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--hf-color-action-primary);
}
.notification-card__title {
  font-size: 1rem;
  font-weight: var(--hf-font-weight-semibold);
  overflow-wrap: anywhere;
}
.notification-card__type {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
.notification-card__body {
  color: var(--hf-color-text-secondary);
  overflow-wrap: anywhere;
}
.notification-card__link {
  display: inline-flex;
  gap: var(--hf-space-1);
  align-items: center;
  justify-self: start;
  min-height: 2.75rem;
  color: var(--hf-color-envelope-current);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
  text-decoration: none;
}
.notification-card__link:hover {
  text-decoration: underline;
}
.notification-card__link:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}
@media (max-width: 47.9375rem) {
  .notification-card {
    gap: var(--hf-space-3);
    padding: var(--hf-space-4);
  }
}
</style>
