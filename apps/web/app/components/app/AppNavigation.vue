<script setup lang="ts">
defineOptions({ name: 'AppNavigation' });

const navLinks = [
  { to: '/app/operations', label: 'Операции' },
  { to: '/app/accounts', label: 'Счета' },
  { to: '/app/envelopes', label: 'Конверты' },
  { to: '/app/plans', label: 'Планы' },
  { to: '/app/categories', label: 'Категории' },
  { to: '/app/analytics', label: 'Аналитика' },
  { to: '/app/notifications', label: 'Уведомления' },
];
</script>

<template>
  <nav class="app-nav" aria-label="Основная навигация">
    <NuxtLink
      v-for="link in navLinks"
      :key="link.to"
      :to="link.to"
      class="app-nav__link"
      active-class="app-nav__link--active"
    >
      {{ link.label }}
    </NuxtLink>
  </nav>
</template>

<style scoped>
.app-nav {
  display: flex;
  align-items: center;
  gap: var(--hf-space-4);
}

.app-nav__link {
  position: relative;
  padding: var(--hf-space-2) 0;
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
  text-decoration: none;
  transition: color var(--hf-transition-fast);
}

.app-nav__link:hover {
  color: var(--hf-color-action-primary);
}

.app-nav__link:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}

.app-nav__link--active {
  color: var(--hf-color-action-primary);
}

.app-nav__link--active::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 2px;
  background: var(--hf-color-action-primary);
  content: '';
}
</style>
