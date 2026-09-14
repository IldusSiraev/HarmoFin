<script setup lang="ts">
import { computed } from 'vue';

import OperationRow from '../operations/OperationRow.vue';
import type { CategoryDto, TransactionDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'RecentOperations' });

type Option = { value: string; label: string };

const props = defineProps<{
  transactions: ReadonlyArray<TransactionDto>;
  categories: ReadonlyArray<CategoryDto>;
  accounts: ReadonlyArray<Option>;
  envelopes: ReadonlyArray<Option>;
}>();

const categoryById = computed(
  () => new Map(props.categories.map((category) => [category.id, category])),
);
const accountNameById = computed(
  () => new Map(props.accounts.map((account) => [account.value, account.label])),
);
const envelopeNameById = computed(
  () => new Map(props.envelopes.map((envelope) => [envelope.value, envelope.label])),
);

function categoryName(transaction: TransactionDto): string {
  return categoryById.value.get(transaction.categoryId)?.name ?? 'Без категории';
}

function categoryTemplateKey(transaction: TransactionDto): string | null {
  return categoryById.value.get(transaction.categoryId)?.templateKey ?? null;
}

function accountName(transaction: TransactionDto): string {
  return accountNameById.value.get(transaction.accountId) ?? 'Счёт';
}

function envelopeName(transaction: TransactionDto): string | null {
  return transaction.envelopeId === null
    ? null
    : (envelopeNameById.value.get(transaction.envelopeId) ?? 'Конверт');
}
</script>

<template>
  <section class="recent-operations" aria-label="Последние операции">
    <header class="recent-operations__header">
      <h2>Последние операции</h2>
      <NuxtLink to="/app/operations">Все операции</NuxtLink>
    </header>

    <p v-if="transactions.length === 0" class="recent-operations__empty">Операций пока нет.</p>

    <ul v-else class="recent-operations__list">
      <li v-for="transaction in transactions" :key="transaction.id">
        <NuxtLink
          class="recent-operations__link"
          data-testid="recent-operation-link"
          :to="`/app/operations?operationId=${encodeURIComponent(transaction.id)}`"
        >
          <OperationRow
            :transaction="transaction"
            :category-name="categoryName(transaction)"
            :category-template-key="categoryTemplateKey(transaction)"
            :account-name="accountName(transaction)"
            :envelope-name="envelopeName(transaction)"
          />
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.recent-operations {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
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

.recent-operations__empty {
  margin: 0;
  color: var(--hf-color-text-muted);
}

.recent-operations__list {
  display: grid;
  gap: var(--hf-space-1);
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.recent-operations__list > li {
  min-width: 0;
}

.recent-operations__link {
  display: block;
  color: inherit;
  text-decoration: none;
}
</style>
