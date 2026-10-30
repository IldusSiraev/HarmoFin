<script setup lang="ts">
import { computed } from 'vue';
import { AlertCircle, ArrowDownLeft, Wallet } from '@lucide/vue';

import type { CalendarFeedItem } from '../../composables/useFamilyCalendar.js';
import { formatMinorUnits } from '../finance/money-format.js';

const props = defineProps<{ item: CalendarFeedItem }>();

const text = computed(() => {
  const item = props.item;
  if (item.kind === 'EVENT') {
    return item.allDay ? `Весь день · ${item.title}` : `${item.startTime ?? ''} ${item.title}`;
  }
  // The amount is the server value, only formatted here.
  const sign = item.planKind === 'INCOME_PLAN' ? '+' : '';
  return `${item.title} · ${sign}${formatMinorUnits(item.amountMinor, 'RUB', 2)}`;
});
const icon = computed(() => {
  if (props.item.kind !== 'PLAN') return null;
  if (props.item.isOverdue) return AlertCircle;
  return props.item.planKind === 'INCOME_PLAN' ? ArrowDownLeft : Wallet;
});
</script>

<template>
  <span
    class="calendar-line"
    :class="{
      'calendar-line--plan': item.kind === 'PLAN',
      'calendar-line--overdue': item.kind === 'PLAN' && item.isOverdue,
    }"
    data-testid="calendar-line"
  >
    <component :is="icon" v-if="icon" class="calendar-line__icon" :size="12" aria-hidden="true" />
    <!-- Phone cells only fit a marker per event; the cell aria-label carries the counts. -->
    <span v-else class="calendar-line__marker" aria-hidden="true" />
    <span class="calendar-line__text">{{ text }}</span>
    <span v-if="item.kind === 'PLAN' && item.isOverdue" class="calendar-line__status">
      просрочен
    </span>
  </span>
</template>

<style scoped>
.calendar-line {
  display: flex;
  align-items: center;
  gap: var(--hf-space-1);
  min-width: 0;
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  color: var(--hf-color-text);
}

.calendar-line__icon {
  flex-shrink: 0;
}

.calendar-line__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-line--plan {
  padding: 0 var(--hf-space-1);
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-surface-subtle);
}

.calendar-line--overdue {
  background: var(--hf-color-warning-soft);
}

.calendar-line--overdue .calendar-line__icon,
.calendar-line__status {
  color: var(--hf-color-status-warning);
}

.calendar-line__status {
  flex-shrink: 0;
  margin-left: auto;
}

.calendar-line__marker {
  display: none;
}

/* A phone cell is about 42px wide: one icon or dot per item, no text. */
@media (max-width: 599px) {
  .calendar-line {
    flex: 0 0 auto;
  }

  .calendar-line__text,
  .calendar-line__status {
    display: none;
  }

  .calendar-line__marker {
    display: block;
    width: 0.375rem;
    height: 0.375rem;
    margin: 0.1875rem;
    border-radius: 50%;
    background: var(--hf-color-text-muted);
  }
}
</style>
