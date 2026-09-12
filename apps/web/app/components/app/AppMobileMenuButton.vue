<script setup lang="ts">
defineOptions({ name: 'AppMobileMenuButton' });
defineEmits<{
  toggle: [];
}>();
</script>

<template>
  <button
    type="button"
    class="mobile-menu-button"
    aria-label="Открыть меню"
    @click="$emit('toggle')"
  >
    <svg
      class="mobile-menu-button__icon"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 12h18M3 6h18M3 18h18"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
  </button>
</template>

<style scoped>
.mobile-menu-button {
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

.mobile-menu-button:hover {
  background: var(--hf-color-action-secondary-hover);
}

.mobile-menu-button:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.mobile-menu-button__icon {
  width: 24px;
  height: 24px;
}
</style>
