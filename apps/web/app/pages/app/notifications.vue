<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { definePageMeta, navigateTo } from '#imports';

import NotificationCard from '../../components/notifications/NotificationCard.vue';
import UiButton from '../../components/ui/Button.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiSkeleton from '../../components/ui/Skeleton.vue';
import UiStatus from '../../components/ui/Status.vue';
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
  <ReferencePageLayout>
    <template #kicker>Центр уведомлений</template>
    <template #title>Уведомления</template>
    <template #description>Планы, финансовые предупреждения и события семьи.</template>
    <template #actions>
      <UiButton variant="secondary" :disabled="pending" @click="markAllRead">
        Отметить все прочитанными
      </UiButton>
    </template>
    <template #content>
      <UiStatus v-if="statusText" :label="statusText" tone="info" role="status" />
      <p v-if="error" class="notifications-page__error" role="alert">
        {{ error }}
        <UiButton data-action="retry-notifications" variant="tertiary" @click="load()">
          Повторить
        </UiButton>
      </p>
      <div v-if="loading" aria-busy="true">
        <UiSkeleton variant="row" :count="4" />
      </div>
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
      <div v-if="nextCursor" class="notifications-page__more">
        <UiButton variant="secondary" :disabled="loading" @click="load(true)">
          Загрузить ещё
        </UiButton>
      </div>
    </template>
  </ReferencePageLayout>
</template>

<style scoped>
.notifications-page__error {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
  align-items: center;
  margin: 0;
  color: var(--hf-color-text-danger);
}
.notifications-page__list {
  overflow: hidden;
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}
.notifications-page__list :deep(.notification-card + .notification-card) {
  border-top: 1px solid var(--hf-color-border);
}
.notifications-page__more {
  display: flex;
  justify-content: center;
}
</style>
