<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { Menu, X } from '@lucide/vue';

import UiButton from '../ui/Button.vue';
import { landingNavLinks } from '../../data/landing.js';

defineOptions({ name: 'LandingHeader' });

const menuOpen = ref(false);
const scrolled = ref(false);

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value;
}

function closeMenu(): void {
  menuOpen.value = false;
}

function handleScroll(): void {
  scrolled.value = window.scrollY > 24;
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeMenu();
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('keydown', handleKeydown);
  handleScroll();
});

onBeforeUnmount(() => {
  window.removeEventListener('scroll', handleScroll);
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <header class="landing-header" :class="{ 'landing-header--scrolled': scrolled }">
    <div class="landing-header__inner">
      <NuxtLink to="/" class="landing-header__wordmark">HarmoFin</NuxtLink>

      <nav class="landing-header__nav" aria-label="Разделы страницы">
        <a
          v-for="link in landingNavLinks"
          :key="link.href"
          :href="link.href"
          class="landing-header__link"
        >
          {{ link.label }}
        </a>
      </nav>

      <div class="landing-header__actions">
        <UiButton to="/login" variant="tertiary" size="md">Войти</UiButton>
        <UiButton to="/register" variant="brand" size="md">Начать бесплатно</UiButton>
      </div>

      <button
        type="button"
        class="landing-header__toggle"
        data-testid="landing-menu-toggle"
        :aria-expanded="menuOpen ? 'true' : 'false'"
        aria-controls="landing-mobile-menu"
        :aria-label="menuOpen ? 'Закрыть меню' : 'Открыть меню'"
        @click="toggleMenu"
      >
        <X v-if="menuOpen" :size="24" aria-hidden="true" />
        <Menu v-else :size="24" aria-hidden="true" />
      </button>
    </div>

    <div v-if="menuOpen" id="landing-mobile-menu" class="landing-header__mobile">
      <a
        v-for="link in landingNavLinks"
        :key="link.href"
        :href="link.href"
        class="landing-header__link"
        @click="closeMenu"
      >
        {{ link.label }}
      </a>
      <UiButton to="/login" variant="secondary" size="lg" full-width>Войти</UiButton>
      <UiButton to="/register" variant="brand" size="lg" full-width>Начать бесплатно</UiButton>
    </div>
  </header>
</template>

<style scoped>
.landing-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: transparent;
}

.landing-header--scrolled {
  background: rgb(255 255 255 / 82%);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--hf-color-border);
}

.landing-header__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: var(--hf-container-max-wide);
  height: 4.5rem;
  gap: var(--hf-space-6);
  padding: 0 var(--hf-space-4);
  margin: 0 auto;
}

.landing-header__wordmark {
  font-weight: var(--hf-font-weight-semibold);
  font-size: var(--hf-font-size-body);
  color: var(--hf-color-text);
  text-decoration: none;
}

.landing-header__nav {
  display: none;
  align-items: center;
  gap: var(--hf-space-6);
  flex: 1;
}

.landing-header__link {
  color: var(--hf-color-text);
  text-decoration: none;
}

.landing-header__actions {
  display: none;
  align-items: center;
  gap: var(--hf-space-3);
}

.landing-header__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text);
}

.landing-header__mobile {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-space-4);
  background: var(--hf-color-surface);
  border-bottom: 1px solid var(--hf-color-border);
}

@media (min-width: 1024px) {
  .landing-header__nav,
  .landing-header__actions {
    display: flex;
  }

  .landing-header__toggle {
    display: none;
  }
}
</style>
