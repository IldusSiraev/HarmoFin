<script setup lang="ts">
import { computed } from 'vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import UiMoreLink from '../ui/MoreLink.vue';

const LIMIT = 5;

type DashboardBalance = { id: string; name: string; balanceMinor: string };

const props = defineProps<{
  title: string;
  subtitle: string;
  moreLabel: string;
  items: ReadonlyArray<DashboardBalance>;
  totalMinor: string | null;
  moreLink: string;
  limit?: number;
  headingLevel?: 'h2' | 'h3';
}>();

defineSlots<{
  row?(props: { item: DashboardBalance }): unknown;
  footer?(): unknown;
}>();

const visible = computed(() => props.items.slice(0, props.limit ?? LIMIT));
</script>

<template>
  <section class="balance-list" :aria-label="title">
    <header class="balance-list__header">
      <div>
        <component :is="headingLevel ?? 'h2'" class="balance-list__title">{{ title }}</component>
        <p class="balance-list__subtitle">{{ subtitle }}</p>
      </div>
      <UiMoreLink :to="moreLink">{{ moreLabel }}</UiMoreLink>
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
        <slot name="row" :item="item">
          <span class="balance-list__body">
            <span class="balance-list__name">{{ item.name }}</span>
          </span>

          <span class="balance-list__trailing">
            <FinanceMoney :minor-units="item.balanceMinor" currency="RUB" :scale="2" />
          </span>
        </slot>
      </li>
    </ul>

    <slot name="footer" />
  </section>
</template>

<style scoped>
.balance-list {
  display: grid;
  align-content: start;
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
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}

.balance-list__subtitle {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
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
  gap: 0;
  min-width: 0;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--hf-color-border);
  padding-top: var(--hf-space-1);
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
  padding: var(--hf-space-3) 0;
}

.balance-list__row + .balance-list__row {
  border-top: 1px solid var(--hf-color-border);
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
</style>
