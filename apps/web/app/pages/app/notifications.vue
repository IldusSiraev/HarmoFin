<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { definePageMeta, navigateTo } from '#imports';

import NotificationCard from '../../components/notifications/NotificationCard.vue';
import UiButton from '../../components/ui/Button.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import { useActiveWorkspace } from '../../composables/useActiveWorkspace.js';
import { useAuth } from '../../composables/useAuth.js';
import { ApiRequestError } from '../../composables/useApiClient.js';
import {
  type NotificationDto,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'NotificationsPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const auth = useAuth();
const api = useBudgetReferenceData();
const notifications = ref<NotificationDto[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(true);
const pending = ref(false);
const error = ref('');
const statusText = ref('');
const mutationKeys = new Map<string, string>();
const { budget } = useActiveWorkspace();

onMounted(() => {
  void load();
});

async function load(append = false) {
  if (!budget.value) {
    try {
      await auth.loadMe();
    } catch {
      error.value = 'Не удалось загрузить бюджет.';
    }
  }
  if (!budget.value) {
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const result = await api.listNotifications(budget.value.id, {
      state: 'all',
      ...(append && nextCursor.value ? { cursor: nextCursor.value } : {}),
    });
    notifications.value = append ? [...notifications.value, ...result.items] : result.items;
    nextCursor.value = result.nextCursor;
  } catch {
    error.value = 'Не удалось загрузить уведомления. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

async function openNotification(notification: NotificationDto, event: MouseEvent) {
  event.preventDefault();
  if (!budget.value || !notification.actionPath) return;
  if (!notification.actionPath.startsWith('/app/')) {
    error.value = 'Ссылка уведомления недоступна.';
    return;
  }
  pending.value = true;
  error.value = '';
  const operation = `read:${notification.id}`;
  try {
    if (!notification.readAt) {
      const updated = await api.markNotificationRead(
        budget.value.id,
        notification.id,
        keyFor(operation),
      );
      notifications.value = notifications.value.map((item) =>
        item.id === notification.id ? updated : item,
      );
      mutationKeys.delete(operation);
    }
    await navigateTo(notification.actionPath);
  } catch (exception) {
    error.value = errorMessage(exception);
  } finally {
    pending.value = false;
  }
}

async function markAllRead() {
  if (!budget.value) return;
  pending.value = true;
  error.value = '';
  const operation = 'read-all';
  try {
    const result = await api.markAllNotificationsRead(budget.value.id, keyFor(operation));
    mutationKeys.delete(operation);
    notifications.value = notifications.value.map((notification) =>
      notification.readAt ? notification : { ...notification, readAt: new Date().toISOString() },
    );
    statusText.value =
      result.updatedCount > 0 ? 'Все уведомления отмечены прочитанными.' : 'Новых уведомлений нет.';
  } catch (exception) {
    error.value = errorMessage(exception);
  } finally {
    pending.value = false;
  }
}

function keyFor(operation: string) {
  const existing = mutationKeys.get(operation);
  if (existing) return existing;
  const key = crypto.randomUUID();
  mutationKeys.set(operation, key);
  return key;
}

function errorMessage(exception: unknown) {
  return exception instanceof ApiRequestError
    ? exception.problem.detail
    : 'Не удалось выполнить действие. Повторите попытку.';
}
</script>

<template>
  <main class="notifications-page">
    <header class="notifications-page__header">
      <div>
        <p class="notifications-page__eyebrow">Внутренний центр</p>
        <h1>Уведомления</h1>
      </div>
      <UiButton variant="secondary" :disabled="pending" @click="markAllRead">
        Отметить все прочитанными
      </UiButton>
    </header>
    <p v-if="statusText" class="notifications-page__status" role="status">{{ statusText }}</p>
    <p v-if="error" class="notifications-page__error" role="alert">
      {{ error }}
      <UiButton data-action="retry-notifications" variant="tertiary" @click="load()">
        Повторить
      </UiButton>
    </p>
    <p v-if="loading">Загрузка уведомлений…</p>
    <UiEmptyState
      v-else-if="!budget"
      title="Бюджет не выбран"
      description="Создайте или выберите активный бюджет, чтобы видеть уведомления."
    />
    <UiEmptyState
      v-else-if="notifications.length === 0"
      title="Уведомлений пока нет"
      description="Планы и финансовые предупреждения появятся здесь."
    />
    <section v-else class="notifications-page__list" aria-label="Список уведомлений">
      <NotificationCard
        v-for="notification in notifications"
        :key="notification.id"
        :notification="notification"
        @open="openNotification(notification, $event)"
      />
    </section>
    <UiButton v-if="nextCursor" variant="secondary" :disabled="loading" @click="load(true)">
      Загрузить ещё
    </UiButton>
  </main>
</template>

<style scoped>
.notifications-page {
  max-width: 70rem;
  margin: 0 auto;
  padding: var(--hf-space-8);
}
.notifications-page__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--hf-space-5);
  margin-bottom: var(--hf-space-6);
}
.notifications-page__header h1,
.notifications-page__eyebrow,
.notifications-page__status,
.notifications-page__error {
  margin: 0;
}
.notifications-page__header h1 {
  font-size: clamp(2rem, 4vw, 3.5rem);
  letter-spacing: -0.04em;
}
.notifications-page__eyebrow {
  color: var(--hf-color-action-primary-hover);
  font-size: 0.75rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.notifications-page__status {
  margin-bottom: var(--hf-space-4);
  color: var(--hf-color-text-muted);
}
.notifications-page__error {
  margin-bottom: var(--hf-space-4);
  color: var(--hf-color-text-danger);
}
.notifications-page__list {
  display: grid;
  gap: var(--hf-space-4);
}
@media (max-width: 47.9375rem) {
  .notifications-page {
    padding: var(--hf-space-5);
  }
  .notifications-page__header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
