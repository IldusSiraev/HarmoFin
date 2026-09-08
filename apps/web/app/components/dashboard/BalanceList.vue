<script setup lang="ts">
import type {
  DashboardBalance,
  DashboardWarning,
} from '../../composables/useBudgetReferenceData.js';
import FinanceMoney from '../finance/FinanceMoney.vue';

defineProps<{
  title: string;
  items: ReadonlyArray<DashboardBalance>;
  warnings: ReadonlyArray<DashboardWarning>;
  subject: DashboardWarning['subject'];
}>();
</script>

<template>
  <section class="balance-list" :aria-label="title">
    <h2>{{ title }}</h2>
    <p v-if="items.length === 0" class="balance-list__empty">Данных пока нет.</p>
    <ul v-else>
      <li v-for="item in items" :key="item.id">
        <span>{{ item.name }}</span>
        <FinanceMoney :minor-units="item.balanceMinor" currency="RUB" :scale="2" />
        <span
          v-if="warnings.some((warning) => warning.subject === subject && warning.id === item.id)"
          class="balance-list__warning"
          >Дефицит</span
        >
      </li>
    </ul>
  </section>
</template>

<style scoped>
.balance-list {
  padding: var(--hf-card-padding);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.balance-list h2,
.balance-list p,
.balance-list ul {
  margin: 0;
}
.balance-list ul {
  display: grid;
  gap: var(--hf-space-3);
  padding: 0;
  list-style: none;
}
.balance-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: var(--hf-space-3);
  align-items: center;
  padding-top: var(--hf-space-3);
  border-top: 1px solid var(--hf-color-border);
}
.balance-list__empty {
  margin-top: var(--hf-space-4);
  color: var(--hf-color-text-muted);
}
.balance-list__warning {
  color: var(--hf-color-text-danger);
  font-weight: var(--hf-font-weight-bold);
}
</style>
