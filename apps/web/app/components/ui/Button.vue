<script setup lang="ts">
import { NuxtLink } from '#components';

import UiTooltip from './Tooltip.vue';

defineOptions({ name: 'UiButton', inheritAttrs: false });

withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'brand';
    size?: 'sm' | 'md' | 'lg';
    type?: 'button' | 'submit' | 'reset';
    loading?: boolean;
    disabled?: boolean;
    fullWidth?: boolean;
    ariaLabel?: string | undefined;
    tooltip?: string | undefined;
    tooltipPlacement?: 'top' | 'bottom';
    to?: string | undefined;
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
    tooltipPlacement: 'top',
    to: undefined,
  },
);

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

function handleClick(event: MouseEvent, loading: boolean, disabled: boolean) {
  if (!loading && !disabled) {
    emit('click', event);
  }
}
</script>

<template>
  <UiTooltip
    v-slot="{ describedby }"
    :text="tooltip"
    :placement="tooltipPlacement"
    :class="tooltip ? { 'ui-tooltip--full-width': fullWidth } : {}"
  >
    <component
      :is="to ? NuxtLink : 'button'"
      v-bind="$attrs"
      class="ui-button"
      :class="[
        `ui-button--${variant}`,
        `ui-button--${size}`,
        { 'ui-button--full-width': fullWidth },
      ]"
      :to="to"
      :type="to ? undefined : type"
      :disabled="to ? undefined : disabled || loading"
      :aria-busy="loading || undefined"
      :aria-label="ariaLabel"
      :aria-describedby="
        [describedby, $attrs['aria-describedby'] as string | undefined].filter(Boolean).join(' ') ||
        undefined
      "
      @click="handleClick($event, loading, disabled)"
    >
      <span v-if="loading" class="ui-button__loader" aria-hidden="true" />
      <span class="ui-button__content"><slot /></span>
    </component>
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
  text-decoration: none;
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

.ui-button--brand {
  color: var(--hf-color-white);
  border: 1px solid var(--hf-color-action-brand);
  background: var(--hf-color-action-brand);
}

.ui-button--brand:hover:not(:disabled) {
  border-color: var(--hf-color-action-brand-hover);
  background: var(--hf-color-action-brand-hover);
}

.ui-button--brand:active:not(:disabled) {
  border-color: var(--hf-color-action-brand-active);
  background: var(--hf-color-action-brand-active);
}

.ui-button:disabled {
  opacity: 0.6;
}

/* An icon next to the text sits on the text's centre line, not its baseline. */
.ui-button__content {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-2);
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
