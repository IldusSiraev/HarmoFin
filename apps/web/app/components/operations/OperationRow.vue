<script setup lang="ts">
import { computed } from 'vue';

import { authorLabel } from './author-label.js';
import { categoryIcon as categoryIconComponent } from './category-icon.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiListRow from '../ui/ListRow.vue';
import UiStatus from '../ui/Status.vue';
import type { TransactionJournalV2Item } from '../../composables/useEnvelopePlanV2.js';
import { formatPlainDate } from '../obligations/format-plain-date.js';

defineOptions({ name: 'OperationRow' });

const props = withDefaults(
  defineProps<{
    transaction: TransactionJournalV2Item;
    categoryName: string;
    categoryIcon: string | null;
    accountName: string;
    envelopeName: string | null;
    // Hidden by the page while the family has only one member: a single-author
    // filter chip and label would be pure noise then.
    showAuthor?: boolean;
  }>(),
  { showAuthor: false },
);

defineEmits<{ select: [] }>();

const icon = computed(() =>
  categoryIconComponent(props.categoryIcon, props.transaction.transactionType),
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

// The journal money scale is fixed: the API serves RUB in minor units.
const SCALE = 2;

const isPlanPayment = computed(() => props.transaction.planOccurrenceIds.length > 0);

const rowLabel = computed(
  () =>
    `Открыть операцию «${props.categoryName}» от ${formatPlainDate(props.transaction.occurredOn)}`,
);
</script>

<template>
  <UiListRow
    :label="rowLabel"
    :leading-tone="transaction.transactionType === 'INCOME' ? 'income' : 'expense'"
    @select="$emit('select')"
  >
    <template #leading><component :is="icon" :size="20" aria-hidden="true" /></template>

    <span class="operation-row__title">{{ categoryName }}</span>
    <span v-if="counterparty" class="operation-row__subtitle">{{ counterparty }}</span>
    <span v-if="statusLabel || isPlanPayment" class="operation-row__meta">
      <UiStatus
        v-if="statusLabel"
        data-testid="operation-row-status"
        :label="statusLabel"
        :tone="statusTone"
      />
      <UiStatus v-if="isPlanPayment" label="По плану" tone="info" />
    </span>

    <template #trailing>
      <FinanceMoney
        class="operation-row__amount"
        :class="isIncome ? 'operation-row__amount--income' : 'operation-row__amount--expense'"
        :minor-units="signedMinor"
        :currency="transaction.currency"
        :scale="SCALE"
      />
      <span class="operation-row__subtitle operation-row__placement">{{ accountName }}</span>
      <span v-if="envelopeName" class="operation-row__subtitle operation-row__placement">
        {{ envelopeName }}
      </span>
      <span v-if="showAuthor && transaction.createdBy" class="operation-row__author">
        {{ authorLabel(transaction.createdBy) }}
      </span>
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
  overflow: hidden;
  max-width: 100%;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operation-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-1);
  align-items: center;
}

.operation-row__amount {
  font-weight: var(--hf-font-weight-semibold);
  white-space: nowrap;
}

.operation-row__amount--income {
  color: var(--hf-color-status-success);
}

.operation-row__amount--expense {
  color: var(--hf-color-text);
}

.operation-row__author {
  overflow: hidden;
  max-width: 100%;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* A phone has no room for three columns of text: the account and the envelope
   stay one tap away in the detail panel. */
@media (max-width: 599px) {
  .operation-row__placement {
    display: none;
  }
}
</style>
