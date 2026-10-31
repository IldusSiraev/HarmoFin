<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { navigateTo, useRoute } from '#app';

import { errorMessage } from '../composables/useAuth.js';
import { useNotificationSettings } from '../composables/useNotificationSettings.js';

const INVALID_LINK = 'Ссылка недействительна или устарела.';

const route = useRoute();
// Read once: the token is removed from the address bar right after mount.
const token = typeof route.query.token === 'string' ? route.query.token : '';
const loading = ref(false);
const summary = ref('');
const confirmed = ref(false);
const { confirmEmailVerification } = useNotificationSettings();

onMounted(() => {
  window.history.replaceState(window.history.state, '', window.location.pathname);
});

async function submit() {
  if (confirmed.value) {
    await navigateTo('/app/settings/notifications');
    return;
  }
  summary.value = '';
  if (!token) {
    summary.value = INVALID_LINK;
    return;
  }
  loading.value = true;
  try {
    await confirmEmailVerification(token);
    confirmed.value = true;
    summary.value = 'Почта подтверждена. Теперь можно включить уведомления на почту.';
  } catch (error) {
    summary.value = errorMessage(error).summary || INVALID_LINK;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <AuthForm
    title="Подтверждение почты"
    subtitle="Подтвердите, что это ваш адрес: на него будут приходить уведомления HarmoFin."
    :submit-label="confirmed ? 'Перейти к настройкам' : 'Подтвердить'"
    :loading="loading"
    :summary="summary"
    :on-submit="submit"
  >
    <template #footer>
      <p class="form-links"><NuxtLink to="/login">Войти</NuxtLink></p>
    </template>
  </AuthForm>
</template>
