<script setup lang="ts">
import { computed } from 'vue';

import type {
  DashboardBalance,
  DashboardWarning,
} from '../../composables/useBudgetReferenceData.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiMoreLink from '../ui/MoreLink.vue';
import UiStatus from '../ui/Status.vue';

const LIMIT = 5;

const props = defineProps<{
  title: string;
  items: ReadonlyArray<DashboardBalance>;
  warnings: ReadonlyArray<DashboardWarning>;
  subject: DashboardWarning['subject'];
  totalMinor: string | null;
  moreLink: string;
  limit?: number;
}>();

defineSlots<{
  row?(props: { item: DashboardBalance; hasWarning: boolean }): unknown;
}>();

const visible = computed(() => props.items.slice(0, props.limit ?? LIMIT));

function hasWarning(id: string): boolean {
  return props.warnings.some((warning) => warning.subject === props.subject && warning.id === id);
}
</script>

<template>
  <section class="balance-list" :aria-label="title">
    <header class="balance-list__header">
      <h2 class="balance-list__title">{{ title }}</h2>
      <UiMoreLink :to="moreLink">Все</UiMoreLink>
    </header>

    <p v-if="totalMinor !== null" class="balance-list__total" data-testid="balance-list-total">
      <FinanceMoney :minor-units="totalMinor" currency="RUB" :scale="2" />
    </p>

    <p v-if="items.length === 0" class="balance-list__empty">Данных пока нет.</p>

    <ul v-else class="balance-list__list">
      <li
        v-for="item in visible"
        :key="item.id"
        class="balance-list__row"
        data-testid="balance-list-row"
      >
        <slot name="row" :item="item" :has-warning="hasWarning(item.id)">
          <span class="balance-list__body">
            <span class="balance-list__name">{{ item.name }}</span>
            <span v-if="hasWarning(item.id)" class="balance-list__meta">
              <UiStatus label="Дефицит" tone="warning" />
            </span>
          </span>

          <span class="balance-list__trailing">
            <FinanceMoney :minor-units="item.balanceMinor" currency="RUB" :scale="2" />
          </span>
        </slot>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.balance-list {
  display: grid;
  gap: var(--hf-space-4);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}

.balance-list__header {
  display: flex;
  gap: var(--hf-space-3);
  align-items: center;
  justify-content: space-between;
}

.balance-list__title {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: 0.75rem;
  font-weight: var(--hf-font-weight-semibold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.balance-list__total {
  margin: 0;
  font-size: var(--hf-font-size-h2);
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

.balance-list__empty {
  margin: 0;
  color: var(--hf-color-text-muted);
}

.balance-list__list {
  display: grid;
  gap: var(--hf-space-1);
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.balance-list__list > li {
  min-width: 0;
}

.balance-list__row {
  display: flex;
  gap: var(--hf-space-3);
  align-items: center;
  min-height: 2.75rem;
  padding: var(--hf-space-2) var(--hf-space-3);
}

.balance-list__body {
  display: grid;
  flex: 1;
  gap: 0.125rem;
  min-width: 0;
  overflow: hidden;
}

.balance-list__trailing {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.balance-list__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.balance-list__meta {
  display: flex;
  align-items: center;
}
</style>
