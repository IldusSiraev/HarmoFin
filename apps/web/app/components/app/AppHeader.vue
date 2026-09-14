<script setup lang="ts">
import AppAddMenu from './AppAddMenu.vue';
import AppMobileMenuButton from './AppMobileMenuButton.vue';
import AppUserMenu from './AppUserMenu.vue';

defineOptions({ name: 'AppHeader' });

defineEmits<{ toggleMobileMenu: [] }>();
</script>

<template>
  <header class="app-header">
    <div class="app-header__container">
      <AppMobileMenuButton class="app-header__mobile-button" @toggle="$emit('toggleMobileMenu')" />
      <NuxtLink to="/app" class="app-header__wordmark">HarmoFin</NuxtLink>
      <AppAddMenu class="app-header__add" />
      <AppUserMenu class="app-header__user" />
    </div>
  </header>
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid var(--hf-color-border);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-xs);
}

.app-header__container {
  display: flex;
  align-items: center;
  gap: var(--hf-space-4);
  min-height: 4.5rem;
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

.app-header__add {
  margin-left: auto;
}

.app-header__user {
  min-width: 0;
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
