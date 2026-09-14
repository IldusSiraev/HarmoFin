<script setup lang="ts">
import { computed } from 'vue';
import { navigateTo } from '#imports';

import type {
  DashboardBalance,
  DashboardWarning,
} from '../../composables/useBudgetReferenceData.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiListRow from '../ui/ListRow.vue';
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

const visible = computed(() => props.items.slice(0, props.limit ?? LIMIT));

function hasWarning(id: string): boolean {
  return props.warnings.some((warning) => warning.subject === props.subject && warning.id === id);
}

function navigate(): void {
  void navigateTo(props.moreLink);
}
</script>

<template>
  <section class="balance-list" :aria-label="title">
    <header class="balance-list__header">
      <h2>{{ title }}</h2>
      <p v-if="totalMinor !== null" class="balance-list__total" data-testid="balance-list-total">
        <FinanceMoney :minor-units="totalMinor" currency="RUB" :scale="2" />
      </p>
      <NuxtLink :to="moreLink">Все</NuxtLink>
    </header>

    <p v-if="items.length === 0" class="balance-list__empty">Данных пока нет.</p>

    <ul v-else class="balance-list__list">
      <li v-for="item in visible" :key="item.id">
        <UiListRow :label="`Открыть ${item.name}`" @select="navigate">
          <span class="balance-list__name">{{ item.name }}</span>
          <span v-if="hasWarning(item.id)" class="balance-list__meta">
            <UiStatus label="Дефицит" tone="warning" />
          </span>

          <template #trailing>
            <FinanceMoney :minor-units="item.balanceMinor" currency="RUB" :scale="2" />
          </template>
        </UiListRow>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.balance-list {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}

.balance-list__header {
  display: flex;
  gap: var(--hf-space-3);
  align-items: baseline;
  justify-content: space-between;
}

.balance-list__header h2 {
  flex: 1;
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}

.balance-list__total {
  margin: 0;
  font-weight: var(--hf-font-weight-semibold);
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
