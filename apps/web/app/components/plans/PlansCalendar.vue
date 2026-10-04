<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { addDays, addMonths, format, startOfMonth, subMonths } from 'date-fns';
import { ru } from 'date-fns/locale';
import { AlertTriangle, ChevronLeft, ChevronRight, Circle } from '@lucide/vue';

import type { PlansCalendarDay } from '../../composables/useEnvelopePlanV2.js';
import { formatCompactSigned, formatMinorUnits } from '../finance/money-format.js';
import { buildCalendarGrid } from './calendar-grid.js';

defineOptions({ name: 'PlansCalendar' });

const props = withDefaults(
  defineProps<{
    monthAnchor: string;
    selectedDate: string;
    today: string;
    days: ReadonlyArray<PlansCalendarDay>;
    loading?: boolean;
  }>(),
  { loading: false },
);

const emit = defineEmits<{
  'select-day': [date: string];
  'change-month': [monthAnchor: string];
}>();

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
// The worker materialises occurrences up to today + 60 days; a month past that
// would look like "no plans at all".
const HORIZON_DAYS = 60;

const root = ref<HTMLElement | null>(null);
const grid = computed(() => buildCalendarGrid(props.monthAnchor));
const dayByDate = computed(() => new Map(props.days.map((day) => [day.date, day])));
const monthLabel = computed(() =>
  format(parsePlainDate(props.monthAnchor), 'LLLL yyyy', { locale: ru }),
);
const nextMonthDisabled = computed(
  () =>
    startOfMonth(addMonths(parsePlainDate(props.monthAnchor), 1)) >
    addDays(parsePlainDate(props.today), HORIZON_DAYS),
);
// The selected day, or the first day of the month, is the single tab stop.
const tabStop = computed(() =>
  grid.value.some((cell) => cell.inCurrentMonth && cell.date === props.selectedDate)
    ? props.selectedDate
    : (grid.value.find((cell) => cell.inCurrentMonth)?.date ?? ''),
);

function parsePlainDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year as number, (month as number) - 1, day as number);
}

function incomeText(date: string): string | null {
  const day = dayByDate.value.get(date);
  return day && day.incomeMinor !== '0' ? formatCompactSigned(day.incomeMinor, 2) : null;
}

function expenseText(date: string): string | null {
  const day = dayByDate.value.get(date);
  return day && day.expenseMinor !== '0' ? formatCompactSigned(`-${day.expenseMinor}`, 2) : null;
}

function cellLabel(date: string): string {
  const parts = [format(parsePlainDate(date), 'd MMMM yyyy, EEEE', { locale: ru })];
  if (date === props.today) parts.push('сегодня');
  const day = dayByDate.value.get(date);
  // The visible text is compact (+43к); an aria-label replaces it, so carry the amounts.
  if (day && day.incomeMinor !== '0')
    parts.push(`доход ${formatMinorUnits(day.incomeMinor, 'RUB', 2)}`);
  if (day && day.expenseMinor !== '0')
    parts.push(`расход ${formatMinorUnits(day.expenseMinor, 'RUB', 2)}`);
  if (day?.dot === 'overdue') parts.push('просроченный платёж');
  else if (day?.dot === 'upcoming') parts.push('предстоящий платёж');
  return parts.join(', ');
}

function monthAnchorOf(delta: 1 | -1): string {
  const base = parsePlainDate(props.monthAnchor);
  return format(delta === 1 ? addMonths(base, 1) : subMonths(base, 1), 'yyyy-MM-dd');
}

const KEY_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

function handleKeydown(event: KeyboardEvent, date: string): void {
  const step = KEY_STEPS[event.key];
  if (step === undefined) return;
  event.preventDefault();
  const target = format(addDays(parsePlainDate(date), step), 'yyyy-MM-dd');
  const inMonth = grid.value.some((cell) => cell.inCurrentMonth && cell.date === target);
  if (!inMonth) return;
  emit('select-day', target);
  void nextTick(() =>
    root.value?.querySelector<HTMLElement>(`[data-testid="calendar-day-${target}"]`)?.focus(),
  );
}
</script>

