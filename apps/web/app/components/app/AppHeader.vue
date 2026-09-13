<script setup lang="ts">
import { ref } from 'vue';

import AppMobileMenu from './AppMobileMenu.vue';
import AppMobileMenuButton from './AppMobileMenuButton.vue';
import AppUserMenu from './AppUserMenu.vue';

defineOptions({ name: 'AppHeader' });

const mobileMenuOpen = ref(false);

function toggleMobileMenu() {
  mobileMenuOpen.value = !mobileMenuOpen.value;
}

function closeMobileMenu() {
  mobileMenuOpen.value = false;
}
</script>

<template>
  <header class="app-header">
    <div class="app-header__container">
      <AppMobileMenuButton class="app-header__mobile-button" @toggle="toggleMobileMenu" />
      <NuxtLink to="/app" class="app-header__wordmark">HarmoFin</NuxtLink>
      <AppUserMenu class="app-header__user" />
    </div>
    <AppMobileMenu :open="mobileMenuOpen" @close="closeMobileMenu" />
  </header>
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid var(--hf-color-border);
  background: var(--hf-color-surface);
  box-shadow: 0 1px 2px rgb(13 27 42 / 4%);
}

.app-header__container {
  display: flex;
  align-items: center;
  gap: var(--hf-space-4);
  padding: var(--hf-space-4) var(--hf-space-5);
}

.app-header__wordmark {
  color: var(--hf-color-text);
  font-size: 1.125rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: -0.04em;
  text-decoration: none;
}

.app-header__wordmark:hover {
  color: var(--hf-color-action-primary);
}

.app-header__wordmark:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}

.app-header__user {
  min-width: 0;
  margin-left: auto;
}

.app-header__mobile-button {
  display: block;
}

@media (min-width: 768px) {
  .app-header__container {
    padding: var(--hf-space-4) var(--hf-space-8);
  }
}
</style>
