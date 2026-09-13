<script setup lang="ts">
import { computed } from 'vue';
import { TrendingDown, TrendingUp } from '@lucide/vue';

import { formatLandingMoney, formatLandingSignedMoney } from '../format-money.js';
import { variableIncome } from '../../../data/landing.js';

defineOptions({ name: 'IncomeComparison' });

const cases = computed(() =>
  variableIncome.cases.map((item) => {
    const planned = BigInt(variableIncome.plannedMinor);
    const received = BigInt(item.receivedMinor);
    const above = received >= planned;
    const deltaMinor = (above ? received - planned : planned - received).toString();

    return {
      receivedMinor: item.receivedMinor,
      received: formatLandingMoney(item.receivedMinor),
      above,
      delta: formatLandingSignedMoney(deltaMinor, above ? 'plus' : 'minus'),
      summary: above ? 'Больше плана на' : 'Меньше плана на',
    };
  }),
);

const planned = computed(() => formatLandingMoney(variableIncome.plannedMinor));
</script>

<template>
  <ul class="income-comparison">
    <li
      v-for="entry in cases"
      :key="entry.receivedMinor"
      class="income-comparison__case"
      data-testid="income-case"
    >
      <p class="income-comparison__label">Планировалось</p>
      <p class="income-comparison__planned">{{ planned }}</p>

      <p class="income-comparison__label">Получено</p>
      <p class="income-comparison__received">{{ entry.received }}</p>

      <p class="income-comparison__delta" :class="entry.above ? 'is-above' : 'is-below'">
        <TrendingUp v-if="entry.above" :size="16" aria-hidden="true" />
        <TrendingDown v-else :size="16" aria-hidden="true" />
        <span>{{ entry.summary }} {{ entry.delta }}</span>
      </p>
    </li>
  </ul>
</template>

<style scoped>
.income-comparison {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--hf-space-4);
}

@media (min-width: 768px) {
  .income-comparison {
    grid-template-columns: 1fr 1fr;
  }
}

.income-comparison__case {
  background: var(--hf-color-surface);
  border: 1px solid var(--hf-color-surface-subtle);
  border-radius: var(--hf-radius-md);
  box-shadow: var(--hf-shadow-xs);
  padding: var(--hf-space-6);
  display: grid;
  gap: var(--hf-space-3);
}

.income-comparison__label {
  margin: 0;
  font-size: var(--hf-font-size-caption);
  color: var(--hf-color-text-muted);
}

.income-comparison__planned {
  margin: 0;
}

.income-comparison__received {
  margin: 0;
  font-size: var(--hf-font-size-h2);
  font-feature-settings: 'tnum';
  font-variant-numeric: tabular-nums;
}

.income-comparison__delta {
  margin: 0;
  display: flex;
  gap: var(--hf-space-2);
  align-items: center;
}

.income-comparison__delta.is-above {
  color: var(--hf-color-brand);
}

.income-comparison__delta.is-below {
  color: var(--hf-color-action-danger);
}
</style>
