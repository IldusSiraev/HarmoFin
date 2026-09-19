<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { definePageMeta, navigateTo } from '#imports';

import ReferencePageLayout from '../../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiConfirmDialog from '../../../components/ui/ConfirmDialog.vue';
import UiStatus from '../../../components/ui/Status.vue';
import { type SessionView, useAuth } from '../../../composables/useAuth.js';

defineOptions({ name: 'AppSettingsSessionsPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const { loadMe, listSessions, revokeSession, revokeAllSessions } = useAuth();

const sessions = ref<SessionView[]>([]);
const loading = ref(true);
const loadError = ref('');
const actionError = ref('');
const revokingId = ref<string | null>(null);
const revokingAll = ref(false);
const confirmingRevokeAll = ref(false);

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

async function loadSessions() {
  loading.value = true;
  loadError.value = '';
  try {
    sessions.value = await listSessions();
  } catch {
    loadError.value = 'Не удалось загрузить список сессий. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

// listSessions() has no way to say which row is this browser's own session
// (the session cookie is HttpOnly), so after revoking one we re-authenticate:
// if that now fails, the row we just revoked was our own.
async function revoke(sessionId: string) {
  revokingId.value = sessionId;
  actionError.value = '';
  try {
    await revokeSession(sessionId);
    try {
      await loadMe();
    } catch {
      await navigateTo('/login');
      return;
    }
    await loadSessions();
  } catch {
    // The row is still listed because the server never confirmed the revoke;
    // say so instead of letting the spinner stop silently.
    actionError.value = 'Не удалось завершить сессию. Повторите попытку.';
  } finally {
    revokingId.value = null;
  }
}

async function confirmRevokeAll() {
  revokingAll.value = true;
  actionError.value = '';
  try {
    await revokeAllSessions();
    await navigateTo('/login');
  } catch {
    actionError.value = 'Не удалось выйти отовсюду. Повторите попытку.';
  } finally {
    revokingAll.value = false;
    confirmingRevokeAll.value = false;
  }
}

onMounted(() => {
  void loadSessions();
});
</script>

<template>
  <ReferencePageLayout>
    <template #kicker>Настройки</template>
    <template #title>Сессии</template>
    <template #actions>
      <UiButton variant="tertiary" to="/app/settings">← Настройки</UiButton>
    </template>
    <template #content>
      <UiStatus v-if="loading" label="Загрузка сессий…" tone="info" aria-live="polite" />
      <UiStatus v-else-if="loadError" :label="loadError" tone="danger" aria-live="polite" />
      <template v-else>
        <UiStatus v-if="actionError" :label="actionError" tone="danger" aria-live="assertive" />
        <ul class="sessions-list">
          <li v-for="session in sessions" :key="session.id" class="sessions-list__row">
            <div>
              <p class="sessions-list__device">
                {{ session.userAgent ?? 'Неизвестное устройство' }}
              </p>
              <p class="sessions-list__meta">
                Вход: {{ formatDate(session.createdAt) }} · Активность:
                {{ formatDate(session.lastSeenAt) }}
              </p>
            </div>
            <UiButton
              variant="tertiary"
              size="sm"
              data-action="revoke-session"
              :loading="revokingId === session.id"
              @click="revoke(session.id)"
            >
              Завершить
            </UiButton>
          </li>
        </ul>
        <UiButton variant="danger" data-action="revoke-all" @click="confirmingRevokeAll = true">
          Выйти отовсюду
        </UiButton>
      </template>
    </template>
  </ReferencePageLayout>
  <UiConfirmDialog
    :open="confirmingRevokeAll"
    title="Выйти отовсюду?"
    description="Это завершит все сессии, включая текущую — вы будете разлогинены и перенаправлены на страницу входа."
    confirm-label="Выйти отовсюду"
    cancel-label="Отмена"
    variant="danger"
    :loading="revokingAll"
    @confirm="confirmRevokeAll"
    @cancel="confirmingRevokeAll = false"
  />
</template>

<style scoped>
.sessions-list {
  display: grid;
  gap: var(--hf-space-3);
  margin: var(--hf-space-4) 0;
  padding: 0;
  list-style: none;
}

.sessions-list__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-3);
  padding: var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
}

.sessions-list__device {
  margin: 0;
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
}

.sessions-list__meta {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
</style>
