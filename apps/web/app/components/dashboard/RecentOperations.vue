<script setup lang="ts">
import { computed } from 'vue';
import { navigateTo } from '#imports';

import OperationGroup from '../operations/OperationGroup.vue';
import OperationRow from '../operations/OperationRow.vue';
import UiMoreLink from '../ui/MoreLink.vue';
import { formatDayMonth } from '../envelopes/envelope-plan-kind.js';
import type { CategoryDto } from '../../composables/useBudgetReferenceData.js';
import type { TransactionJournalV2Item } from '../../composables/useEnvelopePlanV2.js';

defineOptions({ name: 'RecentOperations' });

type Option = { value: string; label: string };

const props = defineProps<{
  transactions: ReadonlyArray<TransactionJournalV2Item>;
  categories: ReadonlyArray<CategoryDto>;
  accounts: ReadonlyArray<Option>;
  envelopes: ReadonlyArray<Option>;
  asOf: string;
}>();

// Journal order is newest first: consecutive items of one day form one group.
function previousDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

const groups = computed(() => {
  const yesterday = previousDay(props.asOf);
  const list: Array<{ key: string; label: string; items: TransactionJournalV2Item[] }> = [];
  for (const transaction of props.transactions) {
    const key = transaction.occurredOn;
    const last = list[list.length - 1];
    if (last && last.key === key) {
      last.items.push(transaction);
      continue;
    }
    const label =
      key === props.asOf ? 'Сегодня' : key === yesterday ? 'Вчера' : formatDayMonth(key);
    list.push({ key, label, items: [transaction] });
  }
  return list;
});

const categoryById = computed(
  () => new Map(props.categories.map((category) => [category.id, category])),
);
const accountNameById = computed(
  () => new Map(props.accounts.map((account) => [account.value, account.label])),
);
const envelopeNameById = computed(
  () => new Map(props.envelopes.map((envelope) => [envelope.value, envelope.label])),
);

function categoryName(transaction: TransactionJournalV2Item): string {
  return categoryById.value.get(transaction.categoryId)?.name ?? 'Без категории';
}

function categoryIcon(transaction: TransactionJournalV2Item): string | null {
  return categoryById.value.get(transaction.categoryId)?.icon ?? null;
}

function accountName(transaction: TransactionJournalV2Item): string {
  return accountNameById.value.get(transaction.accountId) ?? 'Счёт';
}

function envelopeName(transaction: TransactionJournalV2Item): string | null {
  return transaction.envelopeId === null
    ? null
    : (envelopeNameById.value.get(transaction.envelopeId) ?? 'Конверт');
}

// OperationRow already renders its own clickable button (see UiListRow); a
// wrapping <NuxtLink> around it would nest a <button> inside an <a>, which is
// invalid HTML5 and gives the row two redundant keyboard-focus stops. Reuse
// the row's own select event and navigate the same way the link would have.
function openOperation(transactionId: string): void {
  void navigateTo(`/app/operations?operationId=${encodeURIComponent(transactionId)}`);
}
</script>

<template>
  <section class="recent-operations" aria-label="Последние операции">
    <header class="recent-operations__header">
      <div>
        <h2>Последние операции</h2>
        <p class="recent-operations__subtitle">Последние изменения семейного бюджета</p>
      </div>
      <UiMoreLink to="/app/operations">Все операции</UiMoreLink>
    </header>

    <p v-if="transactions.length === 0" class="recent-operations__empty">Операций пока нет.</p>

    <div v-else class="recent-operations__groups">
      <OperationGroup v-for="group in groups" :key="group.key" :label="group.label">
        <li
          v-for="transaction in group.items"
          :key="transaction.id"
          class="recent-operations__item"
        >
          <OperationRow
            :transaction="transaction"
            :category-name="categoryName(transaction)"
            :category-icon="categoryIcon(transaction)"
            :account-name="accountName(transaction)"
            :envelope-name="envelopeName(transaction)"
            @select="openOperation(transaction.id)"
          />
        </li>
      </OperationGroup>
    </div>
  </section>
</template>

<style scoped>
.recent-operations {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}

.recent-operations__header {
  display: flex;
  gap: var(--hf-space-3);
  align-items: baseline;
  justify-content: space-between;
}

.recent-operations__header h2 {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}

.recent-operations__subtitle {
  margin: var(--hf-space-1) 0 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.recent-operations__empty {
  margin: 0;
  color: var(--hf-color-text-muted);
}

.recent-operations__groups {
  display: grid;
  gap: var(--hf-space-4);
}

.recent-operations__item {
  min-width: 0;
}
</style>
