<script setup lang="ts">
import { computed, ref } from 'vue';
import { navigateTo, useRoute } from '#app';

import { errorMessage, useAuth } from '../composables/useAuth.js';

const route = useRoute();
const password = ref('');
const loading = ref(false);
const summary = ref('');
const fieldErrors = ref<Record<string, string>>({});
const { confirmRecovery } = useAuth();
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''));

async function submit() {
  loading.value = true;
  summary.value = '';
  fieldErrors.value = {};
  try {
    if (!token.value) throw new Error('Ссылка восстановления недействительна или истекла.');
    await confirmRecovery(token.value, password.value);
    await navigateTo('/app', { replace: true });
  } catch (error) {
    const result = errorMessage(error);
    summary.value = error instanceof Error && !token.value ? error.message : result.summary;
    fieldErrors.value = result.fields;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <AuthForm
    title="Новый пароль"
    subtitle="Задайте пароль, который будет использоваться для следующих входов."
    submit-label="Сохранить пароль"
    :loading="loading"
    :summary="summary"
    :on-submit="submit"
  >
    <div class="field">
      <label for="password">Новый пароль</label>
      <input
        id="password"
        v-model="password"
        autocomplete="new-password"
        required
        minlength="10"
        maxlength="128"
        type="password"
        :aria-describedby="fieldErrors.password ? 'password-error' : undefined"
      >
      <p v-if="fieldErrors.password" id="password-error" class="field-error">
        {{ fieldErrors.password }}
      </p>
      <small>Минимум 10 символов.</small>
    </div>
    <template #footer>
      <p class="form-links"><NuxtLink to="/login">Вернуться ко входу</NuxtLink></p>
    </template>
  </AuthForm>
</template>

<style scoped>
small {
  color: #70808a;
  font-size: 0.78rem;
}
</style>
