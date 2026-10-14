<script setup lang="ts">
import { computed } from 'vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import { formatMinorUnits } from '../finance/money-format.js';
import { Info } from '@lucide/vue';

import UiListRow from '../ui/ListRow.vue';
import UiStatus from '../ui/Status.vue';
import type { EnvelopePlanDto } from '../../composables/useEnvelopePlanV2.js';
import {
  PLAN_SCOPE_LABELS,
  PLAN_SLOT_LABELS,
  balanceSign,
  decimalToMinor,
  planIcon,
  planScopeNote,
} from './envelope-plan-kind.js';

defineOptions({ name: 'EnvelopePlanRow' });

// A v2 envelope is an assignment of money, not a physical store: every figure
// is a server-provided minor string, nothing is computed here.
const props = defineProps<{ envelope: EnvelopePlanDto; highlight?: string | undefined }>();

defineEmits<{ select: [] }>();

const icon = computed(() => planIcon(props.envelope));
const subtitle = computed(() =>
  [
    PLAN_SCOPE_LABELS[props.envelope.envelopeType] ?? 'Пользовательская',
    props.envelope.periodSlot ? PLAN_SLOT_LABELS[props.envelope.periodSlot] : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · '),
);
// The goal arrives as decimal rubles; convert to minor text for display.
const targetMinor = computed(() =>
  props.envelope.targetAmountMinor === null
    ? null
    : decimalToMinor(props.envelope.targetAmountMinor),
);
const scopeNote = computed(() => planScopeNote(props.envelope.envelopeType));
const overspent = computed(() => balanceSign(props.envelope.balanceMinor) === 'negative');

function money(minor: string): string {
  return formatMinorUnits(minor, 'RUB', 2);
}

const rowLabel = computed(() => {
  const e = props.envelope;
  const parts = [
    `Открыть конверт «${e.name}»`,
    `назначено ${money(e.fundedMinor)}`,
    `потрачено ${money(e.spentMinor)}`,
    `осталось ${money(e.balanceMinor)}`,
  ];
  if (overspent.value) parts.push('перерасход');
  if (targetMinor.value !== null) parts.push(`цель ${money(targetMinor.value)}`);
  if (props.highlight) parts.push(props.highlight);
  if (e.archivedAt) parts.push('в архиве');
  return parts.join(', ');
});
</script>

<template>
  <UiListRow :label="rowLabel" @select="$emit('select')">
    <template #leading><component :is="icon" :size="20" aria-hidden="true" /></template>

    <span class="plan-row__title">{{ envelope.name }}</span>
    <span class="plan-row__muted">{{ subtitle }}</span>
    <span class="plan-row__muted" data-testid="plan-row-scope">{{ scopeNote }}</span>
    <span class="plan-row__facts">
      <span
        >Назначено <FinanceMoney :minor-units="envelope.fundedMinor" currency="RUB" :scale="2"
      /></span>
      <span
        >Потрачено <FinanceMoney :minor-units="envelope.spentMinor" currency="RUB" :scale="2"
      /></span>
    </span>
    <span v-if="targetMinor !== null" class="plan-row__muted" data-testid="plan-row-target">
      Цель
      <FinanceMoney :minor-units="targetMinor" currency="RUB" :scale="2" />
    </span>
    <span v-if="envelope.archivedAt || overspent || highlight" class="plan-row__meta">
      <span v-if="highlight" class="plan-row__flag" data-testid="plan-row-highlight">
        <Info :size="14" aria-hidden="true" />
        {{ highlight }}
      </span>
      <UiStatus v-if="overspent" label="Перерасход" tone="danger" />
      <UiStatus v-if="envelope.archivedAt" label="В архиве" tone="neutral" />
    </span>

    <template #trailing>
      <span class="plan-row__left">
        <span class="plan-row__muted">Осталось</span>
        <FinanceMoney
          class="plan-row__amount"
          :minor-units="envelope.balanceMinor"
          currency="RUB"
          :scale="2"
        />
      </span>
    </template>

    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </UiListRow>
</template>

<style scoped>
.plan-row__title {
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-row__muted {
  max-width: 100%;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.plan-row__facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-1) var(--hf-space-3);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}

.plan-row__flag {
  display: inline-flex;
  gap: var(--hf-space-1);
  align-items: center;
  padding: var(--hf-space-1) var(--hf-space-2);
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-status-info-background);
  color: var(--hf-color-status-info);
  font-size: var(--hf-font-size-caption);
  font-weight: var(--hf-font-weight-medium);
}

.plan-row__meta {
  display: flex;
  gap: var(--hf-space-1);
  align-items: center;
}

.plan-row__left {
  display: grid;
  justify-items: end;
}

.plan-row__amount {
  font-weight: var(--hf-font-weight-semibold);
  white-space: nowrap;
}
</style>
