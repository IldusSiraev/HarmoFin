<script setup lang="ts">
import { ref } from 'vue';
import UiTooltip from './Tooltip.vue';

defineOptions({ name: 'UiButton' });

withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'tertiary' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    type?: 'button' | 'submit' | 'reset';
    loading?: boolean;
    disabled?: boolean;
    fullWidth?: boolean;
    ariaLabel?: string | undefined;
    tooltip?: string | undefined;
  }>(),
  {
    variant: 'primary',
    size: 'md',
    type: 'button',
    loading: false,
    disabled: false,
    fullWidth: false,
    ariaLabel: undefined,
    tooltip: undefined,
  },
);

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const tooltipComponent = ref<typeof UiTooltip>();

function handleClick(event: MouseEvent, loading: boolean, disabled: boolean) {
  if (!loading && !disabled) {
    emit('click', event);
  }
}

function handleButtonFocus() {
  // Manually dispatch focusin on the tooltip wrapper to ensure event propagation works in tests
  if (tooltipComponent.value?.$el) {
    tooltipComponent.value.$el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  }
}
</script>

<template>
  <UiTooltip ref="tooltipComponent" :text="tooltip" v-slot="{ describedby }">
    <button
      class="ui-button"
      :class="[`ui-button--${variant}`, `ui-button--${size}`, { 'ui-button--full-width': fullWidth }]"
      :type="type"
      :disabled="disabled || loading"
      :aria-busy="loading || undefined"
      :aria-label="ariaLabel"
      :aria-describedby="describedby"
      @click="handleClick($event, loading, disabled)"
      @focus="handleButtonFocus"
    >
      <span v-if="loading" class="ui-button__loader" aria-hidden="true" />
      <span class="ui-button__content"><slot /></span>
    </button>
  </UiTooltip>
</template>

<style scoped>
.ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--hf-space-2);
  min-width: 2.75rem;
  min-height: var(--hf-control-height-md);
  padding: 0 var(--hf-button-padding-inline);
  border: 1px solid transparent;
  border-radius: var(--hf-button-radius);
  font-weight: var(--hf-button-font-weight);
  line-height: 1.25;
  transition:
    background-color 150ms ease,
    border-color 150ms ease,
    color 150ms ease;
}

.ui-button--sm {
  min-height: var(--hf-control-height-sm);
  padding-inline: var(--hf-space-4);
}

.ui-button--lg {
  min-height: var(--hf-control-height-lg);
  padding-inline: var(--hf-space-6);
}

.ui-button--full-width {
  width: 100%;
}

.ui-button--primary {
  color: var(--hf-color-white);
  background: var(--hf-color-action-primary);
}

.ui-button--primary:hover:not(:disabled) {
  background: var(--hf-color-action-primary-hover);
}

.ui-button--primary:active:not(:disabled) {
  background: var(--hf-color-action-primary-active);
}

.ui-button--secondary {
  color: var(--hf-color-text);
  border-color: var(--hf-color-border-strong);
  background: var(--hf-color-surface);
}

.ui-button--secondary:hover:not(:disabled),
.ui-button--tertiary:hover:not(:disabled) {
  background: var(--hf-color-action-secondary-hover);
}

.ui-button--tertiary {
  color: var(--hf-color-action-primary-hover);
  background: transparent;
}

.ui-button--danger {
  color: var(--hf-color-white);
  background: var(--hf-color-action-danger);
}

.ui-button--danger:hover:not(:disabled) {
  background: var(--hf-color-action-danger-hover);
}

.ui-button:disabled {
  opacity: 0.6;
}

.ui-button__loader {
  width: 1rem;
  height: 1rem;
  border: 2px solid currentcolor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: ui-button-spin 700ms linear infinite;
}

@keyframes ui-button-spin {
  to {
    transform: rotate(1turn);
  }
}
</style>
