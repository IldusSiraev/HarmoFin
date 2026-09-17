<script setup lang="ts">
import type { DashboardSummaryDto } from '../../composables/useBudgetReferenceData.js';
import FinanceMoney from '../finance/FinanceMoney.vue';

defineProps<{
  items: DashboardSummaryDto['upcomingObligations'];
}>();
</script>

<template>
  <section class="upcoming-obligations" aria-labelledby="upcoming-obligations-title">
    <h2 id="upcoming-obligations-title">Ближайшие обязательства</h2>
    <p v-if="items.length === 0" class="upcoming-obligations__empty">Ближайших обязательств нет.</p>
    <ul v-else>
      <li v-for="item in items" :key="item.occurrenceId">
        <div>
          <strong>{{ item.planName }}</strong>
          <span>{{ item.scheduledOn }}</span>
        </div>
        <FinanceMoney :minor-units="item.amountMinor" currency="RUB" :scale="2" />
        <span class="upcoming-obligations__status">{{
          item.status === 'DUE' ? 'Сегодня' : 'Предстоящее'
        }}</span>
        <NuxtLink :to="item.actionPath">Открыть план</NuxtLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.upcoming-obligations {
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.upcoming-obligations h2,
.upcoming-obligations p,
.upcoming-obligations ul {
  margin: 0;
}
.upcoming-obligations ul {
  display: grid;
  gap: var(--hf-space-3);
  padding: 0;
  list-style: none;
}
.upcoming-obligations li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  gap: var(--hf-space-3);
  align-items: center;
  padding-top: var(--hf-space-3);
  border-top: 1px solid var(--hf-color-border);
}
.upcoming-obligations li div {
  display: grid;
  gap: var(--hf-space-1);
}
.upcoming-obligations li div span,
.upcoming-obligations__empty {
  color: var(--hf-color-text-muted);
}
.upcoming-obligations__status {
  color: var(--hf-color-text-danger);
  font-weight: var(--hf-font-weight-bold);
}
.upcoming-obligations a {
  color: var(--hf-color-action-primary-hover);
  font-weight: var(--hf-font-weight-bold);
}
@media (max-width: 47.9375rem) {
  .upcoming-obligations li {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .upcoming-obligations__status,
  .upcoming-obligations a {
    grid-column: 1 / -1;
  }
}
</style>
