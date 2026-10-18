<script setup lang="ts">
import { computed, ref } from 'vue';
import { definePageMeta, navigateTo } from '#imports';

import ReferencePageLayout from '../../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiCard from '../../../components/ui/Card.vue';
import UiInput from '../../../components/ui/Input.vue';
import UiStatus from '../../../components/ui/Status.vue';
import { errorMessage, useAuth } from '../../../composables/useAuth.js';

defineOptions({ name: 'AppSettingsDeleteAccountPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const { requestAccountDeletion } = useAuth();
const password = ref('');
const confirmed = ref(false);
const deleting = ref(false);
const summary = ref('');
const fieldErrors = ref<Record<string, string>>({});
const canSubmit = computed(() => password.value.length > 0 && confirmed.value && !deleting.value);

async function remove() {
  if (!canSubmit.value) return;
  summary.value = '';
  fieldErrors.value = {};
  deleting.value = true;
  try {
    const { purgeAfter } = await requestAccountDeletion(password.value);
    password.value = '';
    await navigateTo(`/account-deleted?until=${encodeURIComponent(purgeAfter)}`, { replace: true });
  } catch (error) {
    const mapped = errorMessage(error);
    summary.value = mapped.summary;
    fieldErrors.value = mapped.fields;
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <ReferencePageLayout>
    <template #kicker>Настройки</template>
    <template #title>Удаление аккаунта</template>
    <template #actions>
      <UiButton variant="tertiary" to="/app/settings">← Настройки</UiButton>
    </template>
    <template #content>
      <UiCard as="section" aria-labelledby="delete-account-title">
        <template #header><h2 id="delete-account-title">Что произойдёт</h2></template>
        <ul class="delete-account__facts">
          <li>Вход в аккаунт закроется сразу, все сессии завершатся.</li>
          <li>Аккаунт и все данные бюджета удалятся безвозвратно через 30 дней.</li>
          <li>До этого срока удаление можно отменить по ссылке из письма.</li>
        </ul>
        <p class="delete-account__export">
          <NuxtLink to="/app/operations">Сначала выгрузите данные</NuxtLink> — экспорт операций в
          CSV доступен в журнале операций.
        </p>
        <UiStatus v-if="summary" :label="summary" tone="danger" aria-live="polite" />
        <form class="delete-account__form" @submit.prevent="remove">
          <UiInput
            v-model="password"
            name="password"
            type="password"
            autocomplete="current-password"
            label="Текущий пароль"
            :error="fieldErrors.password"
            required
          />
          <label class="delete-account__confirm">
            <input v-model="confirmed" name="confirm" type="checkbox" />
            <span>Понимаю, что данные удалятся безвозвратно через 30 дней</span>
          </label>
          <UiButton type="submit" variant="danger" :loading="deleting" :disabled="!canSubmit">
            Удалить аккаунт
          </UiButton>
        </form>
      </UiCard>
    </template>
  </ReferencePageLayout>
</template>

<style scoped>
.delete-account__facts {
  display: grid;
  gap: var(--hf-space-2);
  margin: var(--hf-space-4) 0;
  padding-left: var(--hf-space-5);
  color: var(--hf-color-text);
}

.delete-account__export {
  margin: 0 0 var(--hf-space-5);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.delete-account__form {
  display: grid;
  gap: var(--hf-space-5);
  max-width: 28rem;
  margin-top: var(--hf-space-4);
}

.delete-account__confirm {
  display: flex;
  align-items: flex-start;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  color: var(--hf-color-text);
}

.delete-account__confirm input {
  width: 1.25rem;
  height: 1.25rem;
  margin-top: 0.125rem;
  accent-color: var(--hf-color-action-danger);
}
</style>
