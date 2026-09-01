<script setup lang="ts">
import { ref } from 'vue';
import { navigateTo } from '#app';

import { errorMessage, useAuth } from '../composables/useAuth.js';

defineOptions({ name: 'LoginPage' });

const email = ref('');
const password = ref('');
const loading = ref(false);
const summary = ref('');
const fieldErrors = ref<Record<string, string>>({});
const { login } = useAuth();

async function submit() {
  loading.value = true;
  summary.value = '';
  fieldErrors.value = {};
  try {
    await login({ email: email.value, password: password.value });
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
    title="С возвращением"
    subtitle="Войдите, чтобы продолжить работу с бюджетом."
    submit-label="Войти"
    :loading="loading"
    :summary="summary"
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
      >
      <p v-if="fieldErrors.email" id="email-error" class="field-error">{{ fieldErrors.email }}</p>
    </div>
    <div class="field">
      <label for="password">Пароль</label>
      <input
        id="password"
        v-model="password"
        autocomplete="current-password"
        required
        type="password"
        :aria-describedby="fieldErrors.password ? 'password-error' : undefined"
      >
      <p v-if="fieldErrors.password" id="password-error" class="field-error">
        {{ fieldErrors.password }}
      </p>
    </div>
    <template #footer>
      <p class="form-links">
        <NuxtLink to="/forgot-password">Забыли пароль?</NuxtLink><NuxtLink to="/register">Создать аккаунт</NuxtLink>
      </p>
    </template>
  </AuthForm>
</template>
