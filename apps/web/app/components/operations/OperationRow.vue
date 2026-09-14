<script setup lang="ts">
import { computed } from 'vue';

import { categoryIcon } from './category-icon.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiListRow from '../ui/ListRow.vue';
import UiStatus from '../ui/Status.vue';
import type { TransactionDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'OperationRow' });

const props = defineProps<{
  transaction: TransactionDto;
  categoryName: string;
  categoryTemplateKey: string | null;
  accountName: string;
  envelopeName: string | null;
}>();

defineEmits<{ select: [] }>();

const icon = computed(() =>
  categoryIcon(props.categoryTemplateKey, props.transaction.transactionType),
);

const isIncome = computed(() => props.transaction.transactionType === 'INCOME');

const counterparty = computed(
  () => props.transaction.merchantName ?? props.transaction.sourceDescription ?? '',
);

const signedMinor = computed(() =>
  isIncome.value ? props.transaction.amountMinor : `-${props.transaction.amountMinor}`,
);

const statusLabel = computed(() => {
  if (props.transaction.status === 'DRAFT') return 'Черновик';
  if (props.transaction.status === 'CANCELLED') return 'Отменена';
  if (props.transaction.status === 'DELETED') return 'Удалена';
  return null;
});

const statusTone = computed(() => {
  if (props.transaction.status === 'DELETED') return 'danger' as const;
  if (props.transaction.status === 'CANCELLED') return 'warning' as const;
  return 'neutral' as const;
});

const unallocatedMinor = computed(() =>
  isIncome.value && props.transaction.unallocatedMinor !== '0'
    ? props.transaction.unallocatedMinor
    : null,
);

const rowLabel = computed(
  () => `Открыть операцию «${props.categoryName}» от ${props.transaction.occurredOn}`,
);
</script>

<template>
  <UiListRow :label="rowLabel" @select="$emit('select')">
    <template #leading><component :is="icon" :size="20" aria-hidden="true" /></template>

    <span class="operation-row__title">{{ categoryName }}</span>
    <span v-if="counterparty" class="operation-row__subtitle">{{ counterparty }}</span>
    <span
      v-if="statusLabel || transaction.isPlanned || unallocatedMinor"
      class="operation-row__meta"
    >
      <UiStatus
        v-if="statusLabel"
        data-testid="operation-row-status"
        :label="statusLabel"
        :tone="statusTone"
      />
      <UiStatus v-if="transaction.isPlanned" label="Запланирована" tone="info" />
      <span
        v-if="unallocatedMinor"
        class="operation-row__unallocated"
        data-testid="operation-row-unallocated"
      >
        Не распределено
        <FinanceMoney
          :minor-units="unallocatedMinor"
          :currency="transaction.currency"
          :scale="transaction.scale"
        />
      </span>
    </span>

    <template #trailing>
      <FinanceMoney
        class="operation-row__amount"
        :class="isIncome ? 'operation-row__amount--income' : 'operation-row__amount--expense'"
        :minor-units="signedMinor"
        :currency="transaction.currency"
        :scale="transaction.scale"
      />
      <span class="operation-row__subtitle">{{ accountName }}</span>
      <span v-if="envelopeName" class="operation-row__subtitle">{{ envelopeName }}</span>
    </template>

    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </UiListRow>
</template>

<style scoped>
.operation-row__title {
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operation-row__subtitle {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.operation-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-1);
  align-items: center;
}

.operation-row__unallocated {
  display: inline-flex;
  gap: 0.25rem;
  align-items: baseline;
  color: var(--hf-color-status-warning);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.operation-row__amount {
  font-weight: var(--hf-font-weight-semibold);
}

.operation-row__amount--income {
  color: var(--hf-color-status-success);
}

.operation-row__amount--expense {
  color: var(--hf-color-text);
}
</style>
