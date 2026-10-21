<script setup lang="ts">
import { computed } from 'vue';
import { AlertOctagon, AlertTriangle, Info } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import { formatMinorUnits } from '../finance/money-format.js';
import UiListRow from '../ui/ListRow.vue';
import UiProgress from '../ui/Progress.vue';
import UiStatus from '../ui/Status.vue';
import { progressPercent } from '../ui/progress-percent.js';
import type { EnvelopePlanDto } from '../../composables/useEnvelopePlanV2.js';
import EnvelopeTypeIcon from './EnvelopeTypeIcon.vue';
import {
  type PlanBadge,
  type PlanProgress,
  balanceSign,
  decimalToMinor,
  envelopeCaption,
  planBadge,
} from './envelope-plan-kind.js';

defineOptions({ name: 'EnvelopePlanRow' });

// A v2 envelope is an assignment of money, not a physical store: every figure
// is a server-provided minor string, nothing is computed here. The progress
// percent is a display share of two server strings (progressPercent).
const props = defineProps<{
  envelope: EnvelopePlanDto;
  progress?: PlanProgress | null | undefined;
  badge?: PlanBadge | null | undefined;
  highlight?: string | undefined;
}>();

defineEmits<{ select: [] }>();

// The goal arrives as decimal rubles; convert to minor text for display.
const targetMinor = computed(() =>
  props.envelope.targetAmountMinor === null
    ? null
    : decimalToMinor(props.envelope.targetAmountMinor),
);
const caption = computed(() => envelopeCaption(props.envelope));
const factsText = computed(
  () =>
    `Отложено ${money(props.envelope.fundedMinor)} · потрачено ${money(props.envelope.spentMinor)}`,
);
const overspent = computed(() => balanceSign(props.envelope.balanceMinor) === 'negative');

// Landing/demo pass no badge: fall back to the overspent badge so the status
// still shows as text. An explicit null means "no badge".
const shownBadge = computed(() =>
  props.badge === undefined ? planBadge(props.envelope, null) : props.badge,
);
const hasSide = computed(() => Boolean(props.progress || shownBadge.value || props.highlight));

const percent = computed(() =>
  props.progress ? progressPercent(props.progress.value, props.progress.max) : 0,
);
const percentText = computed(() => `${percent.value}\u00a0%`);
const progressAria = computed(() =>
  props.progress ? `${props.progress.label}: ${percentText.value}` : '',
);

function money(minor: string): string {
  return formatMinorUnits(minor, 'RUB', 2);
}

const rowLabel = computed(() => {
  const e = props.envelope;
  const parts = [
    `Открыть конверт «${e.name}»`,
    `отложено ${money(e.fundedMinor)}`,
    `потрачено ${money(e.spentMinor)}`,
    `осталось ${money(e.balanceMinor)}`,
  ];
  const badge = shownBadge.value;
  if (overspent.value && badge?.tone !== 'danger') parts.push('перерасход');
  if (targetMinor.value !== null) parts.push(`цель ${money(targetMinor.value)}`);
  if (props.progress) parts.push(progressAria.value);
  if (badge) parts.push(badge.text);
  else if (props.highlight) parts.push(props.highlight);
  if (e.archivedAt) parts.push('в архиве');
  return parts.join(', ');
});
</script>

