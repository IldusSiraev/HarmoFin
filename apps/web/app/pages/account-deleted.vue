<script setup lang="ts">
import { computed } from 'vue';
import { navigateTo, useRoute } from '#app';

const route = useRoute();

const purgeDate = computed(() => {
  const raw = typeof route.query.until === 'string' ? new Date(route.query.until) : null;
  if (!raw || Number.isNaN(raw.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(raw);
});

const subtitle = computed(() =>
  purgeDate.value
    ? `Аккаунт и данные будут удалены безвозвратно ${purgeDate.value}. Мы отправили письмо со ссылкой для отмены.`
    : 'Аккаунт и данные будут удалены безвозвратно через 30 дней. Мы отправили письмо со ссылкой для отмены.',
);

async function toLanding() {
  await navigateTo('/');
}
</script>

<template>
  <AuthForm
    title="Аккаунт удаляется"
    :subtitle="subtitle"
    submit-label="На главную"
    :on-submit="toLanding"
  >
    <template #footer>
      <p class="form-links">Письмо не пришло? Проверьте папку «Спам».</p>
    </template>
  </AuthForm>
</template>
