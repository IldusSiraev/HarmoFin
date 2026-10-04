<script setup lang="ts">
import FinanceMoney from '../finance/FinanceMoney.vue';
import type { PlanVsActualRowDto } from '../../composables/useBudgetReferenceData.js';

defineProps<{ rows: ReadonlyArray<PlanVsActualRowDto> }>();

function planTypeLabel(type: PlanVsActualRowDto['planType']) {
  return type === 'INCOME' ? 'Доход' : 'Расход';
}

function journalHref(row: PlanVsActualRowDto) {
  const query = new URLSearchParams(row.journalFilters ?? {});
  return `/app/operations?${query}`;
}
</script>

<template>
  <section class="plan-vs-actual" aria-labelledby="plan-vs-actual-title">
    <div class="plan-vs-actual__heading">
      <h2 id="plan-vs-actual-title">План и факт</h2>
      <p>Суммы и отклонения рассчитаны по подтверждённым операциям.</p>
    </div>
    <p v-if="rows.length === 0" class="plan-vs-actual__empty">
      Нет плановых операций за выбранный период.
    </p>
    <div
      v-else
      class="plan-vs-actual__table-wrap"
      role="region"
      aria-labelledby="plan-vs-actual-title"
      tabindex="0"
    >
      <table>
        <thead>
          <tr>
            <th scope="col">Название</th>
            <th scope="col">План</th>
            <th scope="col">Факт</th>
            <th scope="col">Отклонение</th>
            <th scope="col">Выполнено</th>
            <th scope="col">Операции</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.planId">
            <th scope="row">
              <span>{{ row.planName }}</span>
              <small>{{ planTypeLabel(row.planType) }}</small>
            </th>
            <td><FinanceMoney :minor-units="row.plannedMinor" currency="RUB" :scale="2" /></td>
            <td><FinanceMoney :minor-units="row.actualMinor" currency="RUB" :scale="2" /></td>
            <td><FinanceMoney :minor-units="row.varianceMinor" currency="RUB" :scale="2" /></td>
            <td>{{ row.confirmedOccurrenceCount }} из {{ row.plannedOccurrenceCount }}</td>
            <td>
              <NuxtLink v-if="row.journalFilters" :to="journalHref(row)" data-journal-link
                >Открыть журнал</NuxtLink
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.plan-vs-actual {
  display: grid;
  gap: var(--hf-space-4);
}
.plan-vs-actual__heading h2,
.plan-vs-actual__heading p,
.plan-vs-actual__empty {
  margin: 0;
}
.plan-vs-actual__heading h2 {
  font-size: 1.25rem;
}
.plan-vs-actual__heading p,
.plan-vs-actual__empty,
.plan-vs-actual small {
  color: var(--hf-color-text-muted);
}
.plan-vs-actual__table-wrap {
  overflow-x: auto;
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
}
.plan-vs-actual__table-wrap:focus-visible {
  box-shadow: var(--hf-focus-indicator);
  outline-offset: 2px;
}
table {
  width: 100%;
  min-width: 52rem;
  border-collapse: collapse;
}
th,
td {
  padding: var(--hf-space-3);
  border-bottom: 1px solid var(--hf-color-border);
  text-align: left;
  vertical-align: top;
}
thead th {
  color: var(--hf-color-text-muted);
  font-size: 0.8rem;
  font-weight: var(--hf-font-weight-semibold);
}
tbody th {
  min-width: 11rem;
  font-weight: var(--hf-font-weight-semibold);
}
tbody th span,
tbody th small {
  display: block;
}
td {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
tbody tr:last-child th,
tbody tr:last-child td {
  border-bottom: 0;
}
a {
  color: var(--hf-color-action-primary-hover);
  font-weight: var(--hf-font-weight-bold);
}
</style>
