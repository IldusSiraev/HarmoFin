<script setup lang="ts">
import { computed } from 'vue';
import { addDays, addMonths, format, startOfMonth, subMonths } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from '@lucide/vue';

import { buildCalendarGrid } from './calendar-grid.js';
import type { DayAggregate } from './day-aggregates.js';
import { formatCompactSigned, formatMinorUnits } from '../finance/money-format.js';

defineOptions({ name: 'PlansCalendar' });

const props = withDefaults(
  defineProps<{
    monthAnchor: string;
    selectedDate: string;
    today: string;
    aggregates: Record<string, DayAggregate>;
    loading?: boolean;
  }>(),
  { loading: false },
);

const emit = defineEmits<{
  'select-day': [date: string];
  'change-month': [monthAnchor: string];
}>();

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const grid = computed(() => buildCalendarGrid(props.monthAnchor));

const monthLabel = computed(() =>
  format(parsePlainDate(props.monthAnchor), 'LLLL yyyy', { locale: ru }),
);

// The worker only materialises plan occurrences up to today + 60 days
// (apps/worker/src/plan-occurrence.handler.ts). Navigating past that horizon
// would render an empty month that looks like "no plans at all".
const OCCURRENCE_HORIZON_DAYS = 60;

const nextMonthDisabled = computed(() => {
  const nextMonthStart = startOfMonth(addMonths(parsePlainDate(props.monthAnchor), 1));
  const horizon = addDays(parsePlainDate(props.today), OCCURRENCE_HORIZON_DAYS);
  return nextMonthStart > horizon;
});

function aggregateFor(date: string): DayAggregate | undefined {
  return props.aggregates[date];
}

function compactAmount(date: string): string | null {
  const aggregate = aggregateFor(date);
  if (!aggregate || aggregate.netMinor === 0n) return null;
  return formatCompactSigned(aggregate.netMinor.toString(), 2);
}

function amountTone(date: string): 'income' | 'expense' | null {
  const aggregate = aggregateFor(date);
  if (!aggregate || aggregate.netMinor === 0n) return null;
  return aggregate.netMinor > 0n ? 'income' : 'expense';
}

function dotFor(date: string): 'none' | 'upcoming' | 'overdue' {
  return aggregateFor(date)?.dot ?? 'none';
}

function cellLabel(date: string): string {
  const parts = [format(parsePlainDate(date), 'd MMMM yyyy, EEEE', { locale: ru })];

  if (date === props.today) parts.push('сегодня');
  if (date === props.selectedDate) parts.push('выбрано');

  // The visible cell text shows a compact amount (+106к), but an aria-label
  // overrides the accessible name computed from that text — so the label has to
  // carry the amount itself, not just its direction.
  const aggregate = aggregateFor(date);
  if (aggregate && aggregate.netMinor !== 0n) {
    const tone = aggregate.netMinor > 0n ? 'доход' : 'расход';
    parts.push(`${tone} ${formatMinorUnits(aggregate.netMinor.toString(), 'RUB', 2)}`);
  }

  const dot = dotFor(date);
  if (dot === 'overdue') parts.push('просроченный платёж');
  else if (dot === 'upcoming') parts.push('предстоящий платёж');

  return parts.join(', ');
}

function goToPreviousMonth() {
  emit('change-month', format(subMonths(parsePlainDate(props.monthAnchor), 1), 'yyyy-MM-dd'));
}

function goToNextMonth() {
  emit('change-month', format(addMonths(parsePlainDate(props.monthAnchor), 1), 'yyyy-MM-dd'));
}

function parsePlainDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year as number, (month as number) - 1, day as number);
}
</script>

