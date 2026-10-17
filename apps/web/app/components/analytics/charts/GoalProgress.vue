<script setup lang="ts">
import { CircleCheck } from '@lucide/vue';

import type { GoalProgressRowDto } from '../../../composables/useBudgetReferenceData.js';
import { dateLabel } from '../date-label.js';
import { formatMinorUnits } from '../../finance/money-format.js';

defineOptions({ name: 'AnalyticsGoalProgress' });

const props = defineProps<{ row: GoalProgressRowDto }>();
const money = (minor: string) => formatMinorUnits(minor, 'RUB', 2);

function deadlineText(row: GoalProgressRowDto) {
  if (!row.targetDate) return 'Срок не указан';
  if (row.daysRemaining === null) return `Целевая дата: ${dateLabel(row.targetDate)}`;
  if (row.daysRemaining < 0) return `Просрочено на ${Math.abs(row.daysRemaining)} дн.`;
  if (row.daysRemaining === 0) return 'Срок сегодня';
  return `Осталось дней: ${row.daysRemaining}`;
}
// progressPermille is computed and capped by the server (0..1000).
const percent = () => props.row.progressPermille / 10;
</script>

<template>
  <article data-goal class="goal">
    <header class="goal__head">
      <h3 class="goal__name">{{ row.name }}</h3>
      <span v-if="row.isReached" class="goal__reached">
        <CircleCheck :size="16" aria-hidden="true" /> Цель достигнута
      </span>
    </header>
    <svg
      class="goal__track"
      viewBox="0 0 100 1"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        data-fill
        :data-percent="String(percent())"
        class="goal__fill"
        x="0"
        y="0"
        :width="percent()"
        height="1"
      />
    </svg>
    <p class="goal__text">Отложено {{ money(row.currentMinor) }} из {{ money(row.targetMinor) }}</p>
    <p class="goal__muted">
      <span v-if="!row.isReached">Осталось {{ money(row.remainingMinor) }} · </span
      >{{ deadlineText(row) }}
    </p>
  </article>
</template>

<style scoped>
.goal {
  display: grid;
  gap: var(--hf-space-2);
  padding: var(--hf-space-4) 0;
  border-bottom: 1px solid var(--hf-color-border);
}
.goal:last-child {
  border-bottom: 0;
}
.goal__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--hf-space-3);
}
.goal__name {
  margin: 0;
  font-size: var(--hf-font-size-body);
  font-weight: var(--hf-font-weight-semibold);
}
.goal__reached {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  color: var(--hf-color-status-success);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
}
.goal__track {
  display: block;
  width: 100%;
  height: 0.5rem;
  overflow: hidden;
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-chart-track);
}
.goal__fill {
  fill: var(--hf-color-chart-2);
}
.goal__text,
.goal__muted {
  margin: 0;
  font-size: var(--hf-font-size-small);
  font-variant-numeric: tabular-nums;
}
.goal__muted {
  color: var(--hf-color-text-muted);
}
</style>
