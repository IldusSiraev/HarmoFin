<script setup lang="ts">
import { computed } from 'vue';
import { Plus, Wallet } from '@lucide/vue';

import type {
  CalendarFeedEventItem,
  CalendarFeedItem,
  CalendarFeedPlanItem,
} from '../../composables/useFamilyCalendar.js';
import { formatMinorUnits } from '../finance/money-format.js';
import { authorLabel } from '../operations/author-label.js';
import UiButton from '../ui/Button.vue';
import UiModal from '../ui/Modal.vue';
import UiStatus from '../ui/Status.vue';
import { dayDialogTitle, planStatusLabel } from './calendar-dates.js';
import { participantsLabel } from './participants-label.js';

const props = defineProps<{
  open: boolean;
  date: string;
  items: CalendarFeedItem[];
  activeMemberIds: ReadonlySet<string>;
  canCreate: boolean;
}>();
const emit = defineEmits<{
  close: [];
  openEvent: [item: CalendarFeedEventItem];
  openPlan: [item: CalendarFeedPlanItem];
  create: [date: string];
}>();

const title = computed(() => dayDialogTitle(props.date));

function key(item: CalendarFeedItem): string {
  return item.kind === 'EVENT' ? `${item.eventId}:${item.occurrenceDate}` : item.occurrenceId;
}

function testId(item: CalendarFeedItem): string {
  return `day-item-${item.kind === 'EVENT' ? item.eventId : item.occurrenceId}`;
}

// The amount is the server value, only formatted here.
function amount(item: CalendarFeedPlanItem): string {
  const sign = item.planKind === 'INCOME_PLAN' ? '+' : '';
  return `${sign}${formatMinorUnits(item.amountMinor, 'RUB', 2)}`;
}

function openItem(item: CalendarFeedItem): void {
  if (item.kind === 'EVENT') emit('openEvent', item);
  else emit('openPlan', item);
}
</script>

<template>
  <UiModal :open="open" :title="title" size="sm" @close="emit('close')">
    <p v-if="items.length === 0" class="calendar-day__empty">На этот день ничего нет.</p>
    <ul v-else class="calendar-day__list">
      <li v-for="item in items" :key="key(item)" class="calendar-day__item">
        <button
          type="button"
          class="calendar-day__row"
          :data-testid="testId(item)"
          @click="openItem(item)"
        >
          <template v-if="item.kind === 'EVENT'">
            <span class="calendar-day__time">
              {{ item.allDay ? 'Весь день' : item.startTime }}
            </span>
            <span class="calendar-day__body">
              <span class="calendar-day__title">{{ item.title }}</span>
              <span
                v-if="participantsLabel(item.participants, activeMemberIds)"
                class="calendar-day__meta"
              >
                {{ participantsLabel(item.participants, activeMemberIds) }}
              </span>
              <span class="calendar-day__meta">Автор: {{ authorLabel(item.createdBy) }}</span>
            </span>
          </template>
          <template v-else>
            <span class="calendar-day__time">
              <span class="calendar-day__icon" aria-hidden="true"><Wallet :size="18" /></span>
            </span>
            <span class="calendar-day__body">
              <span class="calendar-day__title">{{ item.title }}</span>
              <span class="calendar-day__meta">Владелец: {{ authorLabel(item.owner) }}</span>
            </span>
            <span class="calendar-day__trailing">
              <span class="calendar-day__amount">{{ amount(item) }}</span>
              <UiStatus :label="planStatusLabel(item).label" :tone="planStatusLabel(item).tone" />
            </span>
          </template>
        </button>
      </li>
    </ul>

    <template #footer>
      <UiButton variant="secondary" data-testid="day-close" @click="emit('close')">
        Закрыть
      </UiButton>
      <UiButton v-if="canCreate" data-testid="day-create" @click="emit('create', date)">
        <Plus :size="18" aria-hidden="true" />
        Новое событие на этот день
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.calendar-day__empty {
  margin: 0;
  color: var(--hf-color-text-muted);
}

.calendar-day__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.calendar-day__item + .calendar-day__item {
  border-top: 1px solid var(--hf-color-border);
}

.calendar-day__row {
  display: flex;
  gap: var(--hf-space-3);
  align-items: flex-start;
  width: 100%;
  min-height: 2.75rem;
  padding: var(--hf-space-3) var(--hf-space-2);
  border: 0;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.calendar-day__row:hover {
  background: var(--hf-color-surface-subtle);
}

.calendar-day__row:focus-visible {
  outline: 2px solid var(--hf-color-focus-ring);
  outline-offset: -2px;
}

.calendar-day__time {
  flex: 0 0 4.5rem;
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.calendar-day__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text-muted);
}

.calendar-day__body {
  display: grid;
  flex: 1;
  gap: 0.125rem;
  min-width: 0;
}

.calendar-day__title {
  font-weight: var(--hf-font-weight-medium);
  overflow-wrap: anywhere;
}

.calendar-day__meta {
  font-size: var(--hf-font-size-small);
  color: var(--hf-color-text-muted);
}

.calendar-day__trailing {
  display: grid;
  flex-shrink: 0;
  gap: var(--hf-space-1);
  justify-items: end;
}

.calendar-day__amount {
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