<template>
  <div class="plans-calendar">
    <div class="plans-calendar__header">
      <button
        type="button"
        data-action="calendar-prev-month"
        class="plans-calendar__nav"
        aria-label="Предыдущий месяц"
        @click="goToPreviousMonth"
      >
        <ChevronLeft :size="20" aria-hidden="true" />
      </button>
      <p class="plans-calendar__month">{{ monthLabel }}</p>
      <button
        type="button"
        data-action="calendar-next-month"
        class="plans-calendar__nav"
        :aria-label="
          nextMonthDisabled
            ? 'Следующий месяц недоступен: планы рассчитаны на 60 дней вперёд'
            : 'Следующий месяц'
        "
        :disabled="nextMonthDisabled"
        @click="goToNextMonth"
      >
        <ChevronRight :size="20" aria-hidden="true" />
      </button>
    </div>

    <div class="plans-calendar__weekdays" aria-hidden="true">
      <span v-for="label in WEEKDAY_LABELS" :key="label">{{ label }}</span>
    </div>

    <div class="plans-calendar__grid" :aria-busy="loading">
      <button
        v-for="cell in grid"
        :key="cell.date"
        type="button"
        data-testid="calendar-cell"
        :data-date="cell.date"
        :data-in-month="cell.inCurrentMonth"
        class="plans-calendar__cell"
        :class="{
          'plans-calendar__cell--muted': !cell.inCurrentMonth,
          'plans-calendar__cell--today': cell.date === today,
          'plans-calendar__cell--selected': cell.date === selectedDate,
        }"
        :aria-label="cellLabel(cell.date)"
        @click="emit('select-day', cell.date)"
      >
        <span class="plans-calendar__day-number">{{ Number(cell.date.slice(-2)) }}</span>
        <span
          v-if="compactAmount(cell.date)"
          class="plans-calendar__amount"
          :class="`plans-calendar__amount--${amountTone(cell.date)}`"
        >
          {{ compactAmount(cell.date) }}
        </span>
        <span
          v-if="dotFor(cell.date) !== 'none'"
          class="plans-calendar__dot"
          :class="`plans-calendar__dot--${dotFor(cell.date)}`"
          aria-hidden="true"
        />
      </button>
    </div>

    <div class="plans-calendar__legend">
      <span class="plans-calendar__legend-item">
        <span class="plans-calendar__dot plans-calendar__dot--legend-income" aria-hidden="true" />
        Доход
      </span>
      <span class="plans-calendar__legend-item">
        <span class="plans-calendar__dot plans-calendar__dot--legend-expense" aria-hidden="true" />
        Расход
      </span>
      <span class="plans-calendar__legend-item">
        <span class="plans-calendar__dot plans-calendar__dot--upcoming" aria-hidden="true" />
        Планы
      </span>
    </div>
  </div>
</template>

<style scoped>
.plans-calendar {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.plans-calendar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.plans-calendar__month {
  margin: 0;
  font-weight: var(--hf-font-weight-semibold);
  text-transform: capitalize;
}
.plans-calendar__nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 0;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text-muted);
  cursor: pointer;
}
.plans-calendar__nav:hover {
  background: var(--hf-color-action-secondary-hover);
}
.plans-calendar__nav:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.plans-calendar__weekdays,
.plans-calendar__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: var(--hf-space-1);
}
.plans-calendar__grid[aria-busy='true'] {
  opacity: 0.6;
  pointer-events: none;
}
.plans-calendar__weekdays span {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  text-align: center;
}
.plans-calendar__cell {
  display: grid;
  gap: 0.125rem;
  justify-items: center;
  aspect-ratio: 1;
  padding: var(--hf-space-1);
  border: 1px solid transparent;
  border-radius: var(--hf-radius-md);
  background: transparent;
  cursor: pointer;
}
.plans-calendar__cell:hover {
  background: var(--hf-color-action-secondary-hover);
}
.plans-calendar__cell:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: -2px;
}
.plans-calendar__cell--muted {
  color: var(--hf-color-text-subtle);
}
.plans-calendar__cell--today .plans-calendar__day-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  background: var(--hf-color-brand);
  color: var(--hf-color-white);
}
.plans-calendar__cell--selected {
  border-color: var(--hf-color-text);
}
.plans-calendar__day-number {
  font-size: var(--hf-font-size-caption);
}
.plans-calendar__amount {
  font-size: 0.625rem;
  font-weight: var(--hf-font-weight-semibold);
  white-space: nowrap;
}
.plans-calendar__amount--income {
  color: var(--hf-color-status-success);
}
.plans-calendar__amount--expense {
  color: var(--hf-color-status-danger);
}
.plans-calendar__dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
}
.plans-calendar__dot--upcoming,
.plans-calendar__dot--legend-income {
  background: var(--hf-color-brand);
}
.plans-calendar__dot--overdue,
.plans-calendar__dot--legend-expense {
  background: var(--hf-color-status-danger);
}
.plans-calendar__dot--legend-income {
  background: var(--hf-color-status-success);
}
.plans-calendar__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-4);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}
.plans-calendar__legend-item {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
}
@media (max-width: 47.9375rem) {
  .plans-calendar__day-number {
    font-size: 0.625rem;
  }
  .plans-calendar__amount {
    font-size: 0.5625rem;
  }
}
</style>
