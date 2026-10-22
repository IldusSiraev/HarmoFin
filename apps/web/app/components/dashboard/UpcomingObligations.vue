<script setup lang="ts">
import { ArrowRight, Check, CircleAlert } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import UiMoreLink from '../ui/MoreLink.vue';
import { formatMoneyText } from '../envelopes/envelope-plan-kind.js';
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';

type Obligation = DashboardV2Response['nearestObligations'][number];

defineProps<{ items: ReadonlyArray<Obligation> }>();

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const monthFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'short' });

function toDate(iso: string): Date | null {
  const [year, month, day] = iso.split('-').map(Number);
  return year && month && day ? new Date(year, month - 1, day) : null;
}
function dayOf(iso: string): string {
  return String(toDate(iso)?.getDate() ?? iso);
}
function monthOf(iso: string): string {
  const date = toDate(iso);
  return date ? monthFormatter.format(date).replace('.', '') : '';
}
function fullDate(iso: string): string {
  const date = toDate(iso);
  return date ? dateFormatter.format(date) : iso;
}
function statusText(item: Obligation): string {
  if (item.coverage === 'COVERED') return 'Отложено полностью';
  if (item.coverage === 'PARTIAL') return `Нужно пополнить ${formatMoneyText(item.shortfallMinor)}`;
  return 'Не отложено';
}
function accessibleName(item: Obligation): string {
  return `${item.name}, ${fullDate(item.scheduledOn)}, ${formatMoneyText(item.unpaidMinor)}, ${statusText(item).toLowerCase()}`;
}
</script>

<template>
  <section class="obligations" aria-labelledby="upcoming-obligations-title">
    <header class="obligations__header">
      <div>
        <h2 id="upcoming-obligations-title" class="obligations__title">
          Ближайшие обязательные платежи
        </h2>
        <p class="obligations__subtitle">На ближайшие 60 дней</p>
      </div>
      <UiMoreLink to="/app/plans">Все планы</UiMoreLink>
    </header>
    <p v-if="items.length === 0" class="obligations__empty">Ближайших обязательных платежей нет.</p>
    <ul v-else class="obligations__list">
      <li v-for="item in items" :key="item.occurrenceId" class="obligations__item">
        <NuxtLink
          class="obligations__link"
          :to="`/app/plans?occurrence=${item.occurrenceId}`"
          :aria-label="accessibleName(item)"
        >
          <span class="obligations__date" aria-hidden="true">
            <span class="obligations__day">{{ dayOf(item.scheduledOn) }}</span>
            <span class="obligations__month">{{ monthOf(item.scheduledOn) }}</span>
          </span>
          <span class="obligations__body">
            <span class="obligations__name">{{ item.name }}</span>
            <span
              class="obligations__status"
              :class="
                item.coverage === 'COVERED'
                  ? 'obligations__status--ok'
                  : 'obligations__status--warning'
              "
              data-testid="obligation-status"
            >
              <Check v-if="item.coverage === 'COVERED'" :size="14" aria-hidden="true" />
              <CircleAlert v-else :size="14" aria-hidden="true" />
              {{ statusText(item) }}
            </span>
          </span>
          <FinanceMoney
            class="obligations__amount"
            :minor-units="item.unpaidMinor"
            currency="RUB"
            :scale="2"
          />
          <ArrowRight class="obligations__arrow" :size="16" aria-hidden="true" />
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.obligations {
  display: grid;
  gap: var(--hf-space-4);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

.obligations__header {
  display: flex;
  gap: var(--hf-space-3);
  align-items: flex-start;
  justify-content: space-between;
}

.obligations__title {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}

.obligations__subtitle,
.obligations__empty {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}

.obligations__list {
  display: grid;
  grid-template-columns: 1fr;
  margin: 0;
  padding: 0;
  list-style: none;
}

.obligations__item + .obligations__item {
  border-top: 1px solid var(--hf-color-border);
}

@media (min-width: 768px) {
  .obligations__list {
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  }

  .obligations__item + .obligations__item {
    border-top: 0;
    border-left: 1px solid var(--hf-color-border);
  }
}

.obligations__link {
  display: flex;
  gap: var(--hf-space-3);
  align-items: center;
  min-height: 2.75rem;
  padding: var(--hf-space-3);
  border-radius: var(--hf-radius-md);
  color: inherit;
  text-decoration: none;
}

.obligations__link:hover {
  background: var(--hf-color-surface-subtle);
}

.obligations__link:focus-visible {
  outline: 2px solid var(--hf-color-focus-ring);
  outline-offset: 2px;
}

.obligations__date {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  line-height: 1;
}

.obligations__day {
  font-weight: var(--hf-font-weight-bold);
}

.obligations__month {
  color: var(--hf-color-text-muted);
  font-size: 0.625rem;
}

.obligations__body {
  display: grid;
  flex: 1;
  gap: 0.125rem;
  min-width: 0;
}

.obligations__name {
  overflow: hidden;
  font-weight: var(--hf-font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.obligations__status {
  display: inline-flex;
  gap: var(--hf-space-1);
  align-items: center;
  font-size: var(--hf-font-size-caption);
}

.obligations__status--ok {
  color: var(--hf-color-text-success);
}

.obligations__status--warning {
  color: var(--hf-color-status-warning);
}

.obligations__amount {
  flex-shrink: 0;
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.obligations__arrow {
  flex-shrink: 0;
  color: var(--hf-color-text-muted);
}
</style>
