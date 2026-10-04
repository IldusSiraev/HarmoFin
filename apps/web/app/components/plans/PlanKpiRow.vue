<script setup lang="ts">
import type { PlansCalendarTotals } from '../../composables/useEnvelopePlanV2.js';
import FinanceMoney from '../finance/FinanceMoney.vue';

defineOptions({ name: 'PlanKpiRow' });

defineProps<{ totals: PlansCalendarTotals }>();
</script>

<template>
  <section class="kpi-row" aria-label="План месяца">
    <div class="kpi-row__tile" data-testid="kpi-planned-income">
      <p class="kpi-row__label">Плановые доходы</p>
      <FinanceMoney :minor-units="totals.plannedIncomeMinor" currency="RUB" :scale="2" />
      <p class="kpi-row__note">План месяца, не факт</p>
    </div>
    <div class="kpi-row__tile" data-testid="kpi-planned-expense">
      <p class="kpi-row__label">Плановые расходы</p>
      <FinanceMoney :minor-units="totals.plannedExpenseMinor" currency="RUB" :scale="2" />
      <p class="kpi-row__note">План месяца, не факт</p>
    </div>
    <div class="kpi-row__tile" data-testid="kpi-balance">
      <p class="kpi-row__label">Баланс</p>
      <FinanceMoney :minor-units="totals.balanceMinor" currency="RUB" :scale="2" />
      <p class="kpi-row__note">Плановые доходы минус расходы</p>
    </div>
    <div class="kpi-row__tile" data-testid="kpi-total-plans">
      <p class="kpi-row__label">Всего планов</p>
      <p class="kpi-row__count">{{ totals.activePlanCount }}</p>
      <p class="kpi-row__note">Активные платежи и доходы</p>
    </div>
  </section>
</template>

<style scoped>
.kpi-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--hf-space-3);
}
.kpi-row__tile {
  display: grid;
  gap: var(--hf-space-1);
  padding: var(--hf-space-3) var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}
.kpi-row__label,
.kpi-row__note {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
.kpi-row__count {
  margin: 0;
  font-size: var(--hf-font-size-body);
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}
@media (min-width: 64rem) {
  .kpi-row {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
