<script setup lang="ts">
import { nextTick, useId, useTemplateRef } from 'vue';

defineOptions({ name: 'UiTabs' });

const props = defineProps<{
  tabs: ReadonlyArray<{ id: string; label: string }>;
  modelValue: string;
  label: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const baseId = useId();
const buttons = useTemplateRef<HTMLButtonElement[]>('buttons');

const tabId = (id: string) => `${baseId}-tab-${id}`;
const panelId = `${baseId}-panel`;

async function select(index: number) {
  const tab = props.tabs[index];
  if (!tab) return;
  emit('update:modelValue', tab.id);
  await nextTick();
  buttons.value?.[index]?.focus();
}

function onKeydown(event: KeyboardEvent) {
  const count = props.tabs.length;
  const current = Math.max(
    0,
    props.tabs.findIndex((tab) => tab.id === props.modelValue),
  );
  const next: Record<string, number> = {
    ArrowRight: (current + 1) % count,
    ArrowLeft: (current - 1 + count) % count,
    Home: 0,
    End: count - 1,
  };
  if (!(event.key in next)) return;
  event.preventDefault();
  void select(next[event.key]!);
}
</script>

<template>
  <div class="ui-tabs">
    <div class="ui-tabs__list" role="tablist" :aria-label="label" @keydown="onKeydown">
      <button
        v-for="(tab, index) in tabs"
        :id="tabId(tab.id)"
        ref="buttons"
        :key="tab.id"
        type="button"
        role="tab"
        class="ui-tabs__tab"
        :aria-selected="tab.id === modelValue ? 'true' : 'false'"
        :aria-controls="panelId"
        :tabindex="tab.id === modelValue ? 0 : -1"
        @click="select(index)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div
      :id="panelId"
      class="ui-tabs__panel"
      role="tabpanel"
      tabindex="0"
      :aria-labelledby="tabId(modelValue)"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ui-tabs {
  display: grid;
  gap: var(--hf-space-5);
}
.ui-tabs__list {
  display: flex;
  gap: var(--hf-space-1);
  overflow-x: auto;
  border-bottom: 1px solid var(--hf-color-border);
  scrollbar-width: thin;
}
.ui-tabs__tab {
  flex: 0 0 auto;
  min-height: var(--hf-control-height-sm);
  padding: 0 var(--hf-space-4);
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--hf-color-text-muted);
  font: inherit;
  font-weight: var(--hf-font-weight-medium);
  white-space: nowrap;
  cursor: pointer;
}
.ui-tabs__tab[aria-selected='true'] {
  border-bottom-color: var(--hf-color-action-primary);
  color: var(--hf-color-text);
}
.ui-tabs__tab:focus-visible,
.ui-tabs__panel:focus-visible {
  outline: 2px solid var(--hf-color-focus-ring);
  outline-offset: 2px;
}
</style>
