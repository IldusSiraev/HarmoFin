<script setup lang="ts">
import { watch } from 'vue';

defineOptions({ name: 'UiModal' });

const props = defineProps<{
  open: boolean;
  title: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

function handleClose() {
  emit('close');
}

function handleBackdropClick(event: MouseEvent) {
  if (event.target === event.currentTarget) {
    handleClose();
  }
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
    <Transition name="modal">
      <div v-if="open" class="modal-backdrop" @click="handleBackdropClick">
        <div class="modal" role="dialog" :aria-label="title" aria-modal="true">
          <div class="modal__header">
            <h2 class="modal__title">{{ title }}</h2>
            <button type="button" class="modal__close" aria-label="Закрыть" @click="handleClose">
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
          <div class="modal__content">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--hf-space-4);
  background: var(--hf-color-overlay);
}

.modal {
  position: relative;
  width: 100%;
  max-width: 40rem;
  max-height: 90vh;
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow:
    0 20px 25px -5px rgb(0 0 0 / 20%),
    0 10px 10px -5px rgb(0 0 0 / 10%);
  overflow: hidden;
}

@media (max-width: 767px) {
  .modal {
    max-width: none;
    max-height: 100vh;
    border-radius: 0;
  }

  .modal-backdrop {
    padding: 0;
  }
}

.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-4);
  padding: var(--hf-space-5) var(--hf-space-6);
  border-bottom: 1px solid var(--hf-color-border);
}

.modal__title {
  margin: 0;
  color: var(--hf-color-text);
  font-size: 1.25rem;
  font-weight: 600;
}

.modal__close {
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

.modal__close:hover {
  background: var(--hf-color-action-secondary-hover);
}

.modal__close:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: -2px;
}

.modal__content {
  padding: var(--hf-space-6);
  overflow-y: auto;
  max-height: calc(90vh - 5rem);
}

@media (max-width: 767px) {
  .modal__content {
    max-height: calc(100vh - 5rem);
  }
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--hf-transition-base);
}

.modal-enter-active .modal,
.modal-leave-active .modal {
  transition:
    transform var(--hf-transition-base),
    opacity var(--hf-transition-base);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal {
  opacity: 0;
  transform: translateY(-20px) scale(0.95);
}

.modal-leave-to .modal {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}
</style>
