<script setup lang="ts">
import type { GenericReportDto } from '../../composables/useBudgetReferenceData.js';
import { dateLabel } from './date-label.js';
import { formatMinorUnits } from '../finance/money-format.js';
import { journalHref } from './journal-href.js';

defineProps<{
  rows: ReadonlyArray<GenericReportDto['rows'][number]>;
  hideJournal?: boolean;
}>();

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function title(row: Record<string, unknown>) {
  const value =
    stringValue(row.categoryName) ||
    stringValue(row.name) ||
    stringValue(row.cycleStart) ||
    stringValue(row.periodStart) ||
    stringValue(row.effectiveOn) ||
    'Показатель';
  return ISO_DATE_RE.test(value) ? dateLabel(value) : value;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function amount(row: Record<string, unknown>) {
  const value = Object.entries(row).find(
    ([key, candidate]) => key.endsWith('Minor') && typeof candidate === 'string',
  )?.[1];
  return typeof value === 'string' ? formatMinorUnits(value, 'RUB', 2) : '—';
}
</script>

<template>
  <div class="report-table-wrap">
    <table class="report-table">
      <thead>
        <tr>
          <th scope="col">Показатель</th>
          <th scope="col">Сумма</th>
          <th v-if="!hideJournal" scope="col">Операции</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in rows" :key="`${title(row)}-${index}`">
          <td>{{ title(row) }}</td>
          <td>{{ amount(row) }}</td>
          <td v-if="!hideJournal">
            <NuxtLink :to="journalHref(row)" data-journal-link>Открыть</NuxtLink>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.report-table-wrap {
  overflow-x: auto;
}
.report-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--hf-color-surface);
}
.report-table th,
.report-table td {
  padding: var(--hf-space-3);
  text-align: left;
  border-bottom: 1px solid var(--hf-color-border);
}
.report-table th {
  color: var(--hf-color-text-muted);
  font-size: 0.8rem;
}
.report-table td:nth-child(2) {
  font-variant-numeric: tabular-nums;
}
.report-table a {
  color: var(--hf-color-action-primary-hover);
  font-weight: var(--hf-font-weight-bold);
}
</style>
