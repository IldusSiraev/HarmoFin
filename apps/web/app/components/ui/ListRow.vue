<script setup lang="ts">
import { computed } from 'vue';

defineOptions({ name: 'UiListRow' });

const props = withDefaults(
  defineProps<{
    label: string;
    /** Hue of the leading tile; neutral when not set. */
    leadingTone?: 'income' | 'expense' | 'transfer' | undefined;
  }>(),
  { leadingTone: undefined },
);

const leadingClass = computed(() => [
  'ui-list-row__leading',
  props.leadingTone && `ui-list-row__leading--${props.leadingTone}`,
]);
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
      <span v-if="$slots.leading" :class="leadingClass"><slot name="leading" /></span>
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
  min-width: 0;
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
  overflow: hidden;
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

.ui-list-row__leading--income {
  background: var(--hf-color-operation-income-soft);
  color: var(--hf-color-operation-income);
}

.ui-list-row__leading--expense {
  background: var(--hf-color-operation-expense-soft);
  color: var(--hf-color-operation-expense);
}

.ui-list-row__leading--transfer {
  background: var(--hf-color-operation-transfer-soft);
  color: var(--hf-color-operation-transfer);
}

.ui-list-row__body {
  display: grid;
  flex: 1;
  gap: 0.125rem;
  min-width: 0;
  overflow: hidden;
}

/* Grid children default to min-width: auto and would otherwise spill over the
   trailing column instead of truncating. */
.ui-list-row__body > * {
  min-width: 0;
}

/* No nowrap here: a long trailing line would then set the row's minimum width
   and push the whole page into horizontal scrolling on a phone. */
.ui-list-row__trailing {
  display: grid;
  gap: 0.125rem;
  justify-items: end;
  min-width: 0;
  text-align: right;
}

.ui-list-row__actions {
  flex-shrink: 0;
}

/* On a phone three text columns leave nothing readable, so the trailing block
   moves under the body instead of competing with it for width. */
@media (max-width: 599px) {
  .ui-list-row__select {
    display: grid;
    grid-template-areas:
      'leading body'
      'leading trailing';
    grid-template-columns: auto minmax(0, 1fr);
    row-gap: 0.125rem;
  }

  .ui-list-row__leading {
    grid-area: leading;
    align-self: start;
  }

  .ui-list-row__body {
    grid-area: body;
  }

  .ui-list-row__trailing {
    grid-area: trailing;
  }
}
</style>
