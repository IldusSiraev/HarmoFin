<script setup lang="ts">
defineOptions({ name: 'AppSidebarSection' });
defineProps<{ label?: string | undefined }>();
</script>

<template>
  <div class="app-sidebar-section">
    <p v-if="label" class="app-sidebar-section__label">{{ label }}</p>
    <div class="app-sidebar-section__links"><slot /></div>
  </div>
</template>

<style scoped>
.app-sidebar-section {
  display: grid;
  gap: var(--hf-space-1);
}

.app-sidebar-section__label {
  margin: 0;
  padding: 0 var(--hf-space-3);
  color: var(--hf-color-text-subtle);
  font-size: 0.75rem;
  font-weight: var(--hf-font-weight-semibold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.app-sidebar-section__links {
  display: grid;
  gap: var(--hf-space-1);
}
</style>
