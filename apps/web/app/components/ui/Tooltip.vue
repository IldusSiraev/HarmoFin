<script setup lang="ts">
import { ref, useId } from 'vue';

defineOptions({ name: 'UiTooltip' });

const props = defineProps<{
  text?: string | undefined;
}>();

defineSlots<{
  default(props: { describedby?: string | undefined }): any;
}>();

const id = useId();
const open = ref(false);

function show() {
  if (props.text) open.value = true;
}

function hide() {
  open.value = false;
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false;
}

function getBubbleId() {
  return props.text ? `ui-tooltip-${id}` : undefined;
}
</script>

<template>
  <span
    v-if="text"
    class="ui-tooltip"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
    @keydown="handleKeydown"
  >
    <slot :describedby="getBubbleId()" />
    <span v-if="open" :id="getBubbleId()" role="tooltip" class="ui-tooltip__bubble">{{
      text
    }}</span>
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
  bottom: calc(100% + var(--hf-space-2));
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
</style>
