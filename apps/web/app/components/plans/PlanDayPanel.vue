<script setup lang="ts">
import { computed } from 'vue';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Pencil,
  Plus,
  SkipForward,
} from '@lucide/vue';

import type {
  PlansCalendarItem,
  TransactionJournalV2Item,
} from '../../composables/useEnvelopePlanV2.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiButton from '../ui/Button.vue';

defineOptions({ name: 'PlanDayPanel' });

const props = withDefaults(
  defineProps<{
    date: string;
    items: PlansCalendarItem[];
    facts: TransactionJournalV2Item[];
    categoryNames: Record<string, string>;
    factsLoading?: boolean;
    factsError?: boolean;
    busy?: boolean;
  }>(),
  { factsLoading: false, factsError: false, busy: false },
);

const emit = defineEmits<{
  'add-plan': [date: string];
  pay: [item: PlansCalendarItem];
  skip: [item: PlansCalendarItem];
  'record-income': [item: PlansCalendarItem];
  'edit-plan': [item: PlansCalendarItem];
  'retry-facts': [];
}>();

const title = computed(() => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(props.date);
  if (!match) return props.date;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return format(day, 'd MMMM, EEEE', { locale: ru });
});

const statusLabel: Record<string, string> = {
  PENDING: 'Ожидается',
  DUE: 'К оплате',
  COMPLETED: 'Выполнено',
  SKIPPED: 'Пропущено',
  CANCELLED: 'Отменено',
};
const isOpen = (item: PlansCalendarItem) => item.status === 'PENDING' || item.status === 'DUE';
const caption = (fact: TransactionJournalV2Item) =>
  fact.merchantName ?? fact.sourceDescription ?? fact.comment;
const isEmpty = computed(
  () => props.items.length === 0 && props.facts.length === 0 && !props.factsLoading,
);
</script>

<template>
  <section class="day-panel" data-testid="day-panel" :aria-label="`План на ${title}`">
    <header class="day-panel__header">
      <h2 class="day-panel__title">{{ title }}</h2>
      <UiButton
        variant="secondary"
        size="sm"
        data-testid="plan-add-for-day"
        @click="emit('add-plan', date)"
      >
        <Plus :size="16" aria-hidden="true" />
        Добавить план
      </UiButton>
    </header>

    <div class="day-panel__scroll hf-scroll" data-testid="day-panel-scroll">
      <p v-if="isEmpty && !factsError" class="day-panel__muted" data-testid="day-empty">
        На этот день пока ничего нет
      </p>

      <ul v-if="items.length > 0" class="day-panel__list">
        <li
          v-for="item in items"
          :key="item.occurrenceId"
          class="day-panel__row day-panel__row--plan"
          :data-testid="`day-item-${item.occurrenceId}`"
        >
          <span class="day-panel__name">{{ item.name }}</span>
          <div class="day-panel__meta" :data-testid="`day-meta-${item.occurrenceId}`">
            <span class="day-panel__muted">
              {{ item.kind === 'INCOME_PLAN' ? 'Плановый доход' : 'Платёж' }}
              ·
              {{ statusLabel[item.status] ?? item.status }}
            </span>
            <span
              v-if="item.overdue"
              class="day-panel__badge"
              :data-testid="`day-overdue-${item.occurrenceId}`"
            >
              <AlertTriangle :size="14" aria-hidden="true" />
              Просрочено
            </span>
          </div>
          <div class="day-panel__amounts">
            <FinanceMoney :minor-units="item.expectedMinor" currency="RUB" :scale="2" />
            <span
              v-if="item.unpaidMinor !== '0' && item.paidMinor !== '0'"
              class="day-panel__muted"
            >
              Остаток
              <FinanceMoney :minor-units="item.unpaidMinor" currency="RUB" :scale="2" />
            </span>
          </div>
          <div class="day-panel__actions" :data-testid="`day-actions-${item.occurrenceId}`">
            <UiButton
              variant="tertiary"
              size="sm"
              class="day-panel__icon-btn"
              :aria-label="`Изменить план ${item.name}`"
              :title="`Изменить план ${item.name}`"
              :data-testid="`day-edit-${item.occurrenceId}`"
              :disabled="busy"
              @click="emit('edit-plan', item)"
            >
              <Pencil :size="16" aria-hidden="true" />
            </UiButton>
            <template v-if="isOpen(item) && item.kind === 'OBLIGATION'">
              <UiButton
                variant="tertiary"
                size="sm"
                class="day-panel__icon-btn"
                :aria-label="`Оплатить ${item.name}`"
                :title="`Оплатить ${item.name}`"
                :data-testid="`day-pay-${item.occurrenceId}`"
                :disabled="busy"
                @click="emit('pay', item)"
              >
                <Check :size="16" aria-hidden="true" />
              </UiButton>
              <UiButton
                v-if="item.paidMinor === '0'"
                variant="tertiary"
                size="sm"
                class="day-panel__icon-btn"
                :aria-label="`Пропустить ${item.name}`"
                :title="`Пропустить ${item.name}`"
                :data-testid="`day-skip-${item.occurrenceId}`"
                :disabled="busy"
                @click="emit('skip', item)"
              >
                <SkipForward :size="16" aria-hidden="true" />
              </UiButton>
            </template>
            <UiButton
              v-else-if="isOpen(item)"
              variant="tertiary"
              size="sm"
              class="day-panel__icon-btn"
              :aria-label="`Записать доход ${item.name}`"
              :title="`Записать доход ${item.name}`"
              :data-testid="`day-record-${item.occurrenceId}`"
              :disabled="busy"
              @click="emit('record-income', item)"
            >
              <Plus :size="16" aria-hidden="true" />
            </UiButton>
          </div>
        </li>
      </ul>

      <p v-if="factsLoading" class="day-panel__muted">Загрузка операций…</p>
      <div v-else-if="factsError" class="day-panel__error" role="alert">
        <p class="day-panel__error-text">Не удалось загрузить операции дня.</p>
        <UiButton variant="secondary" size="sm" @click="emit('retry-facts')">Повторить</UiButton>
      </div>
      <ul v-else-if="facts.length > 0" class="day-panel__list">
        <li
          v-for="fact in facts"
          :key="fact.id"
          class="day-panel__row"
          :data-testid="`day-fact-${fact.id}`"
        >
          <div class="day-panel__main">
            <span class="day-panel__name">
              {{ categoryNames[fact.categoryId] ?? 'Без категории' }}
            </span>
            <span class="day-panel__muted day-panel__type">
              <ArrowDownLeft
                v-if="fact.transactionType === 'INCOME'"
                :size="14"
                aria-hidden="true"
              />
              <ArrowUpRight v-else :size="14" aria-hidden="true" />
              {{ fact.transactionType === 'INCOME' ? 'Доход' : 'Расход' }}
              <template v-if="caption(fact)"> · {{ caption(fact) }}</template>
            </span>
          </div>
          <FinanceMoney :minor-units="fact.amountMinor" currency="RUB" :scale="2" />
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.day-panel {
  display: flex;
  flex-direction: column;
  gap: var(--hf-space-3);
  min-height: 0;
  padding: var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}
