<script setup lang="ts">
import UiToast from './Toast.vue';
import { useToast } from '../../composables/useToast.js';

defineOptions({ name: 'UiToastStack' });

const { toasts, dismiss, hold, release } = useToast();
</script>

<template>
  <div
    class="ui-toast-stack"
    data-testid="toast-stack"
    role="status"
    aria-live="polite"
    aria-relevant="additions"
  >
    <UiToast
      v-for="toast in toasts"
      :key="toast.id"
      :toast="toast"
      @dismiss="dismiss"
      @hold="hold"
      @release="release"
    />
  </div>
</template>

<style scoped>
/* Toasts stay under modals and drawers (200): those overlays keep their
   actions at the bottom, and dialogs confirm their own results inline. */
.ui-toast-stack {
  position: fixed;
  right: var(--hf-space-4);
  bottom: var(--hf-space-4);
  left: var(--hf-space-4);
  z-index: 96;
  display: grid;
  gap: var(--hf-space-3);
  justify-items: center;
  pointer-events: none;
}

.ui-toast-stack > * {
  pointer-events: auto;
}

/* Below 1024px the bottom navigation bar (z-index 95) is shown; toasts sit
   above it instead of being hidden behind it. */
@media (max-width: 1023px) {
  .ui-toast-stack {
    bottom: calc(var(--hf-space-16) + env(safe-area-inset-bottom));
  }
}

@media (min-width: 768px) {
  .ui-toast-stack {
    left: auto;
    justify-items: end;
  }
}
</style>
