<script setup lang="ts">
import { ref } from 'vue';

import AppBottomNav from '../components/app/AppBottomNav.vue';
import AppHeader from '../components/app/AppHeader.vue';
import AppMobileMenu from '../components/app/AppMobileMenu.vue';
import AppOperationDialogs from '../components/app/AppOperationDialogs.vue';
import AppSidebar from '../components/app/AppSidebar.vue';
import UiToastStack from '../components/ui/ToastStack.vue';

defineOptions({ name: 'AppLayout' });

// The mobile menu has two entry points now — the burger in the header and
// "Ещё" in the bottom navigation — so the layout owns its state.
const mobileMenuOpen = ref(false);
</script>

<template>
  <div class="app-layout">
    <AppSidebar class="app-layout__sidebar" />
    <div class="app-layout__body">
      <AppHeader
        class="app-layout__header"
        @toggle-mobile-menu="mobileMenuOpen = !mobileMenuOpen"
      />
      <main class="app-layout__main">
        <slot />
      </main>
    </div>

    <AppMobileMenu :open="mobileMenuOpen" @close="mobileMenuOpen = false" />
    <AppBottomNav @more="mobileMenuOpen = true" />
    <AppOperationDialogs />
    <UiToastStack />
  </div>
</template>

<style scoped>
.app-layout {
  min-height: 100vh;
  background: var(--hf-color-page-background);
}

.app-layout__sidebar {
  display: none;
}

.app-layout__main {
  padding: var(--hf-space-6) var(--hf-space-5);
  padding-bottom: calc(var(--hf-space-16) + env(safe-area-inset-bottom));
}

@media (min-width: 1024px) {
  .app-layout {
    display: grid;
    grid-template-columns: var(--hf-sidebar-width) 1fr;
  }

  .app-layout__sidebar {
    display: flex;
  }

  .app-layout__header {
    display: none;
  }

  .app-layout__main {
    padding: var(--hf-space-8);
  }
}

@media (min-width: 768px) and (max-width: 1023px) {
  .app-layout__main {
    padding: var(--hf-space-8);
    padding-bottom: calc(var(--hf-space-16) + env(safe-area-inset-bottom));
  }
}
</style>
