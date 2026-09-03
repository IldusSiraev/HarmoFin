<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch, type WatchStopHandle } from 'vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    variant: 'primary' | 'danger';
    loading?: boolean;
  }>(),
  {
    loading: false,
  },
);

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const dialog = ref<HTMLDialogElement>();
const cancelButton = ref<HTMLButtonElement>();
const confirmButton = ref<HTMLButtonElement>();
const dialogId = useId();
let returnFocus: HTMLElement | undefined;
let stopWatch: WatchStopHandle | undefined;

function getTitleId() {
  return `ui-confirm-dialog-${dialogId}-title`;
}

function getDescriptionId() {
  return `ui-confirm-dialog-${dialogId}-description`;
}

async function openDialog() {
  const element = dialog.value;

  if (!element || element.open) {
    return;
  }

  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  element.showModal();
  await nextTick();
  (cancelButton.value ?? confirmButton.value)?.focus();
}

function closeDialog() {
  const element = dialog.value;

  if (element?.open) {
    element.close();
  }

  returnFocus?.focus();
  returnFocus = undefined;
}

function handleCancel(event: Event) {
  event.preventDefault();

  if (!props.loading) {
    emit('cancel');
  }
}

function handleConfirm() {
  if (!props.loading) {
    emit('confirm');
  }
}

onMounted(() => {
  stopWatch = watch(
    () => props.open,
    (open) => {
      if (open) {
        void openDialog();
      } else {
        closeDialog();
      }
    },
    { immediate: true },
  );
});

onBeforeUnmount(() => {
  stopWatch?.();
});
</script>

<template>
  <dialog
    ref="dialog"
    class="ui-confirm-dialog"
    :aria-labelledby="getTitleId()"
    :aria-describedby="getDescriptionId()"
    @cancel="handleCancel"
  >
    <form class="ui-confirm-dialog__content" method="dialog" @submit.prevent="handleConfirm">
      <h2 :id="getTitleId()" class="ui-confirm-dialog__title">{{ title }}</h2>
      <p :id="getDescriptionId()" class="ui-confirm-dialog__description">{{ description }}</p>
      <div class="ui-confirm-dialog__actions">
        <button
          ref="cancelButton"
          class="ui-confirm-dialog__button ui-confirm-dialog__button--secondary"
          type="button"
          :disabled="loading"
          @click="!loading && emit('cancel')"
        >
          {{ cancelLabel }}
        </button>
        <button
          ref="confirmButton"
          class="ui-confirm-dialog__button"
          :class="`ui-confirm-dialog__button--${variant}`"
          type="submit"
          data-confirm
          :disabled="loading"
          :aria-busy="loading || undefined"
        >
          <span v-if="loading" class="ui-confirm-dialog__loader" aria-hidden="true" />
          {{ confirmLabel }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.ui-confirm-dialog {
  width: min(calc(100% - 2.5rem), 32rem);
  margin: auto;
  padding: 0;
  color: var(--hf-color-text);
  border: 0;
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}

.ui-confirm-dialog::backdrop {
  background: var(--hf-color-overlay);
}

.ui-confirm-dialog__content {
  display: grid;
  gap: var(--hf-space-4);
  padding: var(--hf-space-6);
}

.ui-confirm-dialog__title,
.ui-confirm-dialog__description {
  margin: 0;
}

.ui-confirm-dialog__title {
  font-size: 1.25rem;
  font-weight: var(--hf-font-weight-semibold);
}

.ui-confirm-dialog__description {
  color: var(--hf-color-text-muted);
}

.ui-confirm-dialog__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--hf-space-3);
  margin-top: var(--hf-space-2);
}

.ui-confirm-dialog__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--hf-space-2);
  min-height: var(--hf-control-height-md);
  padding: 0 var(--hf-space-3);
  border: 1px solid transparent;
  border-radius: var(--hf-button-radius);
  font-weight: var(--hf-button-font-weight);
}

.ui-confirm-dialog__button--secondary {
  color: var(--hf-color-text);
  border-color: var(--hf-color-border-strong);
  background: var(--hf-color-surface);
}

.ui-confirm-dialog__button--primary {
  color: var(--hf-color-white);
  background: var(--hf-color-action-primary);
}

.ui-confirm-dialog__button--primary:hover:not(:disabled) {
  background: var(--hf-color-action-primary-hover);
}

.ui-confirm-dialog__button--danger {
  color: var(--hf-color-white);
  background: var(--hf-color-action-danger);
}

.ui-confirm-dialog__button--danger:hover:not(:disabled) {
  background: var(--hf-color-action-danger-hover);
}

.ui-confirm-dialog__button:disabled {
  opacity: 0.6;
}

.ui-confirm-dialog__loader {
  width: 1rem;
  height: 1rem;
  border: 2px solid currentcolor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: ui-confirm-dialog-spin 700ms linear infinite;
}

@keyframes ui-confirm-dialog-spin {
  to {
    transform: rotate(1turn);
  }
}

@media (max-width: 47.9375rem) {
  .ui-confirm-dialog__actions {
    grid-template-columns: 1fr;
  }
}
</style>
