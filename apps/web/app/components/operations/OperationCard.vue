<script setup lang="ts">
import type { TransactionDto } from '../../composables/useBudgetReferenceData.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiCard from '../ui/Card.vue';
import UiStatus from '../ui/Status.vue';

defineOptions({ name: 'OperationCard' });

defineProps<{ transaction: TransactionDto }>();

function typeLabel(type: TransactionDto['transactionType']) {
  return type === 'INCOME' ? 'Доход' : 'Расход';
}

function statusLabel(status: TransactionDto['status']) {
  return {
    DRAFT: 'Черновик',
    CONFIRMED: 'Подтверждена',
    CANCELLED: 'Отменена',
    DELETED: 'Удалена',
  }[status];
}

function statusTone(status: TransactionDto['status']) {
  return { DRAFT: 'neutral', CONFIRMED: 'success', CANCELLED: 'warning', DELETED: 'danger' }[
    status
  ] as 'neutral' | 'success' | 'warning' | 'danger';
}
</script>

<template>
  <UiCard as="article" class="operation-card">
    <template #header>
      <div class="operation-card__header">
        <div>
          <p class="operation-card__type">{{ typeLabel(transaction.transactionType) }}</p>
          <h2 class="operation-card__date">{{ transaction.occurredOn }}</h2>
        </div>
        <UiStatus :label="statusLabel(transaction.status)" :tone="statusTone(transaction.status)" />
      </div>
    </template>
    <div class="operation-card__body">
      <FinanceMoney
        :minor-units="transaction.amountMinor"
        :currency="transaction.currency"
        :scale="transaction.scale"
      />
      <p
        v-if="transaction.merchantName || transaction.sourceDescription"
        class="operation-card__detail"
      >
        {{ transaction.merchantName ?? transaction.sourceDescription }}
      </p>
      <p v-if="transaction.isPlanned" class="operation-card__planned">Запланирована</p>
    </div>
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </UiCard>
</template>

<style scoped>
.operation-card__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--hf-space-4);
}
.operation-card__type,
.operation-card__date,
.operation-card__detail,
.operation-card__planned {
  margin: 0;
}
.operation-card__type,
.operation-card__detail,
.operation-card__planned {
  color: var(--hf-color-text-muted);
}
.operation-card__type,
.operation-card__planned {
  font-size: 0.875rem;
}
.operation-card__date {
  margin-top: var(--hf-space-1);
  font-size: 1rem;
  font-weight: var(--hf-font-weight-semibold);
}
.operation-card__body {
  display: grid;
  gap: var(--hf-space-2);
}
.operation-card__body :deep(.finance-money) {
  font-size: 1.25rem;
  font-weight: var(--hf-font-weight-semibold);
}
</style>
