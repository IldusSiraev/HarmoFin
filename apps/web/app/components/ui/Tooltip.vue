<script setup lang="ts">
import { onBeforeUnmount, ref, useId, watch } from 'vue';

defineOptions({ name: 'UiTooltip' });

const props = withDefaults(
  defineProps<{
    text?: string | undefined;
    placement?: 'top' | 'bottom';
    /** `start` keeps the bubble inside the left edge of its container. */
    align?: 'center' | 'start';
    /** A click or tap opens the bubble (touch has no hover and may not focus). */
    pinnable?: boolean;
  }>(),
  { text: undefined, placement: 'top', align: 'center', pinnable: false },
);

defineSlots<{
  default(props: { describedby?: string | undefined }): void;
}>();

const id = useId();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

function show() {
  if (props.text) open.value = true;
}

function hide() {
  open.value = false;
}

// Escape closes an open bubble wherever focus is (it may be open by hover only).
// Captured on the document and marked as handled (preventDefault) so that a
// surrounding modal ignores this Escape; several open bubbles all close.
function handleEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !open.value) return;
  open.value = false;
  event.preventDefault();
}

function handleClick() {
  if (props.pinnable) show();
}

function handleOutsidePointer(event: Event) {
  if (!root.value?.contains(event.target as Node)) open.value = false;
}

function detach() {
  document.removeEventListener('pointerdown', handleOutsidePointer);
  document.removeEventListener('keydown', handleEscape, true);
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('keydown', handleEscape, true);
  } else detach();
});

onBeforeUnmount(detach);

function getBubbleId() {
  return props.text ? `ui-tooltip-${id}` : undefined;
}
</script>

<template>
  <span
    v-if="text"
    ref="root"
    class="ui-tooltip"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
    @click="handleClick"
  >
    <slot :describedby="getBubbleId()" />
    <span
      v-if="open"
      :id="getBubbleId()"
      role="tooltip"
      class="ui-tooltip__bubble"
      :class="[`ui-tooltip__bubble--${placement}`, `ui-tooltip__bubble--align-${align}`]"
      >{{ text }}</span
    >
  </span>
  <slot v-else />
</template>

<style scoped>
.ui-tooltip {
  position: relative;
  display: inline-flex;
}

.ui-tooltip--full-width {
  width: 100%;
}

.ui-tooltip__bubble {
  position: absolute;
  left: 50%;
  z-index: var(--hf-z-index-tooltip);
  width: max-content;
  max-width: 16rem;
  padding: var(--hf-space-2) var(--hf-space-3);
  color: var(--hf-tooltip-color);
  border-radius: var(--hf-radius-sm);
  background: var(--hf-tooltip-background);
  font-size: 0.8125rem;
  font-weight: var(--hf-font-weight-regular);
  line-height: 1.4;
  transform: translateX(-50%);
  pointer-events: none;
}

.ui-tooltip__bubble--align-start {
  left: 0;
  max-width: min(16rem, 70vw);
  transform: none;
}

.ui-tooltip__bubble--top {
  bottom: calc(100% + var(--hf-space-2));
}

.ui-tooltip__bubble--bottom {
  top: calc(100% + var(--hf-space-2));
}
</style>
