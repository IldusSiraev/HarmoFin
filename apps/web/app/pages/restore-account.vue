<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from '#app';

import { errorMessage, useAuth } from '../composables/useAuth.js';

const INVALID_LINK = 'Ссылка недействительна или устарела.';

const route = useRoute();
// Read once: the token is removed from the address bar right after mount.
const token = typeof route.query.token === 'string' ? route.query.token : '';
const loading = ref(false);
const summary = ref('');
const restored = ref(false);
const { cancelAccountDeletion } = useAuth();

onMounted(() => {
  window.history.replaceState(window.history.state, '', window.location.pathname);
});

async function submit() {
  if (restored.value) return;
  summary.value = '';
  if (!token) {
    summary.value = INVALID_LINK;
    return;
  }
  loading.value = true;
  try {
    await cancelAccountDeletion(token);
    restored.value = true;
    summary.value = 'Удаление отменено. Войдите в аккаунт как обычно.';
  } catch (error) {
    summary.value = errorMessage(error).summary || INVALID_LINK;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <AuthForm
    title="Отмена удаления"
    subtitle="Аккаунт и данные бюджета вернутся в том виде, в котором были на момент удаления."
    submit-label="Отменить удаление"
    :loading="loading"
    :summary="summary"
    :on-submit="submit"
  >
    <template #footer>
      <p class="form-links"><NuxtLink to="/login">Войти</NuxtLink></p>
    </template>
  </AuthForm>
</template>
