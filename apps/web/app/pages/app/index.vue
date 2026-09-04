<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { definePageMeta, navigateTo } from '#imports';

import { useAuth } from '../../composables/useAuth.js';

definePageMeta({ middleware: 'auth' });

const { currentData, loadMe, logout } = useAuth();
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    await loadMe();
    void currentData.value;
  } catch {
    error.value = 'Не удалось загрузить данные бюджета.';
  } finally {
    loading.value = false;
  }
});

async function signOut() {
  await logout();
  await navigateTo('/login');
}
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <NuxtLink class="app-wordmark" to="/app">HarmoFin</NuxtLink>
      <button type="button" @click="signOut">Выйти</button>
    </header>
    <section class="app-content" aria-live="polite">
      <p v-if="loading">Загрузка бюджета…</p>
      <p v-else-if="error" class="app-error">{{ error }}</p>
      <template v-else-if="currentData">
        <p class="app-kicker">Ваше пространство</p>
        <h1>{{ currentData.workspaces[0]?.name }}</h1>
        <p class="app-user">{{ currentData.user.email }}</p>
        <NuxtLink class="app-operations-link" to="/app/operations">Операции</NuxtLink>
        <section class="budget-card" aria-labelledby="budget-heading">
          <p>Активный бюджет</p>
          <h2 id="budget-heading">{{ currentData.workspaces[0]?.budgets[0]?.name }}</h2>
          <span>{{ currentData.workspaces[0]?.budgets[0]?.primaryCurrency }}</span>
        </section>
        <p class="app-note">Счета, операции и показатели появятся на следующих этапах.</p>
      </template>
    </section>
  </main>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  color: var(--hf-color-text);
  background: var(--hf-color-page-background);
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-4);
  max-width: 70rem;
  margin: 0 auto;
  padding: var(--hf-space-5) var(--hf-space-8);
}

.app-wordmark {
  color: var(--hf-color-text);
  font-size: 1.18rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: -0.04em;
  text-decoration: none;
}

button {
  min-height: var(--hf-control-height-sm);
  padding: 0 var(--hf-space-3);
  color: var(--hf-color-text);
  border: 1px solid var(--hf-color-border-strong);
  border-radius: var(--hf-button-radius);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

button:focus-visible {
  outline: none;
  box-shadow: var(--hf-focus-indicator);
}

.app-content {
  max-width: 70rem;
  margin: 7vh auto 0;
  padding: var(--hf-space-8);
}

.app-kicker {
  margin: 0 0 var(--hf-space-3);
  color: var(--hf-color-action-primary-hover);
  font-size: 0.74rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: clamp(2.4rem, 5vw, 4.7rem);
  line-height: 0.95;
  letter-spacing: -0.04em;
}

.app-user {
  color: var(--hf-color-text-muted);
}

.budget-card {
  display: grid;
  gap: var(--hf-space-2);
  max-width: 31rem;
  margin-top: var(--hf-space-10);
  padding: var(--hf-card-padding);
  border-left: 5px solid var(--hf-color-action-primary);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}

.budget-card p,
.budget-card h2 {
  margin: 0;
}

.budget-card p {
  color: var(--hf-color-text-muted);
  font-size: 0.85rem;
}

.budget-card h2 {
  font-size: 1.45rem;
  letter-spacing: -0.04em;
}

.budget-card span {
  color: var(--hf-color-action-primary-hover);
  font-weight: var(--hf-font-weight-bold);
}

.app-note,
.app-error {
  margin-top: var(--hf-space-8);
  color: var(--hf-color-text-muted);
}

.app-error {
  color: var(--hf-color-text-danger);
}

@media (max-width: 600px) {
  .app-header,
  .app-content {
    padding-right: var(--hf-space-5);
    padding-left: var(--hf-space-5);
  }
}
</style>