.day-panel__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-2);
}
.day-panel__title {
  margin: 0;
  font-size: var(--hf-font-size-body);
  font-weight: var(--hf-font-weight-semibold);
}
.day-panel__scroll {
  display: grid;
  align-content: start;
  gap: var(--hf-space-3);
  flex: 1;
  min-height: 0;
  max-height: 22rem;
  padding-right: var(--hf-space-1);
  overflow-y: auto;
}
@media (min-width: 64rem) {
  /* Beside the calendar the panel takes the calendar's height; the lists scroll inside it. */
  .day-panel__scroll {
    max-height: none;
  }
}
.day-panel__list {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.day-panel__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-3);
}
.day-panel__row--plan {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: var(--hf-space-3);
  row-gap: var(--hf-space-1);
}
.day-panel__row--plan > .day-panel__amounts {
  grid-column: 2;
  grid-row: 1;
}
.day-panel__row--plan > .day-panel__name {
  grid-column: 1;
  grid-row: 1;
}
.day-panel__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hf-space-2);
  grid-column: 1;
  grid-row: 2;
  min-width: 0;
}
.day-panel__row--plan > .day-panel__actions {
  grid-column: 2;
  grid-row: 2;
  justify-content: flex-end;
  flex-wrap: nowrap;
}
.day-panel__main {
  display: grid;
  gap: var(--hf-space-1);
  min-width: 0;
}
.day-panel__name {
  font-weight: var(--hf-font-weight-medium);
  overflow-wrap: anywhere;
}
.day-panel__muted {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
.day-panel__type {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
}
.day-panel__amounts {
  display: grid;
  gap: var(--hf-space-1);
  justify-items: end;
}
.day-panel__badge {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
}
.day-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}
.day-panel__icon-btn {
  min-width: 2.75rem;
  min-height: 2.75rem;
  padding-inline: 0;
}
.day-panel__error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hf-space-2);
}
.day-panel__error-text {
  margin: 0;
  color: var(--hf-color-text-danger);
}
</style>
