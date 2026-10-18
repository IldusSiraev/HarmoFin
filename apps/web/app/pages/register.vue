<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { navigateTo } from '#app';

import ConsentCheckboxes from '../components/auth/ConsentCheckboxes.vue';
import { errorMessage, useAuth } from '../composables/useAuth.js';
import { useLegal, type LegalDocument } from '../composables/useLegal.js';

defineOptions({ name: 'RegisterPage' });

const email = ref('');
const password = ref('');
const workspaceName = ref('');
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
      ...(workspaceName.value ? { workspaceName: workspaceName.value } : {}),
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
    title="Создайте бюджет"
    subtitle="Начните с аккаунта, рабочего пространства и первого семейного бюджета."
    submit-label="Создать аккаунт"
    :loading="loading"
    :summary="summary"
    :submit-disabled="!consentsReady"
    :on-submit="submit"
  >
    <div class="field">
      <label for="email">Email</label>
      <input
        id="email"
        v-model="email"
        autocomplete="email"
        inputmode="email"
        required
        type="email"
        :aria-describedby="fieldErrors.email ? 'email-error' : undefined"
      />
      <p v-if="fieldErrors.email" id="email-error" class="field-error">{{ fieldErrors.email }}</p>
    </div>
    <div class="field">
      <label for="password">Пароль</label>
      <input
        id="password"
        v-model="password"
        autocomplete="new-password"
        required
        minlength="10"
        maxlength="128"
        type="password"
        :aria-describedby="fieldErrors.password ? 'password-error' : undefined"
      />
      <p v-if="fieldErrors.password" id="password-error" class="field-error">
        {{ fieldErrors.password }}
      </p>
      <small>Минимум 10 символов.</small>
    </div>
    <div class="field">
      <label for="workspace">Рабочее пространство <span>необязательно</span></label>
      <input id="workspace" v-model="workspaceName" maxlength="120" placeholder="Например, Семья" />
    </div>
    <div class="field">
      <label for="budget">Первый бюджет <span>необязательно</span></label>
      <input
        id="budget"
        v-model="budgetName"
        maxlength="120"
        placeholder="Например, Семейный бюджет"
      />
    </div>
    <ConsentCheckboxes v-model:terms="acceptTerms" v-model:pd="acceptPd" />
    <p v-if="!acceptTerms || !acceptPd" class="consent-hint">
      Чтобы создать аккаунт, отметьте оба пункта.
    </p>
    <template #footer>
      <p class="form-links"><span>Уже есть аккаунт?</span><NuxtLink to="/login">Войти</NuxtLink></p>
    </template>
  </AuthForm>
</template>

<style scoped>
small,
label span,
.consent-hint {
  color: #70808a;
  font-size: 0.78rem;
  font-weight: 500;
}

.consent-hint {
  margin: 0;
}
</style>
