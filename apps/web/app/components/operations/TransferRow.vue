<script setup lang="ts">
import { computed } from 'vue';
import { ArrowLeftRight } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import UiListRow from '../ui/ListRow.vue';
import UiStatus from '../ui/Status.vue';
import type { TransferJournalItem } from '../../composables/useEnvelopePlanV2.js';
import { formatPlainDate } from '../obligations/format-plain-date.js';

defineOptions({ name: 'TransferRow' });

const props = defineProps<{
  transfer: TransferJournalItem;
  sourceName: string;
  destinationName: string;
}>();

defineEmits<{ select: [] }>();

// The journal money scale is fixed: the API serves RUB in minor units.
const SCALE = 2;

const route = computed(() => `${props.sourceName} → ${props.destinationName}`);

const rowLabel = computed(
  () => `Открыть перевод ${route.value} от ${formatPlainDate(props.transfer.occurredOn)}`,
);
</script>

<template>
  <UiListRow :label="rowLabel" leading-tone="transfer" @select="$emit('select')">
    <template #leading><ArrowLeftRight :size="20" aria-hidden="true" /></template>

    <span class="transfer-row__title">Перевод</span>
    <span v-if="transfer.comment" class="transfer-row__subtitle">{{ transfer.comment }}</span>
    <span v-if="transfer.status === 'DELETED'" class="transfer-row__meta">
      <UiStatus data-testid="transfer-row-status" label="Удалён" tone="danger" />
    </span>

    <template #trailing>
      <!-- A transfer is neither income nor spending: no sign, neutral colour. -->
      <FinanceMoney
        class="transfer-row__amount"
        :minor-units="transfer.amountMinor"
        :currency="transfer.currency"
        :scale="SCALE"
      />
      <span class="transfer-row__subtitle transfer-row__placement">{{ route }}</span>
    </template>

    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </UiListRow>
</template>

<style scoped>
.transfer-row__title {
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-row__subtitle {
  overflow: hidden;
  max-width: 100%;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-row__meta {
  display: flex;
  gap: var(--hf-space-1);
  align-items: center;
}

.transfer-row__amount {
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-semibold);
  white-space: nowrap;
}
</style>
