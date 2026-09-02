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
  background: #edf1f4;
  color: #172434;
}
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 70rem;
  margin: 0 auto;
  padding: 1.25rem 2rem;
}
.app-wordmark {
  color: #173f56;
  font-size: 1.18rem;
  font-weight: 800;
  letter-spacing: -0.05em;
  text-decoration: none;
}
button {
  padding: 0.6rem 0.8rem;
  border: 1px solid #9aabb5;
  border-radius: 0.35rem;
  background: transparent;
  color: #24313f;
  font: inherit;
  cursor: pointer;
}
button:focus-visible {
  outline: 3px solid #e6b947;
  outline-offset: 3px;
}
.app-content {
  max-width: 70rem;
  margin: 7vh auto 0;
  padding: 2rem;
}
.app-kicker {
  margin: 0 0 0.75rem;
  color: #25818c;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
h1 {
  margin: 0;
  font-size: clamp(2.4rem, 5vw, 4.7rem);
  letter-spacing: -0.07em;
  line-height: 0.95;
}
.app-user {
  color: #60707c;
}
.budget-card {
  display: grid;
  gap: 0.35rem;
  max-width: 31rem;
  margin-top: 3rem;
  padding: 1.5rem;
  border-left: 5px solid #25818c;
  background: #fff;
  box-shadow: 0 18px 45px rgb(28 58 74 / 9%);
}
.budget-card p,
.budget-card h2 {
  margin: 0;
}
.budget-card p {
  color: #60707c;
  font-size: 0.85rem;
}
.budget-card h2 {
  font-size: 1.45rem;
  letter-spacing: -0.04em;
}
.budget-card span {
  color: #176c78;
  font-weight: 750;
}
.app-note,
.app-error {
  margin-top: 2rem;
  color: #60707c;
}
.app-error {
  color: #9b372c;
}
@media (max-width: 600px) {
  .app-header,
  .app-content {
    padding-left: 1.25rem;
    padding-right: 1.25rem;
  }
}
</style>
