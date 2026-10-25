<script setup lang="ts">
import { watch } from 'vue';
import { navigateTo, useRoute } from '#imports';

import { useAuth } from '../../composables/useAuth.js';
import AppWorkspaceSwitcher from './AppWorkspaceSwitcher.vue';

defineOptions({ name: 'AppMobileMenu' });

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { currentData, logout } = useAuth();
const route = useRoute();

// `/app` would otherwise match every nested section, so only it compares exactly.
function currentPage(to: string): 'page' | undefined {
  const active = to === '/app' ? route.path === '/app' : route.path.startsWith(to);
  return active ? 'page' : undefined;
}

function userEmail() {
  return currentData.value?.user?.email ?? '';
}

function handleClose() {
  emit('close');
}

async function handleLogout() {
  emit('close');
  await logout();
  await navigateTo('/login');
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="mobile-menu">
      <div v-if="open" class="mobile-menu">
        <div class="mobile-menu__overlay" @click="handleClose" />
        <nav class="mobile-menu__panel hf-scroll" aria-label="Мобильное меню">
          <div class="mobile-menu__header">
            <button
              type="button"
              class="mobile-menu__close"
              aria-label="Закрыть меню"
              @click="handleClose"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M18 6L6 18M6 6l12 12"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </div>

          <div class="mobile-menu__user">
            <AppWorkspaceSwitcher class="mobile-menu__workspace" />
            <div class="mobile-menu__user-email">{{ userEmail() }}</div>
          </div>

          <div class="mobile-menu__nav">
            <NuxtLink
              to="/app"
              class="mobile-menu__link"
              active-class="mobile-menu__link--active"
              :aria-current="currentPage('/app')"
              @click="handleClose"
            >
              Главная
            </NuxtLink>
            <NuxtLink
              to="/app/operations"
              class="mobile-menu__link"
              active-class="mobile-menu__link--active"
              :aria-current="currentPage('/app/operations')"
              @click="handleClose"
            >
              Операции
            </NuxtLink>
            <NuxtLink
              to="/app/accounts"
              class="mobile-menu__link"
              active-class="mobile-menu__link--active"
              :aria-current="currentPage('/app/accounts')"
              @click="handleClose"
            >
              Счета
            </NuxtLink>
            <NuxtLink
              to="/app/envelopes"
              class="mobile-menu__link"
              active-class="mobile-menu__link--active"
              :aria-current="currentPage('/app/envelopes')"
              @click="handleClose"
            >
              Конверты
            </NuxtLink>
            <NuxtLink
              to="/app/plans"
              class="mobile-menu__link"
              active-class="mobile-menu__link--active"
              :aria-current="currentPage('/app/plans')"
              @click="handleClose"
            >
              Планы
            </NuxtLink>
            <NuxtLink
              to="/app/categories"
              class="mobile-menu__link"
              active-class="mobile-menu__link--active"
              :aria-current="currentPage('/app/categories')"
              @click="handleClose"
            >
              Категории
            </NuxtLink>
            <NuxtLink
              to="/app/analytics"
              class="mobile-menu__link"
              active-class="mobile-menu__link--active"
              :aria-current="currentPage('/app/analytics')"
              @click="handleClose"
            >
              Аналитика
            </NuxtLink>
            <NuxtLink
              to="/app/notifications"
              class="mobile-menu__link"
              active-class="mobile-menu__link--active"
              :aria-current="currentPage('/app/notifications')"
              @click="handleClose"
            >
              Уведомления
            </NuxtLink>
            <NuxtLink
              to="/app/settings"
              class="mobile-menu__link"
              active-class="mobile-menu__link--active"
              :aria-current="currentPage('/app/settings')"
              @click="handleClose"
            >
              Настройки
            </NuxtLink>
          </div>

          <div class="mobile-menu__footer">
            <button type="button" class="mobile-menu__logout" @click="handleLogout">Выйти</button>
          </div>
        </nav>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mobile-menu {
  position: fixed;
  inset: 0;
  z-index: 300;
}

.mobile-menu__overlay {
  position: absolute;
  inset: 0;
  background: var(--hf-color-overlay);
}

.mobile-menu__panel {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  width: 80%;
  max-width: 20rem;
  height: 100%;
  background: var(--hf-color-surface);
  box-shadow: 4px 0 6px rgb(13 27 42 / 10%);
  overflow-y: auto;
}

.mobile-menu__header {
  display: flex;
  justify-content: flex-end;
  padding: var(--hf-space-4);
  border-bottom: 1px solid var(--hf-color-border);
}

.mobile-menu__close {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  padding: var(--hf-space-2);
  color: var(--hf-color-text);
  border: none;
  border-radius: var(--hf-control-radius);
  background: transparent;
  cursor: pointer;
  transition: background var(--hf-transition-fast);
}

.mobile-menu__close:hover {
  background: var(--hf-color-action-secondary-hover);
}

.mobile-menu__close:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: -2px;
}

.mobile-menu__user {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-space-5) var(--hf-space-4);
  border-bottom: 1px solid var(--hf-color-border);
}

.mobile-menu__workspace {
  width: 100%;
}

.mobile-menu__user-email {
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-semibold);
  word-break: break-word;
}

.mobile-menu__nav {
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: var(--hf-space-2);
}

.mobile-menu__link {
  display: flex;
  align-items: center;
  min-height: 2.75rem;
  padding: var(--hf-space-3) var(--hf-space-4);
  color: var(--hf-color-text);
  border-radius: var(--hf-control-radius);
  font-weight: var(--hf-font-weight-medium);
  text-decoration: none;
  transition: background var(--hf-transition-fast);
}

.mobile-menu__link:hover {
  background: var(--hf-color-action-secondary-hover);
}

.mobile-menu__link:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: -2px;
}

.mobile-menu__link--active {
  color: var(--hf-color-brand);
  background: var(--hf-color-brand-soft);
  font-weight: var(--hf-font-weight-semibold);
}

.mobile-menu__footer {
  padding: var(--hf-space-4);
  border-top: 1px solid var(--hf-color-border);
}

.mobile-menu__logout {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: var(--hf-space-3) var(--hf-space-4);
  color: var(--hf-color-action-danger);
  border: none;
  border-radius: var(--hf-control-radius);
  background: transparent;
  font: inherit;
  font-weight: var(--hf-font-weight-semibold);
  text-align: left;
  cursor: pointer;
  transition: background var(--hf-transition-fast);
}

.mobile-menu__logout:hover {
  background: var(--hf-color-status-danger-background);
}

.mobile-menu__logout:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: -2px;
}

.mobile-menu-enter-active,
.mobile-menu-leave-active {
  transition: opacity var(--hf-transition-base);
}

.mobile-menu-enter-active .mobile-menu__panel,
.mobile-menu-leave-active .mobile-menu__panel {
  transition: transform var(--hf-transition-base);
}

.mobile-menu-enter-from,
.mobile-menu-leave-to {
  opacity: 0;
}

.mobile-menu-enter-from .mobile-menu__panel {
  transform: translateX(-100%);
}

.mobile-menu-leave-to .mobile-menu__panel {
  transform: translateX(-100%);
}
</style>
