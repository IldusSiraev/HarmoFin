<script setup lang="ts">
import type { DirectTransferResponse } from '../../composables/useEnvelopePlanV2.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiCard from '../ui/Card.vue';
import UiStatus from '../ui/Status.vue';
import { formatPlainDate } from '../obligations/format-plain-date.js';

// Read-only card for a v2 transfer: either account to account, or a historical
// transfer with envelope parts (shown, never editable).
defineOptions({ name: 'DirectTransferCard' });

defineProps<{
  transfer: DirectTransferResponse;
  currency: string;
  accountNames: ReadonlyMap<string, string>;
}>();

const STATUS: Record<
  DirectTransferResponse['status'],
  { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }
> = {
  DRAFT: { label: 'Черновик', tone: 'neutral' },
  CONFIRMED: { label: 'Подтверждён', tone: 'success' },
  CANCELLED: { label: 'Отменён', tone: 'warning' },
  DELETED: { label: 'Удалён', tone: 'danger' },
};
</script>

<template>
  <UiCard as="article" class="direct-transfer-card">
    <template #header>
      <div class="direct-transfer-card__header">
        <div>
          <p>Перевод</p>
          <h2>{{ formatPlainDate(transfer.occurredOn) }}</h2>
        </div>
        <UiStatus :label="STATUS[transfer.status].label" :tone="STATUS[transfer.status].tone" />
      </div>
    </template>
    <FinanceMoney :minor-units="transfer.totalMinor" :currency="currency" :scale="2" />
    <p
      v-if="transfer.sourceAccountId && transfer.destinationAccountId"
      class="direct-transfer-card__meta"
    >
      {{ accountNames.get(transfer.sourceAccountId) ?? 'Счёт' }} →
      {{ accountNames.get(transfer.destinationAccountId) ?? 'Счёт' }}
    </p>
    <p v-if="transfer.comment" class="direct-transfer-card__meta">{{ transfer.comment }}</p>
  </UiCard>
</template>

<style scoped>
.direct-transfer-card__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--hf-space-4);
}
.direct-transfer-card__header p,
.direct-transfer-card__header h2,
.direct-transfer-card__meta {
  margin: 0;
}
.direct-transfer-card__header p,
.direct-transfer-card__meta {
  color: var(--hf-color-text-muted);
}
.direct-transfer-card__header h2 {
  margin-top: var(--hf-space-1);
  font-size: var(--hf-font-size-body);
}
</style>
