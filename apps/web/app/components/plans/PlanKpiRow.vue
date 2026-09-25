<script setup lang="ts">
import FinanceMoney from '../finance/FinanceMoney.vue';

defineOptions({ name: 'PlanKpiRow' });

defineProps<{
  plannedIncomeMinor: string;
  plannedExpenseMinor: string;
  balanceMinor: string;
  totalPlans: number;
}>();
</script>

<template>
  <div class="plan-kpi-row">
    <article class="plan-kpi-row__tile">
      <p class="plan-kpi-row__label">Плановые доходы</p>
      <FinanceMoney
        class="plan-kpi-row__value plan-kpi-row__value--income"
        :minor-units="plannedIncomeMinor"
        currency="RUB"
        :scale="2"
      />
    </article>
    <article class="plan-kpi-row__tile">
      <p class="plan-kpi-row__label">Плановые расходы</p>
      <FinanceMoney
        class="plan-kpi-row__value plan-kpi-row__value--expense"
        :minor-units="`-${plannedExpenseMinor}`"
        currency="RUB"
        :scale="2"
      />
    </article>
    <article class="plan-kpi-row__tile">
      <p class="plan-kpi-row__label">Баланс</p>
      <FinanceMoney
        class="plan-kpi-row__value"
        :minor-units="balanceMinor"
        currency="RUB"
        :scale="2"
      />
    </article>
    <article class="plan-kpi-row__tile">
      <p class="plan-kpi-row__label">Всего планов</p>
      <span class="plan-kpi-row__value">{{ totalPlans }}</span>
    </article>
  </div>
</template>

<style scoped>
.plan-kpi-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--hf-space-4);
}
.plan-kpi-row__tile {
  display: grid;
  min-width: 0;
  gap: var(--hf-space-1);
  padding: var(--hf-card-padding);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.plan-kpi-row__label {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.plan-kpi-row__value {
  min-width: 0;
  font-size: 1.5rem;
  font-weight: var(--hf-font-weight-semibold);
}
.plan-kpi-row__value--income {
  color: var(--hf-color-status-success);
}
.plan-kpi-row__value--expense {
  color: var(--hf-color-status-danger);
}
@media (max-width: 47.9375rem) {
  .plan-kpi-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
/* Intl.NumberFormat('ru-RU') joins the thousands groups and the currency
   symbol with non-breaking spaces, so a large value like "-36 000,00 ₽"
   can't wrap — it needs a wide enough tile instead. Two tiles per row don't
   leave room for that on a phone, so drop to one column below tablet width. */
@media (max-width: 30rem) {
  .plan-kpi-row {
    grid-template-columns: 1fr;
  }
}
</style>
