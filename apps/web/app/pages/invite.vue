<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { navigateTo, reloadNuxtApp, useRoute, useRouter } from '#app';

import UiButton from '../components/ui/Button.vue';
import UiCard from '../components/ui/Card.vue';
import UiInput from '../components/ui/Input.vue';
import { ApiRequestError } from '../composables/useApiClient.js';
import { useActiveWorkspace } from '../composables/useActiveWorkspace.js';
import { useAuth } from '../composables/useAuth.js';
import {
  INVITATION_TERMINAL_ERROR_CODES,
  INVITE_TOKEN_KEY,
  readTokenFromHash,
  useInvitation,
  type InvitationPreview,
} from '../composables/useInvitation.js';

defineOptions({ name: 'InvitePage' });

const ERROR_MESSAGES: Record<string, string> = {
  INVITATION_EXPIRED: 'Приглашение истекло — попросите отправить новое.',
  INVITATION_REVOKED: 'Приглашение отозвано.',
  INVITATION_NOT_FOUND: 'Ссылка недействительна.',
  ALREADY_MEMBER: 'Вы уже в этой семье.',
};
const INVALID_LINK = 'Ссылка недействительна.';

const route = useRoute();
const router = useRouter();
const { currentUser, loadMe, logout, updateProfile } = useAuth();
const { workspace } = useActiveWorkspace();
const { preview: previewInvitation, accept: acceptInvitation } = useInvitation();

const isWelcome = computed(() => route.query.welcome === '1');

const loading = ref(true);
const invitation = ref<InvitationPreview | null>(null);
const isLoggedIn = ref(false);
const errorCode = ref('');
const errorText = ref('');
const name = ref('');
const pending = ref(false);
const titleHeading = ref<HTMLHeadingElement | null>(null);

const roleLabel = computed(() =>
  invitation.value?.role === 'VIEWER' ? 'наблюдателя' : 'участника',
);
const needsName = computed(() => isLoggedIn.value && !currentUser.value?.displayName);
const workspaceName = computed(() => workspace.value?.name ?? '');

onMounted(async () => {
  if (isWelcome.value) {
    await loadWelcome();
    return;
  }
  await loadInvitation();
});

// The heading text changes with every state transition (loading → content,
// content → error); moving focus there announces the change to screen reader
// users the same way a route change would.
async function focusHeading() {
  await nextTick();
  titleHeading.value?.focus();
}

async function loadWelcome() {
  loading.value = true;
  try {
    await loadMe();
  } catch {
    errorText.value = 'Не удалось загрузить данные. Обновите страницу.';
  } finally {
    loading.value = false;
    await focusHeading();
  }
}

function readToken(): string | null {
  if (window.location.hash) {
    const fromHash = readTokenFromHash(window.location.hash);
    // Strip the hash from both the browser URL and the router's own copy of
    // the route: the router keeps its last-known hash in memory until a
    // navigation updates it, so history.replaceState alone would leave the
    // token readable through useRoute().hash.
    window.history.replaceState(window.history.state, '', '/invite');
    void router.replace({ hash: '' });
    if (fromHash) {
      sessionStorage.setItem(INVITE_TOKEN_KEY, fromHash);
      return fromHash;
    }
    // A hash was present but did not look like a token: do not silently fall
    // back to whatever older token sessionStorage still has — that would
    // accept a link the visitor did not just open.
    sessionStorage.removeItem(INVITE_TOKEN_KEY);
    return null;
  }
  return sessionStorage.getItem(INVITE_TOKEN_KEY);
}

async function loadInvitation() {
  loading.value = true;
  errorCode.value = '';
  errorText.value = '';
  const token = readToken();
  if (!token) {
    errorText.value = INVALID_LINK;
    loading.value = false;
    await focusHeading();
    return;
  }
  try {
    await loadMe();
    isLoggedIn.value = true;
  } catch {
    isLoggedIn.value = false;
  }
  try {
    invitation.value = await previewInvitation(token);
  } catch (error) {
    applyError(error);
  } finally {
    loading.value = false;
    await focusHeading();
  }
}

function applyError(error: unknown) {
  if (!(error instanceof ApiRequestError)) {
    errorText.value = 'Не удалось выполнить запрос. Повторите попытку.';
    errorCode.value = '';
    return;
  }
  const code = error.problem.code;
  errorCode.value = code;
  errorText.value =
    code === 'INVITATION_EMAIL_MISMATCH'
      ? `Приглашение отправлено на ${invitation.value?.maskedEmail}. Войдите под этим адресом.`
      : (ERROR_MESSAGES[code] ?? error.problem.detail);
  if (INVITATION_TERMINAL_ERROR_CODES.has(code)) sessionStorage.removeItem(INVITE_TOKEN_KEY);
}

