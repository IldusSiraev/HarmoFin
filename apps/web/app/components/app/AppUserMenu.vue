<script setup lang="ts">
import { ref } from 'vue';
import { navigateTo } from '#imports';

import { useAuth } from '../../composables/useAuth.js';

defineOptions({ name: 'AppUserMenu' });

const { currentData, logout } = useAuth();
const menuOpen = ref(false);

function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}

function closeMenu() {
  menuOpen.value = false;
}

function userEmail() {
  return currentData.value?.user?.email ?? '';
}

async function handleLogout() {
  closeMenu();
  await logout();
  await navigateTo('/login');
}
</script>

<template>
  <div class="user-menu">
    <button
      type="button"
      class="user-menu__button"
      :aria-expanded="menuOpen"
      aria-haspopup="true"
      @click="toggleMenu"
    >
      <span class="user-menu__email">{{ userEmail() }}</span>
      <svg
        class="user-menu__chevron"
        :class="{ 'user-menu__chevron--open': menuOpen }"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M4 6L8 10L12 6"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <Transition name="user-menu-dropdown">
      <div v-if="menuOpen" class="user-menu__dropdown">
        <div class="user-menu__backdrop" @click="closeMenu" />
        <div class="user-menu__panel" role="menu">
          <NuxtLink to="/app/settings" class="user-menu__item" role="menuitem" @click="closeMenu">
            Настройки
          </NuxtLink>
          <button type="button" class="user-menu__item" role="menuitem" @click="handleLogout">
            Выйти
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.user-menu {
  position: relative;
}

.user-menu__button {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  min-height: 44px;
  padding: var(--hf-space-2) var(--hf-space-3);
  color: var(--hf-color-text);
  border: none;
  border-radius: var(--hf-control-radius);
  background: transparent;
  font: inherit;
  cursor: pointer;
  transition: background var(--hf-transition-fast);
}

.user-menu__button:hover {
  background: var(--hf-color-action-secondary-hover);
}

.user-menu__button:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.user-menu__email {
  font-weight: var(--hf-font-weight-medium);
}

.user-menu__chevron {
  transition: transform var(--hf-transition-fast);
}

.user-menu__chevron--open {
  transform: rotate(180deg);
}

.user-menu__dropdown {
  position: fixed;
  inset: 0;
  z-index: 100;
}

.user-menu__backdrop {
  position: absolute;
  inset: 0;
}

.user-menu__panel {
  position: absolute;
  top: 3.5rem;
  right: var(--hf-space-5);
  min-width: 12rem;
  padding: var(--hf-space-2);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  box-shadow:
    0 4px 6px rgb(13 27 42 / 10%),
    0 2px 4px rgb(13 27 42 / 6%);
}

@media (min-width: 768px) {
  .user-menu__panel {
    right: var(--hf-space-8);
  }
}

.user-menu__item {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: var(--hf-space-2) var(--hf-space-3);
  color: var(--hf-color-text);
  border: none;
  border-radius: var(--hf-radius-sm);
  background: transparent;
  font: inherit;
  font-weight: var(--hf-font-weight-medium);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: background var(--hf-transition-fast);
}

.user-menu__item:hover {
  background: var(--hf-color-action-secondary-hover);
}

.user-menu__item:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: -2px;
}

.user-menu-dropdown-enter-active,
.user-menu-dropdown-leave-active {
  transition: opacity var(--hf-transition-fast);
}

.user-menu-dropdown-enter-active .user-menu__panel,
.user-menu-dropdown-leave-active .user-menu__panel {
  transition:
    transform var(--hf-transition-fast),
    opacity var(--hf-transition-fast);
}

.user-menu-dropdown-enter-from,
.user-menu-dropdown-leave-to {
  opacity: 0;
}

.user-menu-dropdown-enter-from .user-menu__panel,
.user-menu-dropdown-leave-to .user-menu__panel {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
