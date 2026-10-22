<script setup lang="ts">
import { computed } from 'vue';
import { CircleAlert } from '@lucide/vue';

import EnvelopeTypeIcon from '../envelopes/EnvelopeTypeIcon.vue';
import { envelopeTone, formatMoneyText } from '../envelopes/envelope-plan-kind.js';
import { envelopeSubtitle } from '../envelopes/envelope-type.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiProgress from '../ui/Progress.vue';
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';

defineOptions({ name: 'DashboardEnvelopeRow' });

const props = defineProps<{ envelope: DashboardV2Response['envelopes'][number] }>();

const PROGRESS_LABELS = {
  SPENT: 'Потрачено из отложенного',
  COVERED: 'Покрыто ближайших платежей',
  GOAL: 'Цель',
} as const;

const progress = computed(() => props.envelope.progress);
const shortfall = computed(() => {
  const value = progress.value?.kind === 'COVERED' ? progress.value.shortfallMinor : null;
  return value !== null && value !== '0' ? value : null;
});
const subtitle = computed(() => {
  if (progress.value?.kind === 'COVERED' && shortfall.value === null) return 'Отложено полностью';
  return envelopeSubtitle(props.envelope);
});
</script>

<template>
  <span class="envelope-row">
    <EnvelopeTypeIcon :envelope-type="envelope.envelopeType" size="sm" />
    <span class="envelope-row__body">
      <span class="envelope-row__head">
        <span class="envelope-row__name">{{ envelope.name }}</span>
        <FinanceMoney
          class="envelope-row__amount"
          :minor-units="envelope.balanceMinor"
          currency="RUB"
          :scale="2"
        />
      </span>
      <span v-if="shortfall" class="envelope-row__subtitle envelope-row__subtitle--warning">
        <CircleAlert :size="14" aria-hidden="true" />
        Нужно пополнить {{ formatMoneyText(shortfall) }}
      </span>
      <span v-else class="envelope-row__subtitle">{{ subtitle }}</span>
      <UiProgress
        v-if="progress"
        class="envelope-row__progress"
        :value="progress.valueMinor"
        :max="progress.maxMinor"
        :label="PROGRESS_LABELS[progress.kind]"
        :tone="envelopeTone(envelope.envelopeType)"
      />
    </span>
  </span>
</template>

<style scoped>
.envelope-row {
  display: flex;
  flex: 1;
  gap: var(--hf-space-3);
  align-items: flex-start;
  min-width: 0;
}

.envelope-row__body {
  display: grid;
  flex: 1;
  gap: 0.125rem;
  min-width: 0;
}

.envelope-row__head {
  display: flex;
  gap: var(--hf-space-3);
  justify-content: space-between;
}

.envelope-row__name {
  overflow: hidden;
  font-weight: var(--hf-font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.envelope-row__amount {
  flex-shrink: 0;
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.envelope-row__subtitle {
  display: inline-flex;
  gap: var(--hf-space-1);
  align-items: center;
  overflow: hidden;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.envelope-row__subtitle--warning {
  color: var(--hf-color-status-warning);
}

.envelope-row__progress {
  height: 0.375rem;
  margin-top: var(--hf-space-2);
}
</style>
