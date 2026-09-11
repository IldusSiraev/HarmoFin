<script setup lang="ts">
import AppHeader from '../components/app/AppHeader.vue';

defineOptions({ name: 'AppLayout' });
</script>

<template>
  <div class="app-layout">
    <AppHeader />
    <main class="app-layout__main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  min-height: 100vh;
  background: var(--hf-color-page-background);
}

.app-layout__main {
  max-width: 90rem;
  margin: 0 auto;
  padding: var(--hf-space-6) var(--hf-space-5);
}

@media (min-width: 768px) {
  .app-layout__main {
    padding: var(--hf-space-8);
  }
}
</style>
