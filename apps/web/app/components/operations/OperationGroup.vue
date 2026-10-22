<script setup lang="ts">
defineOptions({ name: 'OperationGroup' });

withDefaults(defineProps<{ label: string; flat?: boolean }>(), { flat: false });
</script>

<template>
  <section class="operation-group">
    <h3 v-if="label" class="operation-group__label" data-testid="operation-group-label">
      {{ label }}
    </h3>
    <ul
      class="operation-group__list"
      :class="{ 'operation-group__list--flat': flat }"
      :aria-label="label ? `Операции за ${label}` : 'Список операций'"
    >
      <slot />
    </ul>
  </section>
</template>

<style scoped>
.operation-group {
  display: grid;
  gap: var(--hf-space-2);
  min-width: 0;
}

.operation-group__label {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  font-weight: var(--hf-font-weight-semibold);
  line-height: var(--hf-line-height-caption);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* The list is a surface on the page background: without it the rows read as
   loose text floating on grey. */
.operation-group__list {
  display: grid;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-xs);
  list-style: none;
}

/* The rows come in through the slot, so they carry the parent's scope id and
   need ::v-slotted to be reachable from here. */
.operation-group__list > ::v-slotted(li) {
  min-width: 0;
}

.operation-group__list > ::v-slotted(li + li) {
  border-top: 1px solid var(--hf-color-border);
}

/* Nested inside another card (e.g. the dashboard's RecentOperations), the list
   does not need its own border/surface/shadow: the row dividers stay. */
.operation-group__list--flat {
  border: 0;
  background: transparent;
  box-shadow: none;
}
</style>
