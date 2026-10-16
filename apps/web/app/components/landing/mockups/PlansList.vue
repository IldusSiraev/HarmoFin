<script setup lang="ts">
import LandingMetric from '../ui/LandingMetric.vue';
import { formatLandingMoney } from '../format-money.js';
import { upcomingPlans } from '../../../data/landing.js';

defineOptions({ name: 'PlansList' });
</script>

<template>
  <div class="plans-list">
    <div class="plans-list__card">
      <h3 class="plans-list__title">Ближайшие обязательные платежи</h3>
      <ul class="plans-list__items">
        <li
          v-for="plan in upcomingPlans.items"
          :key="`${plan.dateLabel}-${plan.name}`"
          class="plans-list__row"
          data-testid="plan-row"
        >
          <span class="plans-list__date">{{ plan.dateLabel }}</span>
          <span class="plans-list__name">{{ plan.name }}</span>
          <span class="plans-list__amount">{{ formatLandingMoney(plan.amountMinor) }}</span>
        </li>
      </ul>
    </div>

    <div class="plans-list__reserve">
      <LandingMetric
        label="На обязательные платежи"
        :value="formatLandingMoney(upcomingPlans.reservedMinor)"
        caption="Плановый остаток зарезервирован"
      />
    </div>
  </div>
</template>

<style scoped>
.plans-list {
  display: grid;
  gap: var(--hf-space-4);
}

.plans-list__card {
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-xs);
}

.plans-list__title {
  margin: 0 0 var(--hf-space-3);
  font-size: var(--hf-font-size-body);
  font-weight: var(--hf-font-weight-semibold);
}

.plans-list__items {
  margin: 0;
  padding: 0;
  list-style: none;
}

.plans-list__row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--hf-space-3);
  padding-block: var(--hf-space-3);
  border-top: 1px solid var(--hf-color-border);
}

.plans-list__row:first-child {
  padding-top: 0;
  border-top: none;
}

.plans-list__date {
  grid-column: 1 / -1;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.plans-list__amount {
  font-variant-numeric: tabular-nums;
  font-weight: var(--hf-font-weight-semibold);
  justify-self: end;
}

.plans-list__reserve {
  padding: var(--hf-card-padding);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-brand-soft);
}

@media (min-width: 480px) {
  .plans-list__row {
    grid-template-columns: auto 1fr auto;
  }

  .plans-list__date {
    grid-column: auto;
  }
}

@media (min-width: 1024px) {
  .plans-list {
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
    gap: var(--hf-space-6);
  }
}
</style>
