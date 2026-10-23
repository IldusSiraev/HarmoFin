<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { navigateTo, useRoute } from '#imports';
import {
  BarChart3,
  Bell,
  CalendarClock,
  Home,
  Moon,
  PiggyBank,
  Receipt,
  Settings,
  Sun,
  Tag,
  Wallet,
} from '@lucide/vue';

import { useAuth } from '../../composables/useAuth.js';
import { useColorScheme } from '../../composables/useColorScheme.js';
import UiButton from '../ui/Button.vue';
import AppAddMenu from './AppAddMenu.vue';
import AppSidebarSection from './AppSidebarSection.vue';

defineOptions({ name: 'AppSidebar' });

const { currentData, logout } = useAuth();
const { resolved, toggle } = useColorScheme();
const route = useRoute();

// The auth middleware skips the server (it has no session to forward) and
// resolves on the client before the app mounts, so `currentData` is already
// populated by the time hydration runs. Reading it straight away would ship
// an email the server never rendered. Waiting for onMounted keeps the first
// client render at the server's empty text, then fills it in right after.
const hydrated = ref(false);

// `/app` would otherwise match every nested section, so only it compares exactly.
function isActive(to: string): boolean {
  return to === '/app' ? route.path === '/app' : route.path.startsWith(to);
}

function currentPage(to: string): 'page' | undefined {
  return isActive(to) ? 'page' : undefined;
}

function userEmail() {
  return hydrated.value ? (currentData.value?.user?.email ?? '') : '';
}

onMounted(() => {
  hydrated.value = true;
});

async function handleLogout() {
  await logout();
  await navigateTo('/login');
}
</script>

<template>
  <aside class="app-sidebar" aria-label="Основная навигация">
    <div class="app-sidebar__top">
      <NuxtLink to="/app" class="app-sidebar__wordmark">HarmoFin</NuxtLink>
      <div class="app-sidebar__top-actions">
        <AppAddMenu class="app-sidebar__add" tooltip-placement="bottom" />
        <UiButton
          variant="tertiary"
          size="sm"
          class="app-sidebar__theme-toggle"
          tooltip="Сменить тему"
          tooltip-placement="bottom"
          :aria-label="
            hydrated && resolved() === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'
          "
          @click="toggle"
        >
          <Sun v-if="hydrated && resolved() === 'dark'" :size="18" aria-hidden="true" />
          <Moon v-else :size="18" aria-hidden="true" />
        </UiButton>
      </div>
    </div>
    <nav class="app-sidebar__nav hf-scroll">
      <AppSidebarSection>
        <NuxtLink
          to="/app"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          :aria-current="currentPage('/app')"
          ><Home :size="18" aria-hidden="true" />Главная</NuxtLink
        >
      </AppSidebarSection>
      <AppSidebarSection label="Учёт">
        <NuxtLink
          to="/app/operations"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          :aria-current="currentPage('/app/operations')"
          ><Receipt :size="18" aria-hidden="true" />Операции</NuxtLink
        >
        <NuxtLink
          to="/app/plans"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          :aria-current="currentPage('/app/plans')"
          ><CalendarClock :size="18" aria-hidden="true" />Планы</NuxtLink
        >
      </AppSidebarSection>
      <AppSidebarSection label="Справочники">
        <NuxtLink
          to="/app/accounts"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          :aria-current="currentPage('/app/accounts')"
          ><Wallet :size="18" aria-hidden="true" />Счета</NuxtLink
        >
        <NuxtLink
          to="/app/envelopes"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          :aria-current="currentPage('/app/envelopes')"
          ><PiggyBank :size="18" aria-hidden="true" />Конверты</NuxtLink
        >
        <NuxtLink
          to="/app/categories"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          :aria-current="currentPage('/app/categories')"
          ><Tag :size="18" aria-hidden="true" />Категории</NuxtLink
        >
      </AppSidebarSection>
      <AppSidebarSection>
        <NuxtLink
          to="/app/analytics"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          :aria-current="currentPage('/app/analytics')"
          ><BarChart3 :size="18" aria-hidden="true" />Аналитика</NuxtLink
        >
        <NuxtLink
          to="/app/notifications"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          :aria-current="currentPage('/app/notifications')"
          ><Bell :size="18" aria-hidden="true" />Уведомления</NuxtLink
        >
      </AppSidebarSection>
    </nav>
    <div class="app-sidebar__footer">
      <NuxtLink
        to="/app/settings"
        class="app-sidebar__link"
        active-class="app-sidebar__link--active"
        :aria-current="currentPage('/app/settings')"
        ><Settings :size="18" aria-hidden="true" />Настройки</NuxtLink
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

.app-sidebar__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: var(--hf-space-2);
}

.app-sidebar__wordmark {
  padding: 0 var(--hf-space-3);
  color: var(--hf-color-text);
  font-size: 1.125rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: -0.04em;
  text-decoration: none;
}

.app-sidebar__top-actions {
  display: flex;
  gap: var(--hf-space-1);
  align-items: center;
}

.app-sidebar__theme-toggle {
  min-width: 2.25rem;
  padding-inline: 0;
}

.app-sidebar__add {
  min-width: 2.25rem;
  padding-inline: 0;
}

.app-sidebar__nav {
  display: grid;
  gap: var(--hf-space-5);
  overflow-y: auto;
}

.app-sidebar__link {
  display: flex;
  gap: var(--hf-space-3);
  align-items: center;
  min-height: 2.75rem;
  padding: var(--hf-space-2) var(--hf-space-3);
  border-radius: var(--hf-radius-md);
  color: var(--hf-color-text-muted);
  font-weight: var(--hf-font-weight-medium);
  text-decoration: none;
  transition:
    background var(--hf-transition-fast),
    color var(--hf-transition-fast);
}

.app-sidebar__link svg {
  flex-shrink: 0;
}

.app-sidebar__link:hover {
  background: var(--hf-color-action-secondary-hover);
}

.app-sidebar__link:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: -2px;
}

.app-sidebar__link--active {
  background: var(--hf-color-brand-soft);
  color: var(--hf-color-brand);
  font-weight: var(--hf-font-weight-semibold);
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
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-sidebar__logout {
  flex-shrink: 0;
  min-height: 2.75rem;
  padding: 0;
  border: none;
  background: none;
  color: var(--hf-color-action-danger);
  font: inherit;
  font-weight: var(--hf-font-weight-semibold);
  cursor: pointer;
}

.app-sidebar__logout:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}
</style>
