<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { navigateTo } from '#app';

import ConsentCheckboxes from '../components/auth/ConsentCheckboxes.vue';
import UiInput from '../components/ui/Input.vue';
import { errorMessage, useAuth } from '../composables/useAuth.js';
import { useLegal, type LegalDocument } from '../composables/useLegal.js';

defineOptions({ name: 'RegisterPage' });

const email = ref('');
const password = ref('');
const budgetName = ref('');
const loading = ref(false);
const summary = ref('');
const fieldErrors = ref<Record<string, string>>({});
const { register } = useAuth();

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
      ...(budgetName.value ? { budgetName: budgetName.value } : {}),
      consents: documents.value.map(({ document, version }) => ({ document, version })),
    });
    await navigateTo('/app');
  } catch (error) {
    const result = errorMessage(error);
    summary.value = result.summary;
    fieldErrors.value = result.fields;
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
