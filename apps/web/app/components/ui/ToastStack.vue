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
.ui-toast-stack {
  position: fixed;
  right: var(--hf-space-4);
  bottom: var(--hf-space-4);
  left: var(--hf-space-4);
  z-index: 90;
  display: grid;
  gap: var(--hf-space-3);
  justify-items: center;
  pointer-events: none;
}

.ui-toast-stack > * {
  pointer-events: auto;
}

@media (min-width: 768px) {
  .ui-toast-stack {
    left: auto;
    justify-items: end;
  }
}
</style>
