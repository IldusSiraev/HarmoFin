<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue';
import { computed } from 'vue';

import type { EnvelopeLimitV2Row } from '../../../composables/useEnvelopePlanV2.js';
import { formatMinorUnits } from '../../finance/money-format.js';

defineOptions({ name: 'AnalyticsLimitBar' });

const props = defineProps<{ row: EnvelopeLimitV2Row }>();
const money = (minor: string) => formatMinorUnits(minor, 'RUB', 2);
const overspent = computed(() => props.row.overspentMinor !== '0');
// spentPermille is the server ratio; the bar only caps it for drawing.
const percent = computed(() =>
  props.row.spentPermille === null ? 0 : Math.min(props.row.spentPermille, 1000) / 10,
);
</script>

<template>
  <article class="limit-bar">
    <header class="limit-bar__head">
      <h3 class="limit-bar__name">{{ row.envelopeName }}</h3>
      <span v-if="row.targetStatus === 'DRAFT'" class="limit-bar__draft">Лимит не подтверждён</span>
    </header>
    <template v-if="row.targetMinor !== null">
      <svg
        class="limit-bar__track"
        viewBox="0 0 100 1"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <rect
          data-fill
          :data-percent="String(percent)"
          :class="['limit-bar__fill', { 'limit-bar__fill--over': overspent }]"
          x="0"
          y="0"
          :width="percent"
          height="1"
        />
      </svg>
      <p class="limit-bar__text">
        Потрачено {{ money(row.spentMinor) }} из {{ money(row.targetMinor) }}
      </p>
      <p v-if="overspent" data-overspent class="limit-bar__over">
        <TriangleAlert :size="16" aria-hidden="true" />
        Перерасход {{ money(row.overspentMinor) }}
      </p>
      <p v-else-if="row.remainingMinor !== null" class="limit-bar__muted">
        Осталось {{ money(row.remainingMinor) }}
      </p>
    </template>
    <template v-else>
      <p class="limit-bar__muted">Лимит на период не задан</p>
      <p class="limit-bar__text">Потрачено {{ money(row.spentMinor) }}</p>
    </template>
  </article>
</template>

<style scoped>
.limit-bar {
  display: grid;
  gap: var(--hf-space-2);
  padding: var(--hf-space-4) 0;
  border-bottom: 1px solid var(--hf-color-border);
}
.limit-bar:last-child {
  border-bottom: 0;
}
.limit-bar__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--hf-space-3);
}
.limit-bar__name {
  margin: 0;
  font-size: var(--hf-font-size-body);
  font-weight: var(--hf-font-weight-semibold);
}
.limit-bar__draft {
  color: var(--hf-color-status-warning);
  font-size: var(--hf-font-size-caption);
}
.limit-bar__track {
  display: block;
  width: 100%;
  height: 0.5rem;
  overflow: hidden;
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-chart-track);
}
.limit-bar__fill {
  fill: var(--hf-color-chart-1);
}
.limit-bar__fill--over {
  fill: var(--hf-color-status-danger);
}
.limit-bar__text,
.limit-bar__muted,
.limit-bar__over {
  margin: 0;
  font-size: var(--hf-font-size-small);
  font-variant-numeric: tabular-nums;
}
.limit-bar__muted {
  color: var(--hf-color-text-muted);
}
.limit-bar__over {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  color: var(--hf-color-text-danger);
  font-weight: var(--hf-font-weight-medium);
}
</style>
