<script setup lang="ts">
import AppHeader from '../components/app/AppHeader.vue';
import AppOperationDialogs from '../components/app/AppOperationDialogs.vue';
import AppSidebar from '../components/app/AppSidebar.vue';
import UiToastStack from '../components/ui/ToastStack.vue';

defineOptions({ name: 'AppLayout' });
</script>

<template>
  <div class="app-layout">
    <AppSidebar class="app-layout__sidebar" />
    <div class="app-layout__body">
      <AppHeader class="app-layout__header" />
      <main class="app-layout__main">
        <slot />
      </main>
    </div>

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
  }
}
</style>
