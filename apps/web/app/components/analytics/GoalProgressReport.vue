<script setup lang="ts">
import FinanceMoney from '../finance/FinanceMoney.vue';
import type { GoalProgressRowDto } from '../../composables/useBudgetReferenceData.js';

const props = defineProps<{ rows: ReadonlyArray<GoalProgressRowDto> }>();

function deadlineText(row: GoalProgressRowDto) {
  if (!row.targetDate) return 'Срок не указан';
  if (row.daysRemaining === null) return `Целевая дата: ${row.targetDate}`;
  if (row.daysRemaining < 0) return `Просрочено на ${Math.abs(row.daysRemaining)} дн.`;
  if (row.daysRemaining === 0) return 'Срок сегодня';
  return `Осталось дней: ${row.daysRemaining}`;
}

function progressText(row: GoalProgressRowDto) {
  return `Прогресс: ${row.progressPermille} из 1000`;
}

function journalHref(row: GoalProgressRowDto) {
  const query = new URLSearchParams(row.journalFilters);
  return `/app/operations?${query}`;
}
</script>

<template>
  <section class="goal-progress" aria-labelledby="goal-progress-title">
    <div class="goal-progress__heading">
      <h2 id="goal-progress-title">Цели накоплений</h2>
      <p>Прогресс рассчитан сервером по подтверждённым операциям.</p>
    </div>
    <p v-if="props.rows.length === 0" class="goal-progress__empty">
      Нет активных целей накоплений.
    </p>
    <div
      v-else
      class="goal-progress__table-wrap"
      role="region"
      aria-labelledby="goal-progress-title"
      tabindex="0"
    >
      <table>
        <thead>
          <tr>
            <th scope="col">Цель</th>
            <th scope="col">Прогресс</th>
            <th scope="col">Осталось</th>
            <th scope="col">Срок</th>
            <th scope="col">Операции</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in props.rows" :key="row.envelopeId">
            <th scope="row">
              <span>{{ row.name }}</span>
              <small>{{ row.isReached ? 'Цель достигнута' : 'В процессе' }}</small>
            </th>
            <td>
              <progress
                :value="row.progressPermille"
                max="1000"
                :aria-valuetext="progressText(row)"
              />
              <span class="goal-progress__amounts">
                <FinanceMoney :minor-units="row.currentMinor" currency="RUB" :scale="2" />
                из
                <FinanceMoney :minor-units="row.targetMinor" currency="RUB" :scale="2" />
              </span>
            </td>
            <td><FinanceMoney :minor-units="row.remainingMinor" currency="RUB" :scale="2" /></td>
            <td
              :class="{
                'goal-progress__overdue': row.daysRemaining !== null && row.daysRemaining < 0,
              }"
            >
              {{ deadlineText(row) }}
            </td>
            <td>
              <NuxtLink :to="journalHref(row)">Открыть журнал</NuxtLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.goal-progress {
  display: grid;
  gap: var(--hf-space-4);
}
.goal-progress__heading h2,
.goal-progress__heading p,
.goal-progress__empty {
  margin: 0;
}
.goal-progress__heading h2 {
  font-size: 1.25rem;
}
.goal-progress__heading p,
.goal-progress__empty,
.goal-progress small {
  color: var(--hf-color-text-muted);
}
.goal-progress__table-wrap {
  overflow-x: auto;
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
}
.goal-progress__table-wrap:focus-visible {
  outline: var(--hf-focus-indicator);
  outline-offset: 2px;
}
table {
  width: 100%;
  min-width: 49rem;
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
  min-width: 10rem;
  font-weight: var(--hf-font-weight-semibold);
}
tbody th span,
tbody th small,
.goal-progress__amounts {
  display: block;
}
td {
  font-variant-numeric: tabular-nums;
}
progress {
  width: min(14rem, 100%);
  accent-color: var(--hf-color-action-primary);
}
.goal-progress__amounts {
  margin-top: var(--hf-space-1);
  white-space: nowrap;
}
.goal-progress__overdue {
  color: var(--hf-color-text-danger);
  font-weight: var(--hf-font-weight-semibold);
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
