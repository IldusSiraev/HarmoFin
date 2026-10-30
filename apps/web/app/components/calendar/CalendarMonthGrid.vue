<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

import type { CalendarFeedItem } from '../../composables/useFamilyCalendar.js';
import CalendarItemLine from './CalendarItemLine.vue';
import { addIsoDays, groupByDay, monthGrid, monthTitle } from './calendar-dates.js';

const props = defineProps<{ month: string; today: string; items: CalendarFeedItem[] }>();
const emit = defineEmits<{ openDay: [date: string] }>();

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const VISIBLE_LINES = 3;
const STEPS: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };

const weeks = computed(() => monthGrid(props.month));
const byDay = computed(() => groupByDay(props.items));
const initialFocus = () =>
  props.today.startsWith(props.month) ? props.today : `${props.month}-01`;
// Roving tabindex: one day of the grid is in the tab order at a time.
const focused = ref(initialFocus());
const grid = ref<HTMLElement | null>(null);

watch(
  () => props.month,
  () => {
    focused.value = initialFocus();
  },
);

function dayItems(date: string): CalendarFeedItem[] {
  return byDay.value.get(date) ?? [];
}

function itemKey(item: CalendarFeedItem): string {
  return item.kind === 'EVENT' ? `${item.eventId}:${item.occurrenceDate}` : item.occurrenceId;
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function dayLabel(date: string): string {
  const items = dayItems(date);
  const events = items.filter((item) => item.kind === 'EVENT').length;
  const plans = items.length - events;
  const parts = [format(new Date(`${date}T12:00:00Z`), 'd MMMM', { locale: ru })];
  if (events > 0) parts.push(`${events} ${plural(events, 'событие', 'события', 'событий')}`);
  if (plans > 0) parts.push(`${plans} ${plural(plans, 'платёж', 'платежа', 'платежей')}`);
  const overdue = items.filter((item) => item.kind === 'PLAN' && item.isOverdue).length;
  if (overdue > 0) {
    parts.push(`${overdue} ${plural(overdue, 'просрочен', 'просрочено', 'просрочено')}`);
  }
  return parts.join(', ');
}

async function move(date: string, days: number): Promise<void> {
  const target = addIsoDays(date, days);
  if (!weeks.value.flat().includes(target)) return;
  focused.value = target;
  await nextTick();
  grid.value?.querySelector<HTMLElement>(`[data-date="${target}"]`)?.focus();
}

function onKeydown(event: KeyboardEvent, date: string): void {
  const step = STEPS[event.key];
  if (step !== undefined) {
    event.preventDefault();
    void move(date, step);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    emit('openDay', date);
  }
}
</script>

<template>
  <div ref="grid" class="calendar-month" role="grid" :aria-label="monthTitle(month)">
    <div class="calendar-month__row" role="row">
      <span
        v-for="weekday in WEEKDAYS"
        :key="weekday"
        class="calendar-month__weekday"
        role="columnheader"
      >
        {{ weekday }}
      </span>
    </div>
    <div v-for="week in weeks" :key="week[0]" class="calendar-month__row" role="row">
      <div
        v-for="date in week"
        :key="date"
        class="calendar-month__day"
        :class="{ 'calendar-month__day--outside': !date.startsWith(month) }"
        role="gridcell"
        :data-date="date"
        :tabindex="date === focused ? 0 : -1"
        :aria-label="dayLabel(date)"
        :aria-current="date === today ? 'date' : undefined"
        @click="emit('openDay', date)"
        @keydown="onKeydown($event, date)"
        @focus="focused = date"
      >
        <span
          class="calendar-month__number"
          :class="{ 'calendar-month__number--today': date === today }"
          aria-hidden="true"
        >
          {{ Number(date.slice(8)) }}
        </span>
        <span v-if="dayItems(date).length > 0" class="calendar-month__items">
          <CalendarItemLine
            v-for="item in dayItems(date).slice(0, VISIBLE_LINES)"
            :key="itemKey(item)"
            :item="item"
          />
          <span v-if="dayItems(date).length > VISIBLE_LINES" class="calendar-month__more">
            <span class="calendar-month__more-full">
              + ещё {{ dayItems(date).length - VISIBLE_LINES }}
            </span>
            <span class="calendar-month__more-compact" data-testid="calendar-more-compact">
              +{{ dayItems(date).length - VISIBLE_LINES }}
            </span>
          </span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calendar-month {
  overflow: hidden;
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

.calendar-month__row {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.calendar-month__weekday {
  padding: var(--hf-space-2);
  font-size: var(--hf-font-size-caption);
  font-weight: var(--hf-font-weight-semibold);
  text-align: center;
  text-transform: uppercase;
  color: var(--hf-color-text-muted);
  background: var(--hf-color-surface-subtle);
}

.calendar-month__day {
  display: flex;
  flex-direction: column;
  gap: var(--hf-space-1);
  min-width: 0;
  min-height: 7.5rem;
  padding: var(--hf-space-2);
  border-top: 1px solid var(--hf-color-border);
  border-left: 1px solid var(--hf-color-border);
  cursor: pointer;
}

.calendar-month__day:first-child {
  border-left: 0;
}

.calendar-month__day:hover {
  background: var(--hf-color-surface-subtle);
}

.calendar-month__day:focus-visible {
  outline: 2px solid var(--hf-color-focus-ring);
  outline-offset: -2px;
}

.calendar-month__day--outside {
  color: var(--hf-color-text-muted);
  background: var(--hf-color-surface-subtle);
}

.calendar-month__number {
  display: inline-grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  font-weight: var(--hf-font-weight-semibold);
}

.calendar-month__number--today {
  border: 2px solid var(--hf-color-brand);
  border-radius: 50%;
}

.calendar-month__more {
  font-size: var(--hf-font-size-caption);
  color: var(--hf-color-action-primary-text);
}

.calendar-month__items {
  display: flex;
  flex-direction: column;
  gap: var(--hf-space-1);
  min-width: 0;
}

.calendar-month__more-compact {
  display: none;
}

/* A phone cell is about 42px wide: an icon or dot per item and «+N», never text
   that spills into the next cell. The cell aria-label still carries the counts. */
@media (max-width: 599px) {
  .calendar-month__day {
    min-height: 4.5rem;
    padding: var(--hf-space-1);
    overflow: hidden;
  }

  .calendar-month__items {
    flex-flow: row wrap;
    align-items: center;
  }

  .calendar-month__more-full {
    display: none;
  }

  .calendar-month__more-compact {
    display: inline;
  }
}
</style>
