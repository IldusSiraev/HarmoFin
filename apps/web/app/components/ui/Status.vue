<script setup lang="ts">
defineOptions({ name: 'UiStatus' });

withDefaults(
  defineProps<{
    label: string;
    tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  }>(),
  {
    tone: 'neutral',
  },
);
</script>

<template>
  <span class="ui-status" :class="`ui-status--${tone}`">{{ label }}</span>
</template>

<style scoped>
.ui-status {
  display: inline-flex;
  align-items: center;
  min-height: 1.75rem;
  padding: var(--hf-space-1) var(--hf-space-2);
  border-radius: var(--hf-radius-sm);
  font-size: 0.875rem;
  font-weight: var(--hf-font-weight-medium);
  line-height: 1.25;
}

.ui-status--neutral {
  color: var(--hf-color-status-neutral);
  background: var(--hf-color-status-neutral-background);
}

.ui-status--info {
  color: var(--hf-color-status-info);
  background: var(--hf-color-status-info-background);
}

.ui-status--success {
  color: var(--hf-color-status-success);
  background: var(--hf-color-status-success-background);
}

.ui-status--warning {
  color: var(--hf-color-status-warning);
  background: var(--hf-color-status-warning-background);
}

.ui-status--danger {
  color: var(--hf-color-status-danger);
  background: var(--hf-color-status-danger-background);
}
</style>
