<script setup lang="ts">
import { computed } from 'vue';

import { formatLandingMoney } from '../format-money.js';
import { analyticsData } from '../../../data/landing.js';

defineOptions({ name: 'PlanVsFactBars' });

const maxMinor = computed(() =>
  analyticsData.planVsFact.reduce((max, row) => {
    const localMax = Math.max(Number(BigInt(row.planMinor)), Number(BigInt(row.factMinor)));
    return Math.max(max, localMax);
  }, 0),
);

const rows = computed(() =>
  analyticsData.planVsFact.map((row) => ({
    label: row.label,
    plan: formatLandingMoney(row.planMinor),
    fact: formatLandingMoney(row.factMinor),
    planWidth: `${((Number(BigInt(row.planMinor)) / maxMinor.value) * 100).toFixed(1)}%`,
    factWidth: `${((Number(BigInt(row.factMinor)) / maxMinor.value) * 100).toFixed(1)}%`,
  })),
);
</script>

<template>
  <ul class="plan-fact">
    <li v-for="row in rows" :key="row.label" class="plan-fact__row">
      <p class="plan-fact__label">{{ row.label }}</p>

      <p class="plan-fact__values">
        <span>План {{ row.plan }}</span>
        <span>Факт {{ row.fact }}</span>
      </p>

      <div class="plan-fact__bars">
        <div
          class="plan-fact__bar plan-fact__bar--plan"
          data-testid="plan-bar"
          :style="{ width: row.planWidth }"
        />
        <div
          class="plan-fact__bar plan-fact__bar--fact"
          data-testid="fact-bar"
          :style="{ width: row.factWidth }"
        />
      </div>
    </li>
  </ul>
</template>

<style scoped>
.plan-fact {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--hf-space-4);
}

.plan-fact__label {
  margin: 0;
}

.plan-fact__values {
  display: flex;
  justify-content: space-between;
  margin: 0;
  font-size: var(--hf-font-size-small);
  color: var(--hf-color-text-muted);
  font-variant-numeric: tabular-nums;
}

.plan-fact__bars {
  display: grid;
  gap: var(--hf-space-1);
}

.plan-fact__bar {
  height: 0.5rem;
  border-radius: var(--hf-radius-sm);
}

.plan-fact__bar--plan {
  background: var(--hf-color-primary-bright);
}

.plan-fact__bar--fact {
  background: var(--hf-color-brand-bright);
}
</style>
