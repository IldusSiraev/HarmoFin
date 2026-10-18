<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { definePageMeta, navigateTo } from '#imports';

import ConsentCheckboxes from '../components/auth/ConsentCheckboxes.vue';
import { errorMessage, useAuth } from '../composables/useAuth.js';
import { useLegal } from '../composables/useLegal.js';

defineOptions({ name: 'AcceptTermsPage' });
definePageMeta({ middleware: 'auth' });

const { currentData, loadMe, acceptConsents, logout } = useAuth();
const { loadDocuments } = useLegal();
const acceptTerms = ref(false);
const acceptPd = ref(false);
const loading = ref(false);
const summary = ref('');
const ready = computed(() => acceptTerms.value && acceptPd.value);

onMounted(async () => {
  if (!currentData.value) await loadMe();
  if (currentData.value && currentData.value.pendingConsents.length === 0)
    await navigateTo('/app', { replace: true });
});

async function submit() {
  if (!ready.value) return;
  loading.value = true;
  summary.value = '';
  try {
    const documents = await loadDocuments();
    await acceptConsents(documents.map(({ document, version }) => ({ document, version })));
    await navigateTo('/app', { replace: true });
  } catch (error) {
    summary.value = errorMessage(error).summary;
  } finally {
    loading.value = false;
  }
}

async function signOut() {
  await logout();
  await navigateTo('/login', { replace: true });
}
</script>

<template>
  <AuthForm
    title="Мы обновили документы"
    subtitle="Чтобы продолжить работу, примите актуальные редакции документов."
    submit-label="Принять и продолжить"
    :loading="loading"
    :summary="summary"
    :submit-disabled="!ready"
    :submit-described-by="ready ? undefined : 'consent-hint'"
    :on-submit="submit"
  >
    <ConsentCheckboxes v-model:terms="acceptTerms" v-model:pd="acceptPd" />
    <p v-if="!ready" id="consent-hint" class="consent-hint">
      Чтобы продолжить, отметьте оба пункта.
    </p>
    <template #footer>
      <p class="form-links">
        <NuxtLink to="/app/settings/delete-account">Удалить аккаунт</NuxtLink>
        <button type="button" class="form-links__button" @click="signOut">Выйти</button>
      </p>
    </template>
  </AuthForm>
</template>

<style scoped>
.form-links__button {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.consent-hint {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: 0.78rem;
  font-weight: 500;
}
</style>
