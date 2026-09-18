<script setup lang="ts">
import { computed } from 'vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import { formatMinorUnits } from '../finance/money-format.js';
import UiListRow from '../ui/ListRow.vue';
import UiProgress from '../ui/Progress.vue';
import UiStatus from '../ui/Status.vue';
import type { EnvelopeDto } from '../../composables/useBudgetReferenceData.js';
import { ENVELOPE_TYPE_ICONS, envelopeSubtitle } from './envelope-type.js';

defineOptions({ name: 'EnvelopeRow' });

const props = defineProps<{ envelope: EnvelopeDto }>();

defineEmits<{ select: [] }>();

const icon = computed(() => ENVELOPE_TYPE_ICONS[props.envelope.envelopeType]);
const subtitle = computed(() => envelopeSubtitle(props.envelope));

const goalTarget = computed(() => props.envelope.targetAmountMinor);

const goalLabel = computed(() => {
  const target = goalTarget.value;
  if (target === null) return '';
  const saved = formatMinorUnits(
    props.envelope.currentBalanceMinor,
    props.envelope.currency,
    props.envelope.scale,
  );
  const total = formatMinorUnits(target, props.envelope.currency, props.envelope.scale);
  return `${saved} из ${total}`;
});

// UiListRow renders this as the button's explicit aria-label, which per ARIA
// semantics replaces name-from-content entirely — so the balance, the goal
// progress and the archived badge rendered inside the row (visually) must
// also be folded in here, or assistive tech never receives them at all.
const formattedBalance = computed(() =>
  formatMinorUnits(
    props.envelope.currentBalanceMinor,
    props.envelope.currency,
    props.envelope.scale,
  ),
);

const rowLabel = computed(() => {
  const parts = [`Открыть конверт «${props.envelope.name}»`, `баланс ${formattedBalance.value}`];
  if (goalTarget.value !== null) parts.push(`накоплено ${goalLabel.value}`);
  if (props.envelope.archivedAt) parts.push('в архиве');
  return parts.join(', ');
});
</script>

<template>
  <UiListRow :label="rowLabel" @select="$emit('select')">
    <template #leading><component :is="icon" :size="20" aria-hidden="true" /></template>

    <span class="envelope-row__title">{{ envelope.name }}</span>
    <span class="envelope-row__subtitle">{{ subtitle }}</span>
    <span v-if="goalTarget !== null" class="envelope-row__goal">
      <UiProgress
        :value="envelope.currentBalanceMinor"
        :max="goalTarget"
        :label="`Накоплено ${goalLabel}`"
      />
      <span class="envelope-row__subtitle" data-testid="envelope-row-goal">{{ goalLabel }}</span>
    </span>
    <span v-if="envelope.archivedAt" class="envelope-row__meta">
      <UiStatus data-testid="envelope-row-archived" label="В архиве" tone="neutral" />
    </span>

    <template #trailing>
      <FinanceMoney
        class="envelope-row__amount"
        :minor-units="envelope.currentBalanceMinor"
        :currency="envelope.currency"
        :scale="envelope.scale"
      />
    </template>

    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </UiListRow>
</template>

<style scoped>
.envelope-row__title {
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.envelope-row__subtitle {
  overflow: hidden;
  max-width: 100%;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.envelope-row__goal {
  display: grid;
  gap: var(--hf-space-1);
}

.envelope-row__meta {
  display: flex;
  gap: var(--hf-space-1);
  align-items: center;
}

.envelope-row__amount {
  font-weight: var(--hf-font-weight-semibold);
  white-space: nowrap;
}
</style>
