<script setup lang="ts">
import { ref } from 'vue';
import { definePageMeta } from '#imports';

import ReferencePageLayout from '../../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiCard from '../../../components/ui/Card.vue';
import UiInput from '../../../components/ui/Input.vue';
import UiStatus from '../../../components/ui/Status.vue';
import { errorMessage, useAuth } from '../../../composables/useAuth.js';

defineOptions({ name: 'AppSettingsPasswordPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const { changePassword } = useAuth();
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const saving = ref(false);
const summary = ref('');
const fieldErrors = ref<Record<string, string>>({});

async function save() {
  summary.value = '';
  fieldErrors.value = {};
  // Confirmation is a client-side guard only: the API takes just the current
  // and the new password.
  if (newPassword.value !== confirmPassword.value) {
    fieldErrors.value = { confirmPassword: 'Пароли не совпадают.' };
    summary.value = 'Проверьте подтверждение нового пароля.';
    return;
  }
  saving.value = true;
  try {
    await changePassword({
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    });
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    summary.value = 'Пароль изменён.';
  } catch (error) {
    const mapped = errorMessage(error);
    summary.value = mapped.summary;
    fieldErrors.value = mapped.fields;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ReferencePageLayout>
    <template #kicker>Настройки</template>
    <template #title>Пароль</template>
    <template #actions>
      <UiButton variant="tertiary" to="/app/settings">← Настройки</UiButton>
    </template>
    <template #content>
      <UiCard as="section">
        <UiStatus
          v-if="summary"
          :label="summary"
          :tone="Object.keys(fieldErrors).length ? 'danger' : 'success'"
          aria-live="polite"
        />
        <form class="password-settings-form" @submit.prevent="save">
          <UiInput
            v-model="currentPassword"
            name="currentPassword"
            type="password"
            autocomplete="current-password"
            label="Текущий пароль"
            :error="fieldErrors.currentPassword"
            required
          />
          <UiInput
            v-model="newPassword"
            name="newPassword"
            type="password"
            autocomplete="new-password"
            label="Новый пароль"
            hint="Минимум 10 символов."
            :error="fieldErrors.newPassword"
            required
          />
          <UiInput
            v-model="confirmPassword"
            name="confirmPassword"
            type="password"
            autocomplete="new-password"
            label="Подтвердите новый пароль"
            :error="fieldErrors.confirmPassword"
            required
          />
          <UiButton type="submit" :loading="saving">Сохранить</UiButton>
        </form>
      </UiCard>
    </template>
  </ReferencePageLayout>
</template>

<style scoped>
.password-settings-form {
  display: grid;
  gap: var(--hf-space-5);
  max-width: 28rem;
  margin-top: var(--hf-space-4);
}
</style>
