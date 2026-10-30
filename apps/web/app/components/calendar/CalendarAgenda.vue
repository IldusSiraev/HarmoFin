<script setup lang="ts">
import { computed } from 'vue';
import { CalendarDays, ChevronRight, Wallet } from '@lucide/vue';

import type {
  CalendarFeedEventItem,
  CalendarFeedItem,
  CalendarFeedPlanItem,
} from '../../composables/useFamilyCalendar.js';
import { formatMinorUnits } from '../finance/money-format.js';
import UiButton from '../ui/Button.vue';
import UiEmptyState from '../ui/EmptyState.vue';
import UiListRow from '../ui/ListRow.vue';
import UiStatus from '../ui/Status.vue';
import { dayHeading, groupByDay, planStatusLabel } from './calendar-dates.js';
import { participantsLabel } from './participants-label.js';

const props = defineProps<{
  today: string;
  items: CalendarFeedItem[];
  activeMemberIds: ReadonlySet<string>;
  loadingMore: boolean;
}>();
const emit = defineEmits<{
  openEvent: [item: CalendarFeedEventItem];
  openPlan: [item: CalendarFeedPlanItem];
  more: [];
}>();

const days = computed(() => [...groupByDay(props.items).entries()]);

function key(item: CalendarFeedItem): string {
  return item.kind === 'EVENT' ? `${item.eventId}:${item.occurrenceDate}` : item.occurrenceId;
}

function testId(item: CalendarFeedItem): string {
  return `agenda-item-${item.kind === 'EVENT' ? item.eventId : item.occurrenceId}`;
}

function subtitle(item: CalendarFeedItem): string {
  if (item.kind === 'PLAN') {
    // The amount is the server value, only formatted here.
    const sign = item.planKind === 'INCOME_PLAN' ? '+' : '';
    return `${sign}${formatMinorUnits(item.amountMinor, 'RUB', 2)}`;
  }
  const when = item.allDay ? 'Весь день' : (item.startTime ?? '');
  const people = participantsLabel(item.participants, props.activeMemberIds);
  return people ? `${when} · ${people}` : when;
}

// The row button's accessible name replaces its content, so it carries every visible part.
function rowLabel(item: CalendarFeedItem): string {
  const parts = [item.title, subtitle(item)];
  if (item.kind === 'PLAN') parts.push(planStatusLabel(item).label);
  return parts.join(', ');
}

function open(item: CalendarFeedItem): void {
  if (item.kind === 'EVENT') emit('openEvent', item);
  else emit('openPlan', item);
}
</script>

<template>
  <div class="calendar-agenda">
    <UiEmptyState
      v-if="days.length === 0"
      title="На эти дни ничего не запланировано"
      description="Добавьте событие или выберите другие даты."
    />
    <section v-for="[date, dayItems] in days" :key="date" class="calendar-agenda__day">
      <h2 class="calendar-agenda__heading" data-testid="agenda-day-heading">
        {{ dayHeading(date, today) }}
      </h2>
      <ul class="calendar-agenda__list">
        <li
          v-for="item in dayItems"
          :key="key(item)"
          class="calendar-agenda__item"
          :data-testid="testId(item)"
        >
          <UiListRow
            :label="rowLabel(item)"
            :class="
              item.kind === 'EVENT' ? 'calendar-agenda__row--event' : 'calendar-agenda__row--plan'
            "
            @select="open(item)"
          >
            <template #leading>
              <CalendarDays v-if="item.kind === 'EVENT'" :size="18" aria-hidden="true" />
              <Wallet v-else :size="18" aria-hidden="true" />
            </template>
            <span class="calendar-agenda__title">{{ item.title }}</span>
            <span class="calendar-agenda__subtitle">{{ subtitle(item) }}</span>
            <template #trailing>
              <span class="calendar-agenda__trailing">
                <UiStatus
                  v-if="item.kind === 'PLAN'"
                  :label="planStatusLabel(item).label"
                  :tone="planStatusLabel(item).tone"
                />
                <ChevronRight class="calendar-agenda__chevron" :size="18" aria-hidden="true" />
              </span>
            </template>
          </UiListRow>
        </li>
      </ul>
    </section>
    <UiButton
      v-if="days.length > 0"
      variant="secondary"
      full-width
      :loading="loadingMore"
      data-testid="agenda-more"
      @click="emit('more')"
    >
      Показать ещё
    </UiButton>
  </div>
</template>

<style scoped>
.calendar-agenda {
  display: grid;
  gap: var(--hf-space-5);
}

.calendar-agenda__day {
  display: grid;
  gap: var(--hf-space-2);
}

.calendar-agenda__heading {
  margin: 0;
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
  line-height: var(--hf-line-height-small);
  color: var(--hf-color-text-muted);
}

.calendar-agenda__list {
  margin: 0;
  padding: var(--hf-space-1);
  list-style: none;
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

.calendar-agenda__item + .calendar-agenda__item {
  border-top: 1px solid var(--hf-color-border);
}

.calendar-agenda__row--event :deep(.ui-list-row__leading) {
  background: var(--hf-color-brand-soft);
  color: var(--hf-color-action-primary-text);
}

.calendar-agenda__title {
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-agenda__subtitle {
  font-size: var(--hf-font-size-small);
  color: var(--hf-color-text-muted);
  font-variant-numeric: tabular-nums;
}

.calendar-agenda__trailing {
  display: inline-flex;
  gap: var(--hf-space-2);
  align-items: center;
}

.calendar-agenda__chevron {
  flex-shrink: 0;
  color: var(--hf-color-text-muted);
}
</style>
