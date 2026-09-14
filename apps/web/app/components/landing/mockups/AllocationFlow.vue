<script setup lang="ts">
import { computed } from 'vue';
import { ArrowDown } from '@lucide/vue';

import { formatLandingMoney } from '../format-money.js';
import { allocationData } from '../../../data/landing.js';

defineOptions({ name: 'AllocationFlow' });

const allocations = computed(() =>
  allocationData.allocations.map((item) => ({
    ...item,
    formatted: formatLandingMoney(item.amountMinor),
    percent: Math.round(
      (Number(BigInt(item.amountMinor)) / Number(BigInt(allocationData.incomeMinor))) * 100,
    ),
  })),
);

const allocatedMinor = computed(() =>
  allocationData.allocations.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n).toString(),
);

const summary = computed(
  () =>
    `Распределено ${formatLandingMoney(allocatedMinor.value)} из ${formatLandingMoney(
      allocationData.incomeMinor,
    )}`,
);
</script>

<template>
  <div class="allocation-flow">
    <div class="allocation-flow__income">
      <p class="allocation-flow__income-name">{{ allocationData.incomeName }}</p>
      <p class="allocation-flow__income-value">
        {{ formatLandingMoney(allocationData.incomeMinor) }}
      </p>
    </div>

    <ArrowDown class="allocation-flow__arrow" :size="24" aria-hidden="true" />

    <ul class="allocation-flow__list">
      <li v-for="item in allocations" :key="item.name" class="allocation-flow__item">
        <span class="allocation-flow__item-name">{{ item.name }}</span>
        <span class="allocation-flow__item-value">{{ item.formatted }}</span>
        <span class="allocation-flow__item-share">{{ item.percent }} %</span>
      </li>
    </ul>

    <p class="allocation-flow__summary">{{ summary }}</p>
  </div>
</template>

<style scoped>
.allocation-flow {
  display: grid;
  gap: var(--hf-space-4);
  max-width: 28rem;
  padding: var(--hf-space-6);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

.allocation-flow__income {
  display: grid;
  gap: var(--hf-space-1);
}

.allocation-flow__income-name {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}

.allocation-flow__income-value {
  margin: 0;
  font-size: var(--hf-font-size-h2);
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--hf-color-brand);
}

.allocation-flow__arrow {
  color: var(--hf-color-text-muted);
  justify-self: center;
}

.allocation-flow__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--hf-space-3);
}

.allocation-flow__item {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: var(--hf-space-3);
  padding-top: var(--hf-space-3);
  border-top: 1px solid var(--hf-color-border);
}

.allocation-flow__item:first-child {
  padding-top: 0;
  border-top: none;
}

.allocation-flow__item-name {
  color: var(--hf-color-text);
}

.allocation-flow__item-value {
  font-variant-numeric: tabular-nums;
  font-weight: var(--hf-font-weight-semibold);
}

.allocation-flow__item-share {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.allocation-flow__summary {
  margin: 0;
  font-size: var(--hf-font-size-small);
  color: var(--hf-color-text-muted);
}
</style>
