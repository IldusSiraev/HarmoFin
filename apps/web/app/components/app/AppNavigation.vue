<script setup lang="ts">
defineOptions({ name: 'AppNavigation' });
</script>

<template>
  <nav class="app-nav" aria-label="Основная навигация">
    <NuxtLink to="/app/operations" class="app-nav__link" active-class="app-nav__link--active">
      Операции
    </NuxtLink>
    <NuxtLink to="/app/accounts" class="app-nav__link" active-class="app-nav__link--active">
      Счета
    </NuxtLink>
    <NuxtLink to="/app/envelopes" class="app-nav__link" active-class="app-nav__link--active">
      Конверты
    </NuxtLink>
    <NuxtLink to="/app/plans" class="app-nav__link" active-class="app-nav__link--active">
      Планы
    </NuxtLink>
    <NuxtLink to="/app/categories" class="app-nav__link" active-class="app-nav__link--active">
      Категории
    </NuxtLink>
    <NuxtLink to="/app/analytics" class="app-nav__link" active-class="app-nav__link--active">
      Аналитика
    </NuxtLink>
    <NuxtLink to="/app/notifications" class="app-nav__link" active-class="app-nav__link--active">
      Уведомления
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
