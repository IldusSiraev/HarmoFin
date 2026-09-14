<script setup lang="ts">
import { navigateTo } from '#imports';

import { useAuth } from '../../composables/useAuth.js';
import AppAddMenu from './AppAddMenu.vue';
import AppSidebarSection from './AppSidebarSection.vue';

defineOptions({ name: 'AppSidebar' });

const { currentData, logout } = useAuth();

function userEmail() {
  return currentData.value?.user?.email ?? '';
}

async function handleLogout() {
  await logout();
  await navigateTo('/login');
}
</script>

<template>
  <aside class="app-sidebar" aria-label="Основная навигация">
    <NuxtLink to="/app" class="app-sidebar__wordmark">HarmoFin</NuxtLink>
    <AppAddMenu class="app-sidebar__add" />
    <nav class="app-sidebar__nav">
      <AppSidebarSection>
        <NuxtLink to="/app" class="app-sidebar__link" active-class="app-sidebar__link--active"
          >Главная</NuxtLink
        >
      </AppSidebarSection>
      <AppSidebarSection label="Учёт">
        <NuxtLink
          to="/app/operations"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          >Операции</NuxtLink
        >
        <NuxtLink
          to="/app/transfers"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          >Переводы</NuxtLink
        >
        <NuxtLink to="/app/plans" class="app-sidebar__link" active-class="app-sidebar__link--active"
          >Планы</NuxtLink
        >
      </AppSidebarSection>
      <AppSidebarSection label="Справочники">
        <NuxtLink
          to="/app/accounts"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          >Счета</NuxtLink
        >
        <NuxtLink
          to="/app/envelopes"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          >Конверты</NuxtLink
        >
        <NuxtLink
          to="/app/categories"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          >Категории</NuxtLink
        >
      </AppSidebarSection>
      <AppSidebarSection>
        <NuxtLink
          to="/app/analytics"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          >Аналитика</NuxtLink
        >
        <NuxtLink
          to="/app/notifications"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          >Уведомления</NuxtLink
        >
      </AppSidebarSection>
    </nav>
    <div class="app-sidebar__footer">
      <NuxtLink
        to="/app/settings"
        class="app-sidebar__link"
        active-class="app-sidebar__link--active"
        >Настройки</NuxtLink
      >
      <div class="app-sidebar__user">
        <span class="app-sidebar__email">{{ userEmail() }}</span>
        <button type="button" class="app-sidebar__logout" @click="handleLogout">Выйти</button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.app-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--hf-space-6);
  width: var(--hf-sidebar-width);
  height: 100vh;
  padding: var(--hf-space-5) var(--hf-space-4);
  border-right: 1px solid var(--hf-color-border);
  background: var(--hf-color-surface);
}

.app-sidebar__wordmark {
  padding: 0 var(--hf-space-3);
  color: var(--hf-color-text);
  font-size: 1.125rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: -0.04em;
  text-decoration: none;
}

.app-sidebar__add {
  padding: 0 var(--hf-space-3);
}

.app-sidebar__nav {
  display: grid;
  gap: var(--hf-space-5);
  overflow-y: auto;
}

.app-sidebar__link {
  display: block;
  min-height: 2.5rem;
  padding: var(--hf-space-2) var(--hf-space-3);
  border-radius: var(--hf-control-radius);
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
  text-decoration: none;
  transition: background var(--hf-transition-fast);
}

.app-sidebar__link:hover {
  background: var(--hf-color-action-secondary-hover);
}

.app-sidebar__link:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: -2px;
}

.app-sidebar__link--active {
  background: var(--hf-color-action-secondary-hover);
  color: var(--hf-color-action-primary);
}

.app-sidebar__footer {
  display: grid;
  gap: var(--hf-space-2);
  margin-top: auto;
  padding-top: var(--hf-space-4);
  border-top: 1px solid var(--hf-color-border);
}

.app-sidebar__user {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-2);
  min-width: 0;
  padding: 0 var(--hf-space-3);
}

.app-sidebar__email {
  overflow: hidden;
  min-width: 0;
  color: var(--hf-color-text-muted);
  font-size: 0.875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-sidebar__logout {
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: none;
  color: var(--hf-color-action-danger);
  font: inherit;
  font-weight: var(--hf-font-weight-semibold);
  cursor: pointer;
}
</style>