<template>
  <UiListRow class="plan-row" :label="rowLabel" @select="$emit('select')">
    <template #leading><EnvelopeTypeIcon :envelope-type="envelope.envelopeType" /></template>

    <span class="plan-row__body">
      <span class="plan-row__grid" :class="{ 'plan-row__grid--side': hasSide }">
        <span class="plan-row__identity">
          <span class="plan-row__title">{{ envelope.name }}</span>
          <span
            v-if="caption.targetMinor !== null"
            class="plan-row__muted"
            data-testid="plan-row-scope"
          >
            Цель <span data-testid="plan-row-target">{{ money(caption.targetMinor) }}</span>
          </span>
          <span v-else class="plan-row__muted" data-testid="plan-row-scope">{{
            caption.text
          }}</span>
          <UiStatus v-if="envelope.archivedAt" label="В архиве" tone="neutral" />
        </span>

        <span class="plan-row__amount">
          <span class="plan-row__label">Осталось</span>
          <FinanceMoney
            class="plan-row__balance"
            :minor-units="envelope.balanceMinor"
            currency="RUB"
            :scale="2"
          />
          <span class="plan-row__muted">{{ factsText }}</span>
        </span>

        <span v-if="hasSide" class="plan-row__progress">
          <template v-if="progress">
            <span class="plan-row__progress-head">
              <span>{{ progress.label }}</span>
              <span class="plan-row__percent">{{ percentText }}</span>
            </span>
            <UiProgress
              :value="progress.value"
              :max="progress.max"
              :label="progressAria"
              :tone="progress.tone"
            />
          </template>
          <span
            v-if="shownBadge"
            class="plan-row__badge"
            :class="`plan-row__badge--${shownBadge.tone}`"
            data-testid="plan-row-badge"
          >
            <AlertTriangle v-if="shownBadge.tone === 'warning'" :size="14" aria-hidden="true" />
            <AlertOctagon v-else :size="14" aria-hidden="true" />
            {{ shownBadge.text }}
          </span>
          <span
            v-else-if="highlight"
            class="plan-row__badge plan-row__badge--warning"
            data-testid="plan-row-highlight"
          >
            <Info :size="14" aria-hidden="true" />
            {{ highlight }}
          </span>
        </span>
      </span>
    </span>

    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </UiListRow>
</template>

<style scoped>
.plan-row {
  padding: var(--hf-space-1);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}

/* The type tile carries its own tone background. */
.plan-row :deep(.ui-list-row__leading) {
  align-self: start;
  background: transparent;
}

/* The card is reused in narrow frames (landing, demo), so its columns follow
   the card's own width, not the viewport. */
.plan-row__body {
  display: block;
  min-width: 0;
  container-type: inline-size;
}

.plan-row__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--hf-space-2) var(--hf-space-4);
  align-items: center;
  min-width: 0;
}

.plan-row__grid > * {
  min-width: 0;
}

.plan-row__identity,
.plan-row__amount,
.plan-row__progress {
  display: grid;
  gap: 0.125rem;
  align-content: start;
}

/* Below the three-column width the progress block takes a full row. */
.plan-row__progress {
  grid-column: 1 / -1;
  gap: var(--hf-space-1);
}

.plan-row__title {
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-row__muted,
.plan-row__label {
  max-width: 100%;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.plan-row__balance {
  font-size: var(--hf-font-size-h3);
  font-weight: var(--hf-font-weight-semibold);
  white-space: nowrap;
}

.plan-row__progress-head {
  display: flex;
  gap: var(--hf-space-2);
  justify-content: space-between;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.plan-row__percent {
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
  white-space: nowrap;
}

.plan-row__badge {
  display: inline-flex;
  gap: var(--hf-space-1);
  align-items: center;
  justify-self: start;
  max-width: 100%;
  padding: var(--hf-space-1) var(--hf-space-2);
  border-radius: var(--hf-radius-sm);
  font-size: var(--hf-font-size-caption);
  font-weight: var(--hf-font-weight-medium);
}

.plan-row__badge--warning {
  background: var(--hf-color-warning-soft);
  color: var(--hf-color-status-warning);
}

.plan-row__badge--danger {
  background: var(--hf-color-danger-soft);
  color: var(--hf-color-text-danger);
}

@container (min-width: 26rem) {
  .plan-row__grid {
    grid-template-columns: minmax(14rem, 1.4fr) minmax(10rem, 1fr);
  }
}

@container (min-width: 40rem) {
  .plan-row__grid--side {
    grid-template-columns: minmax(14rem, 1.4fr) minmax(10rem, 1fr) minmax(12rem, 1.2fr);
  }

  .plan-row__progress {
    grid-column: auto;
  }
}
</style>
