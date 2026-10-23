<script lang="ts">
// Open modals, last one on top: only the top modal reacts to the keyboard and
// the page scroll lock is released when the last one closes.
const openModals: symbol[] = [];
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

defineOptions({ name: 'UiModal' });

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    // `sm` suits compact detail dialogs (operation, account, envelope);
    // `md` suits forms.
    size?: 'sm' | 'md' | 'lg';
    /** Short line under the title, inside the header. */
    subtitle?: string | undefined;
    /**
     * The body is a flex column that fills the dialog; the slot decides which
     * part scrolls (for example a long list under a pinned summary).
     */
    fill?: boolean;
  }>(),
  { size: 'md', subtitle: undefined, fill: false },
);

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

const dialog = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

function focusable(): HTMLElement[] {
  if (!dialog.value) return [];
  return [
    ...dialog.value.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => !element.hasAttribute('disabled'));
}

const self = Symbol('modal');

function ownsKeyboard(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return false;
  if (openModals[openModals.length - 1] !== self) return false;
  // A native dialog (e.g. a confirmation) stacked on top owns the keys.
  return document.querySelector('dialog[open]') === null;
}

function handleKeydown(event: KeyboardEvent) {
  if (!ownsKeyboard(event)) return;
  if (event.key === 'Escape') {
    handleClose();
    return;
  }
  if (event.key !== 'Tab') return;
  const items = focusable();
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) {
    event.preventDefault();
    dialog.value?.focus();
    return;
  }
  const active = document.activeElement;
  const inside = dialog.value?.contains(active) ?? false;
  if (event.shiftKey && (active === first || active === dialog.value || !inside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !inside)) {
    event.preventDefault();
    first.focus();
  }
}

function release() {
  const index = openModals.indexOf(self);
  if (index !== -1) openModals.splice(index, 1);
  document.removeEventListener('keydown', handleKeydown);
  if (openModals.length === 0) document.body.style.overflow = '';
}

function syncModalState(isOpen: boolean) {
  if (isOpen) {
    previouslyFocused = document.activeElement as HTMLElement | null;
    if (!openModals.includes(self)) openModals.push(self);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeydown);
    // Focus lands on the dialog itself so a long body is not skipped over.
    void nextTick(() => dialog.value?.focus());
  } else {
    release();
    if (previouslyFocused?.isConnected) previouslyFocused.focus();
    previouslyFocused = null;
  }
}

onMounted(() => {
  syncModalState(props.open);
});

watch(() => props.open, syncModalState);

onBeforeUnmount(release);
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-backdrop" @click="handleBackdropClick">
        <div
          ref="dialog"
          class="modal"
          :class="{ 'modal--sm': size === 'sm', 'modal--lg': size === 'lg', 'modal--fill': fill }"
          data-testid="modal"
          role="dialog"
          :aria-label="title"
          aria-modal="true"
          tabindex="-1"
        >
          <div class="modal__header">
            <slot name="header">
              <div class="modal__heading">
                <h2 class="modal__title">{{ title }}</h2>
                <p v-if="subtitle" class="modal__subtitle">{{ subtitle }}</p>
              </div>
              <button
                type="button"
                class="modal__close"
                data-testid="modal-close"
                aria-label="Закрыть"
                @click="handleClose"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M18 6L6 18M6 6l12 12"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  />
                </svg>
              </button>
            </slot>
          </div>
          <div class="modal__content hf-scroll" :class="{ 'modal__content--fill': fill }">
            <slot />
          </div>
          <div v-if="$slots['footer']" class="modal__footer"><slot name="footer" /></div>
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
  display: flex;
  flex-direction: column;
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow:
    0 20px 25px -5px rgb(0 0 0 / 20%),
    0 10px 10px -5px rgb(0 0 0 / 10%);
  overflow: hidden;
}

.modal--sm {
  max-width: 30rem;
}

.modal--lg {
  max-width: 52rem;
}

.modal--lg .modal__footer {
  justify-content: flex-start;
}

/* Detail dialogs list several peer actions, primary first; keep them in
   reading order instead of pushing a wrapped row to the right. */
.modal--sm .modal__footer {
  justify-content: flex-start;
}

/* A filled dialog grows to the viewport minus the backdrop padding, so a list
   that nearly fits does not scroll by a few pixels. */
.modal--fill {
  max-height: calc(100vh - 2 * var(--hf-space-4));
  max-height: calc(100dvh - 2 * var(--hf-space-4));
}

@media (max-width: 767px) {
  .modal,
  .modal--sm,
  .modal--lg {
    max-width: none;
    height: 100vh;
    height: 100dvh;
    max-height: 100vh;
    max-height: 100dvh;
    border-radius: 0;
  }

  .modal-backdrop {
    padding: 0;
  }

  .modal .modal__footer {
    padding-bottom: max(var(--hf-space-3), env(safe-area-inset-bottom));
  }
}

.modal:focus {
  outline: none;
}

.modal__header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-4);
  padding: var(--hf-space-5) var(--hf-space-6);
  border-bottom: 1px solid var(--hf-color-border);
}

.modal__heading {
  display: grid;
  gap: 0.125rem;
  min-width: 0;
}

.modal__title {
  margin: 0;
  color: var(--hf-color-text);
  font-size: 1.25rem;
  font-weight: 600;
}

.modal__subtitle {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
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
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

/* The slot fills the body; the body still scrolls as a fallback when the
   pinned part alone is taller than the dialog. */
.modal__content--fill {
  display: flex;
  flex-direction: column;
}

.modal__content--fill > * {
  flex: 1 1 auto;
  min-height: 0;
}

.modal__footer {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--hf-space-2);
  padding: var(--hf-space-3) var(--hf-space-6);
  border-top: 1px solid var(--hf-color-border);
  background: var(--hf-color-surface);
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
