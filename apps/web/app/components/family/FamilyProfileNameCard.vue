<script setup lang="ts">
import { ref, watch } from 'vue';

import UiButton from '../ui/Button.vue';
import UiCard from '../ui/Card.vue';
import UiInput from '../ui/Input.vue';
import UiStatus from '../ui/Status.vue';
import { errorMessage, useAuth } from '../../composables/useAuth.js';

defineOptions({ name: 'FamilyProfileNameCard' });

const { currentUser, updateProfile } = useAuth();

const displayName = ref(currentUser.value?.displayName ?? '');
const saving = ref(false);
const summary = ref('');
const fieldError = ref('');

watch(
  () => currentUser.value?.displayName,
  (value) => {
    displayName.value = value ?? '';
  },
);

async function save() {
  summary.value = '';
  fieldError.value = '';
  saving.value = true;
  try {
    await updateProfile(displayName.value.trim());
    summary.value = 'Имя сохранено.';
  } catch (error) {
    const mapped = errorMessage(error);
    summary.value = mapped.summary;
    fieldError.value = mapped.fields.displayName ?? mapped.summary;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <UiCard as="section" class="family-profile-name-card" aria-labelledby="family-profile-name-title">
    <template #header><h2 id="family-profile-name-title">Укажите ваше имя</h2></template>
    <p class="family-profile-name-card__hint">Укажите ваше имя — его увидят участники.</p>
    <UiStatus
      v-if="summary"
      :label="summary"
      :tone="fieldError ? 'danger' : 'success'"
      aria-live="polite"
    />
    <form class="family-profile-name-card__form" @submit.prevent="save">
      <UiInput
        v-model="displayName"
        name="displayName"
        label="Ваше имя"
        :maxlength="120"
        :error="fieldError"
        required
      />
      <UiButton type="submit" :loading="saving">Сохранить</UiButton>
    </form>
  </UiCard>
</template>

<style scoped>
.family-profile-name-card__hint {
  margin: 0 0 var(--hf-space-4);
  color: var(--hf-color-text-muted);
}

.family-profile-name-card__form {
  display: grid;
  gap: var(--hf-space-4);
  max-width: 24rem;
}
</style>
