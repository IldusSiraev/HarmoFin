<script setup lang="ts">
import type { TransferDto } from '../../composables/useBudgetReferenceData.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiCard from '../ui/Card.vue';
import UiStatus from '../ui/Status.vue';

defineOptions({ name: 'TransferCard' });

defineProps<{ transfer: TransferDto }>();

function statusLabel(status: TransferDto['status']) {
  return {
    DRAFT: 'Черновик',
    CONFIRMED: 'Подтверждён',
    CANCELLED: 'Отменён',
    DELETED: 'Удалён',
  }[status];
}

function statusTone(status: TransferDto['status']) {
  return { DRAFT: 'neutral', CONFIRMED: 'success', CANCELLED: 'warning', DELETED: 'danger' }[
    status
  ] as 'neutral' | 'success' | 'warning' | 'danger';
}
</script>

<template>
  <UiCard as="article" class="transfer-card">
    <template #header>
      <div class="transfer-card__header">
        <div>
          <p>Перевод</p>
          <h2>{{ transfer.occurredOn }}</h2>
        </div>
        <UiStatus :label="statusLabel(transfer.status)" :tone="statusTone(transfer.status)" />
      </div>
    </template>
    <FinanceMoney
      :minor-units="transfer.totalMinor"
      :currency="transfer.currency"
      :scale="transfer.scale"
    />
    <p v-if="transfer.comment" class="transfer-card__comment">{{ transfer.comment }}</p>
    <p class="transfer-card__parts">Частей: {{ transfer.parts.length }}</p>
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </UiCard>
</template>

<style scoped>
.transfer-card__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--hf-space-4);
}
.transfer-card__header p,
.transfer-card__header h2,
.transfer-card__comment,
.transfer-card__parts {
  margin: 0;
}
.transfer-card__header p,
.transfer-card__comment,
.transfer-card__parts {
  color: var(--hf-color-text-muted);
}
.transfer-card__header h2 {
  margin-top: var(--hf-space-1);
  font-size: 1rem;
}
.transfer-card :deep(.finance-money) {
  font-size: 1.25rem;
  font-weight: var(--hf-font-weight-semibold);
}
.transfer-card__comment {
  margin-top: var(--hf-space-3);
}
.transfer-card__parts {
  margin-top: var(--hf-space-2);
  font-size: 0.875rem;
}
</style>
