<script setup lang="ts">
import { ArrowDown, ArrowLeftRight, ArrowUp } from '@lucide/vue';

import UiModal from '../ui/Modal.vue';

defineOptions({ name: 'AppOperationTypeDialog' });

defineProps<{ open: boolean }>();

const emit = defineEmits<{
  close: [];
  select: [type: 'EXPENSE' | 'INCOME' | 'TRANSFER'];
}>();

const cards = [
  {
    type: 'EXPENSE' as const,
    label: 'Расход',
    icon: ArrowDown,
    modifier: 'operation-type-dialog__card--expense',
    testId: 'operation-type-expense',
  },
  {
    type: 'INCOME' as const,
    label: 'Доход',
    icon: ArrowUp,
    modifier: 'operation-type-dialog__card--income',
    testId: 'operation-type-income',
  },
  {
    type: 'TRANSFER' as const,
    label: 'Перевод',
    icon: ArrowLeftRight,
    modifier: 'operation-type-dialog__card--transfer',
    testId: 'operation-type-transfer',
  },
];
</script>

<template>
  <UiModal :open="open" title="Что произошло?" @close="emit('close')">
    <p class="operation-type-dialog__subtitle">Выберите тип операции</p>
    <div class="operation-type-dialog__grid">
      <button
        v-for="card in cards"
        :key="card.type"
        type="button"
        class="operation-type-dialog__card"
        :class="card.modifier"
        :data-testid="card.testId"
        @click="emit('select', card.type)"
      >
        <span class="operation-type-dialog__icon">
          <component :is="card.icon" :size="24" aria-hidden="true" />
        </span>
        <span class="operation-type-dialog__label">{{ card.label }}</span>
      </button>
    </div>
  </UiModal>
</template>

<style scoped>
.operation-type-dialog__subtitle {
  margin: 0 0 var(--hf-space-5);
  color: var(--hf-color-text-muted);
  text-align: center;
}

.operation-type-dialog__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--hf-space-3);
}

@media (max-width: 30rem) {
  .operation-type-dialog__grid {
    grid-template-columns: 1fr;
  }
}

.operation-type-dialog__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--hf-space-3);
  padding: var(--hf-space-5) var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
  font-weight: var(--hf-font-weight-medium);
  cursor: pointer;
  transition:
    border-color var(--hf-transition-fast),
    transform var(--hf-transition-fast);
}

.operation-type-dialog__card:hover {
  transform: translateY(-2px);
}

.operation-type-dialog__card:focus-visible {
  outline: 2px solid currentcolor;
  outline-offset: 2px;
}

.operation-type-dialog__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 50%;
}

.operation-type-dialog__card--expense .operation-type-dialog__icon {
  color: var(--hf-color-status-danger);
  background: var(--hf-color-status-danger-background);
}

.operation-type-dialog__card--expense:hover,
.operation-type-dialog__card--expense:focus-visible {
  border-color: var(--hf-color-status-danger);
}

.operation-type-dialog__card--income .operation-type-dialog__icon {
  color: var(--hf-color-status-success);
  background: var(--hf-color-status-success-background);
}

.operation-type-dialog__card--income:hover,
.operation-type-dialog__card--income:focus-visible {
  border-color: var(--hf-color-status-success);
}

.operation-type-dialog__card--transfer .operation-type-dialog__icon {
  color: var(--hf-color-status-info);
  background: var(--hf-color-status-info-background);
}

.operation-type-dialog__card--transfer:hover,
.operation-type-dialog__card--transfer:focus-visible {
  border-color: var(--hf-color-status-info);
}
</style>
