<script setup lang="ts">
import { computed } from 'vue';
import { CircleAlert, CircleCheck, Info, X } from '@lucide/vue';

import type { ToastItem } from '../../composables/useToast.js';

defineOptions({ name: 'UiToast' });

const props = defineProps<{ toast: ToastItem }>();
defineEmits<{ dismiss: [id: string]; hold: [id: string]; release: [id: string] }>();

const toneLabel = computed(() => {
  if (props.toast.tone === 'success') return 'Готово';
  if (props.toast.tone === 'error') return 'Ошибка';
  return 'Информация';
});

const toneIcon = computed(() => {
  if (props.toast.tone === 'success') return CircleCheck;
  if (props.toast.tone === 'error') return CircleAlert;
  return Info;
});
</script>

<template>
  <article
    class="ui-toast"
    :class="`ui-toast--${toast.tone}`"
    data-testid="toast"
    @mouseenter="$emit('hold', toast.id)"
    @mouseleave="$emit('release', toast.id)"
    @focusin="$emit('hold', toast.id)"
    @focusout="$emit('release', toast.id)"
  >
    <component :is="toneIcon" class="ui-toast__icon" :size="20" aria-hidden="true" />
    <div class="ui-toast__body">
      <p class="ui-toast__tone">{{ toneLabel }}</p>
      <p class="ui-toast__title">{{ toast.title }}</p>
      <p v-if="toast.description" class="ui-toast__description">{{ toast.description }}</p>
    </div>
    <button
      type="button"
      class="ui-toast__dismiss"
      data-testid="toast-dismiss"
      aria-label="Закрыть уведомление"
      @click="$emit('dismiss', toast.id)"
    >
      <X :size="16" aria-hidden="true" />
    </button>
  </article>
</template>

<style scoped>
.ui-toast {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--hf-space-3);
  align-items: start;
  width: min(24rem, 100%);
  padding: var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-md);
}

.ui-toast--success .ui-toast__icon {
  color: var(--hf-color-brand);
}

.ui-toast--error .ui-toast__icon {
  color: var(--hf-color-action-danger);
}

.ui-toast--info .ui-toast__icon {
  color: var(--hf-color-action-primary);
}

.ui-toast__body {
  display: grid;
  gap: var(--hf-space-1);
}

.ui-toast__tone {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.ui-toast__title {
  margin: 0;
  font-weight: var(--hf-font-weight-semibold);
}

.ui-toast__description {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}

.ui-toast__dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  margin: calc(var(--hf-space-2) * -1);
  border: 0;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text-muted);
}

.ui-toast__dismiss:hover {
  background: var(--hf-color-action-secondary-hover);
  color: var(--hf-color-text);
}
</style>
