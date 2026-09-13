<script setup lang="ts">
import { computed } from 'vue';

import { formatLandingMoney } from '../format-money.js';
import { analyticsData } from '../../../data/landing.js';

defineOptions({ name: 'CashFlowChart' });

const LEFT = 20;
const RIGHT = 300;
const TOP = 20;
const BOTTOM = 140;

const maxMinor = computed(() =>
  analyticsData.cashFlow.reduce((max, point) => {
    const localMax = Math.max(
      Number(BigInt(point.incomeMinor)),
      Number(BigInt(point.expenseMinor)),
    );
    return Math.max(max, localMax);
  }, 0),
);

function buildPoints(key: 'incomeMinor' | 'expenseMinor'): string {
  const step = (RIGHT - LEFT) / (analyticsData.cashFlow.length - 1);

  return analyticsData.cashFlow
    .map((point, index) => {
      const x = LEFT + step * index;
      const ratio = Number(BigInt(point[key])) / maxMinor.value;
      const y = BOTTOM - ratio * (BOTTOM - TOP);
      return `${Math.round(x)},${Math.round(y)}`;
    })
    .join(' ');
}

const incomePoints = computed(() => buildPoints('incomeMinor'));
const expensePoints = computed(() => buildPoints('expenseMinor'));

function range(key: 'incomeMinor' | 'expenseMinor'): string {
  const values = analyticsData.cashFlow.map((point) => BigInt(point[key]));
  const min = values.reduce((acc, value) => (value < acc ? value : acc));
  const max = values.reduce((acc, value) => (value > acc ? value : acc));
  return `от ${formatLandingMoney(min.toString())} до ${formatLandingMoney(max.toString())}`;
}

const summary = computed(
  () =>
    `Денежный поток за шесть месяцев: доходы ${range('incomeMinor')}, расходы ${range(
      'expenseMinor',
    )}`,
);
</script>

<template>
  <figure class="cash-flow">
    <svg class="cash-flow__svg" viewBox="0 0 320 160" role="img" :aria-label="summary">
      <line x1="20" y1="140" x2="300" y2="140" class="cash-flow__axis" />
      <polyline
        data-testid="cash-flow-income"
        class="cash-flow__line cash-flow__line--income"
        :points="incomePoints"
      />
      <polyline
        data-testid="cash-flow-expense"
        class="cash-flow__line cash-flow__line--expense"
        :points="expensePoints"
      />
    </svg>

    <figcaption class="cash-flow__meta">
      <ul class="cash-flow__legend">
        <li class="cash-flow__legend-item cash-flow__legend-item--income">Доходы</li>
        <li class="cash-flow__legend-item cash-flow__legend-item--expense">Расходы</li>
      </ul>
      <ul class="cash-flow__months">
        <li v-for="point in analyticsData.cashFlow" :key="point.label">{{ point.label }}</li>
      </ul>
    </figcaption>
  </figure>
</template>

<style scoped>
.cash-flow {
  display: grid;
  gap: var(--hf-space-3);
  margin: 0;
}

.cash-flow__svg {
  width: 100%;
  height: auto;
}

.cash-flow__line {
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.cash-flow__line--income {
  stroke: var(--hf-color-brand-bright);
}

.cash-flow__line--expense {
  stroke: var(--hf-color-primary-bright);
  stroke-dasharray: 6 4;
}

.cash-flow__axis {
  stroke: var(--hf-color-border);
}

.cash-flow__legend,
.cash-flow__months {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  justify-content: space-between;
  font-size: var(--hf-font-size-caption);
  color: var(--hf-color-text-muted);
}

.cash-flow__legend-item {
  display: flex;
  align-items: center;
  gap: var(--hf-space-1);
}

.cash-flow__legend-item::before {
  content: '';
  display: inline-block;
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 2px;
}

.cash-flow__legend-item--income::before {
  background: var(--hf-color-brand-bright);
}

.cash-flow__legend-item--expense::before {
  background: var(--hf-color-primary-bright);
}
</style>
