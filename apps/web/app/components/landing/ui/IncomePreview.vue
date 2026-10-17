<script setup lang="ts">
import FinanceMoney from '../../finance/FinanceMoney.vue';
import { demoIncome } from '../../../data/landing-demo.js';

defineOptions({ name: 'IncomePreview' });
</script>

<template>
  <div class="income-preview">
    <p class="income-preview__title">Распределить деньги</p>
    <p class="income-preview__source">
      {{ demoIncome.name }}
      <FinanceMoney
        class="income-preview__amount"
        :minor-units="demoIncome.amountMinor"
        currency="RUB"
        :scale="2"
      />
    </p>
    <ul class="income-preview__lines">
      <li v-for="line in demoIncome.lines" :key="line.name" class="income-preview__line">
        <span>{{ line.name }}</span>
        <FinanceMoney :minor-units="line.amountMinor" currency="RUB" :scale="2" />
      </li>
    </ul>
    <p class="income-preview__remaining">
      <span>Осталось распределить</span>
      <FinanceMoney :minor-units="demoIncome.remainingMinor" currency="RUB" :scale="2" />
    </p>
    <div class="income-preview__actions" aria-hidden="true">
      <span class="income-preview__button income-preview__button--secondary">Позже</span>
      <span class="income-preview__button income-preview__button--primary"
        >Распределить как предложено</span
      >
    </div>
  </div>
</template>

<style scoped>
.income-preview {
  display: grid;
  gap: var(--hf-space-3);
}

.income-preview__title {
  margin: 0;
  font-weight: var(--hf-font-weight-semibold);
}

.income-preview__source {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 0;
  color: var(--hf-color-text-muted);
}

.income-preview__amount {
  font-size: var(--hf-font-size-h3);
  font-weight: var(--hf-font-weight-bold);
  color: var(--hf-color-text);
}

.income-preview__lines {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.income-preview__line,
.income-preview__remaining {
  display: flex;
  justify-content: space-between;
  gap: var(--hf-space-3);
  margin: 0;
  padding: var(--hf-space-2) 0;
  border-bottom: 1px solid var(--hf-color-border);
}

.income-preview__remaining {
  border-bottom: 0;
  font-weight: var(--hf-font-weight-semibold);
}

.income-preview__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--hf-space-2);
}

.income-preview__button {
  padding: var(--hf-space-2) var(--hf-space-4);
  border-radius: var(--hf-radius-md);
  font-weight: var(--hf-font-weight-semibold);
}

.income-preview__button--secondary {
  border: 1px solid var(--hf-color-border);
  color: var(--hf-color-text);
}

.income-preview__button--primary {
  background: var(--hf-color-action-primary);
  color: var(--hf-color-white);
}
</style>