async function acceptNow() {
  const token = sessionStorage.getItem(INVITE_TOKEN_KEY);
  if (!token || (needsName.value && !name.value.trim())) return;
  pending.value = true;
  errorText.value = '';
  errorCode.value = '';
  try {
    await acceptInvitation(token, needsName.value ? name.value.trim() : undefined);
    sessionStorage.removeItem(INVITE_TOKEN_KEY);
    await loadMe();
    // Full reload so dashboard/journal/other pages pick up the newly joined
    // budget instead of keeping whatever was in memory before accepting.
    await reloadNuxtApp({ path: '/app' });
  } catch (error) {
    applyError(error);
    await focusHeading();
  } finally {
    pending.value = false;
  }
}

async function signOut() {
  await logout();
  await navigateTo('/login?invite=1');
}

async function continueWelcome() {
  if (!name.value.trim()) return;
  pending.value = true;
  errorText.value = '';
  try {
    await updateProfile(name.value.trim());
    await reloadNuxtApp({ path: '/app' });
  } catch {
    errorText.value = 'Не удалось сохранить имя. Повторите попытку.';
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <main class="invite-page">
    <UiCard class="invite-page__card" as="section" aria-labelledby="invite-title">
      <template v-if="isWelcome">
        <template v-if="loading">
          <h1 id="invite-title" ref="titleHeading" tabindex="-1">Загружаем данные…</h1>
        </template>
        <template v-else>
          <h1 id="invite-title" ref="titleHeading" tabindex="-1">
            Вы в семье «{{ workspaceName }}»
          </h1>
          <p v-if="errorText" role="alert" class="invite-page__error">{{ errorText }}</p>
          <UiInput id="welcome-name" v-model="name" name="displayName" label="Ваше имя" required />
          <UiButton
            class="invite-page__action"
            full-width
            :loading="pending"
            :disabled="!name.trim()"
            @click="continueWelcome"
          >
            Продолжить
          </UiButton>
        </template>
      </template>

      <template v-else-if="loading">
        <h1 id="invite-title" ref="titleHeading" tabindex="-1">Проверяем приглашение…</h1>
      </template>

      <template v-else-if="errorCode === 'INVITATION_EMAIL_MISMATCH'">
        <h1 id="invite-title" ref="titleHeading" tabindex="-1">Другой email</h1>
        <p role="alert" class="invite-page__error">{{ errorText }}</p>
        <UiButton class="invite-page__action" full-width @click="signOut">Выйти</UiButton>
      </template>

      <template v-else-if="errorCode === 'ALREADY_MEMBER'">
        <h1 id="invite-title" ref="titleHeading" tabindex="-1">Вы уже участник</h1>
        <p role="alert" class="invite-page__error">{{ errorText }}</p>
        <UiButton class="invite-page__action" full-width to="/app">Перейти в бюджет</UiButton>
      </template>

      <template v-else-if="errorText">
        <h1 id="invite-title" ref="titleHeading" tabindex="-1">Приглашение недоступно</h1>
        <p role="alert" class="invite-page__error">{{ errorText }}</p>
      </template>

      <template v-else-if="invitation && !isLoggedIn">
        <h1 id="invite-title" ref="titleHeading" tabindex="-1">
          {{ invitation.inviterName }} приглашает вас в семью «{{ invitation.workspaceName }}» как
          {{ roleLabel }}
        </h1>
        <div class="invite-page__actions">
          <UiButton to="/register?invite=1" full-width>Создать аккаунт</UiButton>
          <UiButton to="/login?invite=1" variant="secondary" full-width>Войти</UiButton>
        </div>
      </template>

      <template v-else-if="invitation">
        <h1 id="invite-title" ref="titleHeading" tabindex="-1">
          {{ invitation.inviterName }} приглашает вас в семью «{{ invitation.workspaceName }}» как
          {{ roleLabel }}
        </h1>
        <UiInput
          v-if="needsName"
          id="invite-name"
          v-model="name"
          name="displayName"
          label="Ваше имя"
          required
        />
        <UiButton
          class="invite-page__action"
          full-width
          :loading="pending"
          :disabled="needsName && !name.trim()"
          @click="acceptNow"
        >
          Принять
        </UiButton>
      </template>
    </UiCard>
  </main>
</template>

<style scoped>
.invite-page {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: var(--hf-space-5);
  background: var(--hf-color-page-background);
}

.invite-page__card {
  box-sizing: border-box;
  width: min(100%, 28rem);
}

.invite-page__card :deep(.ui-card__content) {
  display: grid;
  gap: var(--hf-space-4);
}

.invite-page__card h1 {
  margin: 0;
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-h2);
  line-height: var(--hf-line-height-h2);
}

.invite-page__error {
  margin: 0;
  color: var(--hf-color-text-danger);
}

.invite-page__actions {
  display: grid;
  gap: var(--hf-space-3);
}

.invite-page__action {
  margin-top: var(--hf-space-2);
}
</style>