<template>
  <div ref="root" class="plans-calendar">
    <div class="plans-calendar__header">
      <button
        type="button"
        class="plans-calendar__nav"
        data-testid="calendar-prev-month"
        aria-label="Предыдущий месяц"
        @click="emit('change-month', monthAnchorOf(-1))"
      >
        <ChevronLeft :size="20" aria-hidden="true" />
      </button>
      <p class="plans-calendar__month" aria-live="polite">{{ monthLabel }}</p>
      <button
        type="button"
        class="plans-calendar__nav"
        data-testid="calendar-next-month"
        :aria-label="
          nextMonthDisabled
            ? 'Следующий месяц недоступен: планы рассчитаны на 60 дней вперёд'
            : 'Следующий месяц'
        "
        :disabled="nextMonthDisabled"
        @click="emit('change-month', monthAnchorOf(1))"
      >
        <ChevronRight :size="20" aria-hidden="true" />
      </button>
    </div>

    <div class="plans-calendar__weekdays" aria-hidden="true">
      <span v-for="label in WEEKDAY_LABELS" :key="label">{{ label }}</span>
    </div>

    <div
      class="plans-calendar__grid"
      data-testid="calendar-grid"
      role="group"
      aria-label="Дни месяца"
      :aria-busy="loading"
    >
      <button
        v-for="cell in grid"
        :key="cell.date"
        type="button"
        class="plans-calendar__cell"
        :class="{
          'plans-calendar__cell--outside': !cell.inCurrentMonth,
          'plans-calendar__cell--today': cell.date === today,
          'plans-calendar__cell--selected': cell.date === selectedDate,
        }"
        :data-testid="`calendar-day-${cell.date}`"
        :disabled="!cell.inCurrentMonth"
        :tabindex="cell.date === tabStop ? 0 : -1"
        :aria-label="cell.inCurrentMonth ? cellLabel(cell.date) : undefined"
        :aria-pressed="cell.inCurrentMonth ? cell.date === selectedDate : undefined"
        @click="emit('select-day', cell.date)"
        @keydown="handleKeydown($event, cell.date)"
      >
        <span class="plans-calendar__num">{{ Number(cell.date.slice(8)) }}</span>
        <template v-if="cell.inCurrentMonth">
          <span
            v-if="incomeText(cell.date)"
            class="plans-calendar__amount plans-calendar__amount--income"
          >
            {{ incomeText(cell.date) }}
          </span>
          <span
            v-if="incomeText(cell.date)"
            class="plans-calendar__sign plans-calendar__sign--income"
            aria-hidden="true"
          >
            {{ '+' }}
          </span>
          <span
            v-if="expenseText(cell.date)"
            class="plans-calendar__amount plans-calendar__amount--expense"
          >
            {{ expenseText(cell.date) }}
          </span>
          <span
            v-if="expenseText(cell.date)"
            class="plans-calendar__sign plans-calendar__sign--expense"
            aria-hidden="true"
          >
            {{ '−' }}
          </span>
          <span
            v-if="dayByDate.get(cell.date)?.dot"
            class="plans-calendar__marker"
            :class="`plans-calendar__marker--${dayByDate.get(cell.date)?.dot}`"
            :data-testid="`calendar-dot-${cell.date}`"
            :data-dot="dayByDate.get(cell.date)?.dot"
            aria-hidden="true"
          >
            <AlertTriangle v-if="dayByDate.get(cell.date)?.dot === 'overdue'" :size="12" />
            <Circle v-else :size="8" fill="currentColor" />
          </span>
        </template>
      </button>
    </div>
  </div>
</template>

<style scoped>
.plans-calendar {
  display: grid;
  gap: var(--hf-space-2);
  padding: var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
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
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border: none;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text);
  cursor: pointer;
}
.plans-calendar__nav:disabled {
  color: var(--hf-color-text-muted);
  cursor: not-allowed;
}
.plans-calendar__nav:focus-visible,
.plans-calendar__cell:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}
.plans-calendar__weekdays,
.plans-calendar__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: var(--hf-space-1);
}
/* Every row has the same fixed height, so a cell with amounts and a marker is no taller than an empty one. */
.plans-calendar__grid {
  grid-auto-rows: 5.25rem;
}
.plans-calendar__weekdays {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  text-align: center;
}
.plans-calendar__cell {
  display: grid;
  align-content: start;
  justify-items: center;
  gap: 2px;
  min-width: 0;
  height: 100%;
  min-height: 2.75rem;
  padding: var(--hf-space-1);
  border: 2px solid transparent;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text);
  font: inherit;
  cursor: pointer;
}
.plans-calendar__cell:disabled {
  cursor: default;
  opacity: 0.35;
}
.plans-calendar__cell--today .plans-calendar__num {
  font-weight: var(--hf-font-weight-semibold);
  text-decoration: underline;
}
.plans-calendar__cell--selected {
  border: 2px solid var(--hf-color-action-primary);
  background: var(--hf-color-surface-subtle);
}
.plans-calendar__amount {
  max-width: 100%;
  font-size: var(--hf-font-size-small);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* Contrast: the success colour is below 4.5:1 as text; the "+" sign carries the meaning. */
.plans-calendar__amount--income {
  color: var(--hf-color-text);
}
.plans-calendar__sign {
  display: none;
  font-size: 0.75rem;
  font-weight: var(--hf-font-weight-semibold);
  line-height: 1;
}
.plans-calendar__sign--income {
  color: var(--hf-color-text);
}
.plans-calendar__sign--expense {
  color: var(--hf-color-status-danger);
}
.plans-calendar__amount--expense {
  color: var(--hf-color-status-danger);
}
.plans-calendar__marker--overdue {
  color: var(--hf-color-text-danger);
}
.plans-calendar__marker--upcoming {
  color: var(--hf-color-status-info);
}
@media (max-width: 30rem) {
  .plans-calendar__grid {
    grid-auto-rows: 4.5rem;
  }
  /* On a phone the cell is narrow: show a sign glyph instead of amounts; the aria-label and the day panel carry the values. */
  .plans-calendar__amount {
    display: none;
  }
  .plans-calendar__sign {
    display: inline;
  }
}
</style>
