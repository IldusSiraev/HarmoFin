<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type WatchStopHandle } from 'vue';
import { X } from '@lucide/vue';

defineOptions({ name: 'UiDrawer' });

const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>();

const panel = ref<HTMLElement | null>(null);
const titleId = `ui-drawer-title-${Math.random().toString(36).slice(2)}`;
let previouslyFocused: HTMLElement | null = null;
let stopWatch: WatchStopHandle | undefined;

function focusable(): HTMLElement[] {
  if (!panel.value) return [];
  return [
    ...panel.value.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => !element.hasAttribute('disabled'));
}

function handleKeydown(event: KeyboardEvent): void {
  if (!props.open) return;
  if (event.key === 'Escape') {
    // A native <dialog> stacked on top (e.g. a confirm dialog) owns Escape
    // while it's open; closing the drawer underneath it too would drop
    // whatever the dialog was confirming or cancelling out from under it.
    if (document.querySelector('dialog[open]')) return;
    emit('close');
    return;
  }
  if (event.key !== 'Tab') return;

  const items = focusable();
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) return;

  const active = document.activeElement;
  if (event.shiftKey && (active === first || !panel.value?.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function syncState(open: boolean): void {
  if (open) {
    previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeydown);
    void nextTick(() => focusable()[0]?.focus());
  } else {
    document.body.style.overflow = '';
    document.removeEventListener('keydown', handleKeydown);
    previouslyFocused?.focus();
    previouslyFocused = null;
  }
}

// syncState touches `document`, which does not exist during SSR. Setting up
// the watcher inside onMounted (client-only) — rather than an immediate
// watcher evaluated during setup() — keeps this drawer safe to mount
// unconditionally, matching the pattern in ConfirmDialog.vue.
onMounted(() => {
  stopWatch = watch(() => props.open, syncState, { immediate: true });
});

onBeforeUnmount(() => {
  stopWatch?.();
  document.body.style.overflow = '';
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div v-if="open" class="ui-drawer-root">
    <div class="ui-drawer__backdrop" data-testid="drawer-backdrop" @click="emit('close')" />
    <section
      ref="panel"
      class="ui-drawer"
      data-testid="drawer"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
    >
      <header class="ui-drawer__header">
        <h2 :id="titleId" class="ui-drawer__title">{{ title }}</h2>
        <button
          type="button"
          class="ui-drawer__close"
          data-testid="drawer-close"
          aria-label="Закрыть панель"
          @click="emit('close')"
        >
          <X :size="20" aria-hidden="true" />
        </button>
      </header>

      <div class="ui-drawer__body"><slot /></div>

      <footer v-if="$slots.footer" class="ui-drawer__footer"><slot name="footer" /></footer>
    </section>
  </div>
</template>

<style scoped>
.ui-drawer-root {
  position: fixed;
  inset: 0;
  z-index: 200;
}

.ui-drawer__backdrop {
  position: absolute;
  inset: 0;
  background: var(--hf-color-overlay);
}

.ui-drawer {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  border-top-left-radius: var(--hf-radius-lg);
  border-top-right-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-lg);
}

.ui-drawer__header {
  display: flex;
  gap: var(--hf-space-3);
  align-items: center;
  justify-content: space-between;
  padding: var(--hf-space-4) var(--hf-space-5);
  border-bottom: 1px solid var(--hf-color-border);
}

.ui-drawer__title {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}

.ui-drawer__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 0;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text-muted);
  cursor: pointer;
}

.ui-drawer__close:hover {
  background: var(--hf-color-action-secondary-hover);
  color: var(--hf-color-text);
}

.ui-drawer__close:focus-visible,
.ui-drawer:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: -2px;
}

.ui-drawer__body {
  overflow-y: auto;
  padding: var(--hf-space-5);
}

.ui-drawer__footer {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  padding: var(--hf-space-4) var(--hf-space-5);
  border-top: 1px solid var(--hf-color-border);
}

@media (min-width: 768px) {
  .ui-drawer {
    top: 0;
    left: auto;
    width: min(28rem, 100vw);
    max-height: none;
    border-radius: 0;
  }
}
</style>
