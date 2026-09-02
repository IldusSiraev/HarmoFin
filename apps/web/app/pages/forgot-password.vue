<script setup lang="ts">
import { ref } from 'vue';

import { errorMessage, useAuth } from '../composables/useAuth.js';

const email = ref('');
const loading = ref(false);
const summary = ref('');
const sent = ref(false);
const { requestRecovery } = useAuth();

async function submit() {
  loading.value = true;
  summary.value = '';
  try {
    await requestRecovery(email.value);
    sent.value = true;
  } catch (error) {
    summary.value = errorMessage(error).summary;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <AuthForm
    title="Восстановление пароля"
    subtitle="Укажем следующий шаг, если email связан с аккаунтом."
    submit-label="Отправить ссылку"
    :loading="loading"
    :summary="summary"
    :on-submit="submit"
  >
    <p v-if="sent" class="success" role="status" aria-live="polite">
      Если аккаунт существует, ссылка для восстановления отправлена на email.
    </p>
    <div class="field">
      <label for="email">Email</label>
      <input
        id="email"
        v-model="email"
        autocomplete="email"
        inputmode="email"
        required
        type="email"
      />
    </div>
    <template #footer>
      <p class="form-links"><NuxtLink to="/login">Вернуться ко входу</NuxtLink></p>
    </template>
  </AuthForm>
</template>

<style scoped>
.success {
  margin: 0 0 1rem;
  padding: 0.8rem 0.9rem;
  border-left: 3px solid #25818c;
  background: #e7f5f4;
  color: #15565e;
  font-size: 0.9rem;
}
</style>
