<script setup lang="ts">
defineOptions({ name: 'OperationGroup' });

defineProps<{ label: string }>();
</script>

<template>
  <section class="operation-group">
    <h3 v-if="label" class="operation-group__label" data-testid="operation-group-label">
      {{ label }}
    </h3>
    <ul
      class="operation-group__list"
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

.operation-group__list {
  display: grid;
  gap: var(--hf-space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
