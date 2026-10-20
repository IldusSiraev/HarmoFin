<script setup lang="ts">
import { ref } from 'vue';
import { navigateTo } from '#app';

import UiInput from '../components/ui/Input.vue';
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
    loading-label="Входим…"
    :loading="loading"
    :summary="summary"
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
      autocomplete="current-password"
      required
      :error="fieldErrors.password"
    />
    <template #footer>
      <p class="form-links">
        <NuxtLink to="/forgot-password">Забыли пароль?</NuxtLink>
        <span>Нет аккаунта? <NuxtLink to="/register">Зарегистрироваться</NuxtLink></span>
      </p>
    </template>
  </AuthForm>
</template>
