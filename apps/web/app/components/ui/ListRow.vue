<script setup lang="ts">
defineOptions({ name: 'UiListRow' });

defineProps<{ label: string }>();
defineEmits<{ select: [] }>();
</script>

<template>
  <div class="ui-list-row">
    <button
      type="button"
      class="ui-list-row__select"
      data-testid="list-row-select"
      :aria-label="label"
      @click="$emit('select')"
    >
      <span v-if="$slots.leading" class="ui-list-row__leading"><slot name="leading" /></span>
      <span class="ui-list-row__body"><slot /></span>
      <span v-if="$slots.trailing" class="ui-list-row__trailing"><slot name="trailing" /></span>
    </button>

    <div v-if="$slots.actions" class="ui-list-row__actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.ui-list-row {
  display: flex;
  gap: var(--hf-space-2);
  align-items: center;
  border-radius: var(--hf-radius-md);
}

.ui-list-row:hover {
  background: var(--hf-color-surface-subtle);
}

.ui-list-row__select {
  display: flex;
  flex: 1;
  gap: var(--hf-space-3);
  align-items: center;
  min-width: 0;
  min-height: 2.75rem;
  padding: var(--hf-space-2) var(--hf-space-3);
  border: 0;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.ui-list-row__select:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: -2px;
}

.ui-list-row__leading {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text-muted);
}

.ui-list-row__body {
  display: grid;
  flex: 1;
  gap: 0.125rem;
  min-width: 0;
}

.ui-list-row__trailing {
  display: grid;
  gap: 0.125rem;
  justify-items: end;
  text-align: right;
  white-space: nowrap;
}

.ui-list-row__actions {
  flex-shrink: 0;
}
</style>
