<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from '#app';

import { errorMessage } from '../composables/useAuth.js';
import { useNotificationSettings } from '../composables/useNotificationSettings.js';

defineOptions({ name: 'UnsubscribePage' });

const INVALID_LINK = 'Ссылка недействительна или устарела.';

const route = useRoute();
// Opening the page changes nothing (mail scanners follow links); the button does.
const token = typeof route.query.token === 'string' ? route.query.token : '';
const loading = ref(false);
const summary = ref('');
const done = ref(false);
const { unsubscribe } = useNotificationSettings();

onMounted(() => {
  window.history.replaceState(window.history.state, '', window.location.pathname);
});

async function submit() {
  if (done.value) return;
  summary.value = '';
  if (!token) {
    summary.value = INVALID_LINK;
    return;
  }
  loading.value = true;
  try {
    await unsubscribe(token);
    done.value = true;
    summary.value =
      'Готово. Письма больше не будут приходить. Включить снова можно в настройках уведомлений.';
  } catch (error) {
    summary.value = errorMessage(error).summary || INVALID_LINK;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <AuthForm
    title="Отписаться от писем"
    subtitle="HarmoFin перестанет присылать уведомления на эту почту. Уведомления в приложении останутся."
    :submit-label="done ? 'Готово' : 'Отписаться'"
    :loading="loading"
    :summary="summary"
    :summary-tone="done ? 'success' : 'error'"
    :on-submit="submit"
  >
    <template #footer>
      <p class="form-links">
        <NuxtLink to="/app/settings/notifications">Настройки уведомлений</NuxtLink>
      </p>
    </template>
  </AuthForm>
</template>
