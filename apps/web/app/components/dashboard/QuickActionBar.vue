<script setup lang="ts">
defineOptions({ name: 'DashboardQuickActionBar' });
defineEmits<{
  addOperation: [];
  addTransfer: [];
  refresh: [];
}>();
</script>

<template>
  <div class="quick-actions">
    <button type="button" class="quick-actions__button quick-actions__button--primary" @click="$emit('addOperation')">
      + Операция
    </button>
    <button type="button" class="quick-actions__button quick-actions__button--secondary" @click="$emit('addTransfer')">
      + Перевод
    </button>
    <button type="button" class="quick-actions__button quick-actions__button--tertiary" @click="$emit('refresh')">
      Обновить
    </button>
  </div>
</template>

<style scoped>
.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
  margin-bottom: var(--hf-space-6);
}

.quick-actions__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: var(--hf-space-3) var(--hf-space-5);
  color: var(--hf-color-text);
  border: 2px solid transparent;
  border-radius: var(--hf-control-radius);
  background: transparent;
  font: inherit;
  font-weight: var(--hf-font-weight-semibold);
  cursor: pointer;
  transition: all var(--hf-transition-fast);
}

.quick-actions__button--primary {
  color: white;
  border-color: var(--hf-color-action-primary);
  background: var(--hf-color-action-primary);
}

.quick-actions__button--primary:hover {
  background: var(--hf-color-action-primary-hover);
  border-color: var(--hf-color-action-primary-hover);
}

.quick-actions__button--primary:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.quick-actions__button--secondary {
  color: var(--hf-color-action-primary);
  border-color: var(--hf-color-action-primary);
}

.quick-actions__button--secondary:hover {
  background: var(--hf-color-action-primary);
  color: white;
}

.quick-actions__button--secondary:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.quick-actions__button--tertiary {
  color: var(--hf-color-text);
  border-color: var(--hf-color-border-strong);
}

.quick-actions__button--tertiary:hover {
  background: var(--hf-color-action-secondary-hover);
}

.quick-actions__button--tertiary:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}
</style>
