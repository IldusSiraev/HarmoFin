<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { navigateTo, useRoute } from '#app';

import ConsentCheckboxes from '../components/auth/ConsentCheckboxes.vue';
import UiInput from '../components/ui/Input.vue';
import { ApiRequestError } from '../composables/useApiClient.js';
import { errorMessage, useAuth } from '../composables/useAuth.js';
import { INVITE_TOKEN_KEY } from '../composables/useInvitation.js';
import { useLegal, type LegalDocument } from '../composables/useLegal.js';

defineOptions({ name: 'RegisterPage' });

// Registration-specific: unlike /invite (which can retry the same
// invitation), a failed registration about to retry would otherwise silently
// create an unrelated personal workspace instead of joining the family. Only
// these codes mean the invitation itself is dead; MEMBER_LIMIT_REACHED is
// deliberately NOT here — the invitation is still valid, so the token and
// the invite-mode form must stay for a later retry once a seat frees up.
const REGISTER_TERMINAL_ERROR_CODES = new Set([
  'INVITATION_EXPIRED',
  'INVITATION_REVOKED',
  'INVITATION_NOT_FOUND',
  'INVITATION_ALREADY_ACCEPTED',
]);

const route = useRoute();
const email = ref('');
const password = ref('');
const budgetName = ref('');
const loading = ref(false);
const summary = ref('');
const fieldErrors = ref<Record<string, string>>({});
const { register } = useAuth();

// Present only when opened through /invite: the token travels in
// sessionStorage, never the URL, and ?invite=1 just flags the intent. A ref
// (not a computed) so a terminal invitation error can drop it and fall back
// to a normal registration without waiting on an unrelated reactive source.
const invitationToken = ref<string | null>(
  route.query.invite === '1' && typeof sessionStorage !== 'undefined'
    ? sessionStorage.getItem(INVITE_TOKEN_KEY)
    : null,
);

const acceptTerms = ref(false);
const acceptPd = ref(false);
const documents = ref<LegalDocument[]>([]);
const { loadDocuments } = useLegal();
const consentsReady = computed(
  () => acceptTerms.value && acceptPd.value && documents.value.length === 3,
);

onMounted(async () => {
  try {
    documents.value = await loadDocuments();
  } catch {
    summary.value = 'Не удалось загрузить документы. Обновите страницу.';
  }
});

async function submit() {
  if (!consentsReady.value) return;
  loading.value = true;
  summary.value = '';
  fieldErrors.value = {};
  try {
    await register({
      email: email.value,
      password: password.value,
      ...(invitationToken.value
        ? { invitationToken: invitationToken.value }
        : budgetName.value
          ? { budgetName: budgetName.value }
          : {}),
      consents: documents.value.map(({ document, version }) => ({ document, version })),
    });
    if (invitationToken.value) {
      // Already accepted server-side inside the registration transaction.
      sessionStorage.removeItem(INVITE_TOKEN_KEY);
      await navigateTo('/invite?welcome=1');
      return;
    }
    await navigateTo('/app');
  } catch (error) {
    const result = errorMessage(error);
    const code = error instanceof ApiRequestError ? error.problem.code : '';
    fieldErrors.value =
      code === 'INVITATION_EMAIL_MISMATCH'
        ? { ...result.fields, email: 'Приглашение отправлено на другой адрес.' }
        : result.fields;
    if (code === 'MEMBER_LIMIT_REACHED') {
      // The invitation is still valid — only the family is full right now —
      // so keep the token and the invite-mode form for a later retry.
      summary.value =
        'В семье уже 10 участников. Попросите создателя освободить место и попробуйте снова.';
    } else if (REGISTER_TERMINAL_ERROR_CODES.has(code)) {
      // The token cannot lead anywhere else from here: drop it and fall back
      // to a normal registration (with its own personal workspace) on retry.
      sessionStorage.removeItem(INVITE_TOKEN_KEY);
      invitationToken.value = null;
      summary.value = `${result.summary} При повторной регистрации будет создан личный бюджет.`;
    } else {
      summary.value = result.summary;
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <AuthForm
    title="Начните бесплатно"
    subtitle="Аккаунт и первый бюджет — за минуту. Счета и конверты настроите после входа."
    submit-label="Создать аккаунт"
    loading-label="Создаём аккаунт…"
    :loading="loading"
    :summary="summary"
    :submit-disabled="!consentsReady"
    :submit-described-by="consentsReady ? undefined : 'consent-hint'"
    :on-submit="submit"
  >
    <UiInput
      id="email"
      v-model="email"
      class="field"
      name="email"
      label="Email"
      type="email"
      autocomplete="email"
      inputmode="email"
      required
      :error="fieldErrors.email"
    />
    <UiInput
      id="password"
      v-model="password"
      class="field"
      name="password"
      label="Пароль"
      type="password"
      autocomplete="new-password"
      required
      :minlength="10"
      :maxlength="128"
      hint="Минимум 10 символов."
      :error="fieldErrors.password"
    />
    <UiInput
      v-if="!invitationToken"
      id="budget"
      v-model="budgetName"
      class="field"
      name="budgetName"
      label="Название бюджета"
      :maxlength="120"
      placeholder="Например, Семья Ивановых"
      hint="Необязательно. Можно изменить в настройках."
      :error="fieldErrors.budgetName"
    />
    <ConsentCheckboxes class="consent-wrapper" v-model:terms="acceptTerms" v-model:pd="acceptPd" />
    <p v-if="!acceptTerms || !acceptPd" id="consent-hint" class="consent-hint">
      Чтобы создать аккаунт, отметьте оба пункта.
    </p>
    <template #footer>
      <p class="form-links"><span>Уже есть аккаунт?</span><NuxtLink to="/login">Войти</NuxtLink></p>
    </template>
  </AuthForm>
</template>

<style scoped>
.consent-wrapper {
  margin-top: 1.5rem;
}

.consent-hint {
  margin: 0.5rem 0 0;
  color: var(--hf-color-text-muted);
  font-size: 0.78rem;
  font-weight: 500;
}
</style>
