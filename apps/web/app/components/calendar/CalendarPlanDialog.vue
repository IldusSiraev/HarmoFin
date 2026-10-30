<script setup lang="ts">
import { computed } from 'vue';
import { Wallet } from '@lucide/vue';

import type { CalendarFeedPlanItem } from '../../composables/useFamilyCalendar.js';
import { formatMinorUnits } from '../finance/money-format.js';
import { authorLabel } from '../operations/author-label.js';
import UiModal from '../ui/Modal.vue';
import UiMoreLink from '../ui/MoreLink.vue';
import UiStatus from '../ui/Status.vue';
import { planStatusLabel } from './calendar-dates.js';

const props = defineProps<{
  open: boolean;
  item: CalendarFeedPlanItem | null;
}>();
const emit = defineEmits<{ close: [] }>();

// The amount is the server value, only formatted here.
const amount = computed(() =>
  props.item ? formatMinorUnits(props.item.amountMinor, 'RUB', 2) : '',
);
const status = computed(() => (props.item ? planStatusLabel(props.item) : null));
const link = computed(() =>
  props.item ? `/app/plans?occurrence=${encodeURIComponent(props.item.occurrenceId)}` : '',
);
</script>

<template>
  <UiModal :open="open" :title="item?.title ?? ''" size="sm" @close="emit('close')">
    <div v-if="item" class="plan-card">
      <div class="plan-card__summary">
        <span class="plan-card__icon" aria-hidden="true"><Wallet :size="20" /></span>
        <div class="plan-card__amount-block">
          <span class="plan-card__label">Сумма</span>
          <span class="plan-card__amount" data-testid="calendar-plan-amount">{{ amount }}</span>
        </div>
        <UiStatus
          v-if="status"
          class="plan-card__status"
          :label="status.label"
          :tone="status.tone"
        />
      </div>
      <p class="plan-card__owner" data-testid="calendar-plan-owner">
        Владелец: {{ authorLabel(item.owner) }}
      </p>
      <UiMoreLink :to="link" data-testid="calendar-plan-link">Открыть в «Планах»</UiMoreLink>
    </div>
  </UiModal>
</template>

<style scoped>
.plan-card {
  display: grid;
  gap: var(--hf-space-3);
  justify-items: start;
  min-width: 0;
}

.plan-card__summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
  align-items: center;
  width: 100%;
  min-width: 0;
}

.plan-card__icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text-muted);
}

.plan-card__amount-block {
  display: grid;
  flex: 1 1 auto;
  gap: 0.125rem;
  min-width: 0;
}

.plan-card__label,
.plan-card__owner {
  font-size: var(--hf-font-size-small);
  color: var(--hf-color-text-muted);
}

.plan-card__amount {
  font-size: var(--hf-font-size-h2);
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.plan-card__status {
  flex: 0 0 auto;
}

.plan-card__owner {
  margin: 0;
}
</style>
