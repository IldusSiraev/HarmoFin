<script setup lang="ts">
import { categoryIcon as resolveCategoryIcon } from '../operations/category-icon.js';
import PlanOccurrenceRow from './PlanOccurrenceRow.vue';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiButton from '../ui/Button.vue';
import UiEmptyState from '../ui/EmptyState.vue';
import type { PlanOccurrenceDto } from '../../composables/useBudgetReferenceData.js';

export interface DayOperationView {
  id: string;
  categoryName: string;
  categoryIcon: string | null;
  transactionType: 'INCOME' | 'EXPENSE';
  amountMinor: string;
  currency: string;
  scale: number;
}

defineOptions({ name: 'PlanDayPanel' });

const props = withDefaults(
  defineProps<{
    date: string;
    operations: ReadonlyArray<DayOperationView>;
    occurrences: ReadonlyArray<PlanOccurrenceDto>;
    categoryIconById: Record<string, string | null>;
    pending?: boolean;
  }>(),
  { pending: false },
);

const emit = defineEmits<{
  'complete-occurrence': [occurrence: PlanOccurrenceDto];
  'draft-occurrence': [occurrence: PlanOccurrenceDto];
  'skip-occurrence': [occurrence: PlanOccurrenceDto];
  'edit-occurrence': [occurrence: PlanOccurrenceDto];
  'remove-occurrence': [occurrence: PlanOccurrenceDto];
  'add-plan': [];
}>();

function operationIcon(operation: DayOperationView) {
  return resolveCategoryIcon(operation.categoryIcon, operation.transactionType);
}

function occurrenceCategoryIcon(occurrence: PlanOccurrenceDto): string | null {
  return props.categoryIconById[occurrence.categoryId ?? ''] ?? null;
}

function netMinor(): string {
  return props.operations
    .reduce(
      (total, operation) =>
        operation.transactionType === 'INCOME'
          ? total + BigInt(operation.amountMinor)
          : total - BigInt(operation.amountMinor),
      0n,
    )
    .toString();
}

function signedMinor(operation: DayOperationView): string {
  return operation.transactionType === 'INCOME' ? operation.amountMinor : `-${operation.amountMinor}`;
}
</script>

<template>
  <section class="plan-day-panel" aria-label="Детали дня">
    <header class="plan-day-panel__header">
      <h2>{{ date }}</h2>
      <div v-if="operations.length > 0" class="plan-day-panel__net">
        <p class="plan-day-panel__net-label">
          {{ BigInt(netMinor()) >= 0n ? 'Доход' : 'Расход' }}
        </p>
        <FinanceMoney :minor-units="netMinor()" currency="RUB" :scale="2" />
      </div>
    </header>

    <section v-if="operations.length > 0" aria-label="Операции">
      <h3 class="plan-day-panel__section-title">Операции</h3>
      <ul class="plan-day-panel__operations">
        <li v-for="operation in operations" :key="operation.id" class="plan-day-panel__operation">
          <span class="plan-day-panel__operation-label">
            <component :is="operationIcon(operation)" :size="18" aria-hidden="true" />
            {{ operation.categoryName }}
          </span>
          <FinanceMoney
            :minor-units="signedMinor(operation)"
            :currency="operation.currency"
            :scale="operation.scale"
          />
        </li>
      </ul>
    </section>

    <section v-if="occurrences.length > 0" aria-label="Планы">
      <h3 class="plan-day-panel__section-title">Планы</h3>
      <ul class="plan-day-panel__items">
        <li v-for="occurrence in occurrences" :key="occurrence.id">
          <PlanOccurrenceRow
            :occurrence="occurrence"
            :category-icon="occurrenceCategoryIcon(occurrence)"
            :pending="pending"
            @complete="emit('complete-occurrence', occurrence)"
            @draft="emit('draft-occurrence', occurrence)"
            @skip="emit('skip-occurrence', occurrence)"
            @edit="emit('edit-occurrence', occurrence)"
            @remove="emit('remove-occurrence', occurrence)"
          />
        </li>
      </ul>
    </section>

    <UiEmptyState
      v-if="operations.length === 0 && occurrences.length === 0"
      title="На этот день пока ничего нет"
      description="Добавьте план или посмотрите другой день."
    />

    <UiButton data-action="add-plan-on-day" variant="secondary" @click="emit('add-plan')">
      + Добавить план на этот день
    </UiButton>
  </section>
</template>

<style scoped>
.plan-day-panel {
  display: grid;
  gap: var(--hf-space-4);
  padding: var(--hf-card-padding);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.plan-day-panel__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--hf-space-3);
}
.plan-day-panel__header h2 {
  margin: 0;
  font-size: 1.125rem;
}
.plan-day-panel__net {
  display: flex;
  align-items: baseline;
  gap: var(--hf-space-2);
}
.plan-day-panel__net-label {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  text-transform: uppercase;
}
.plan-day-panel__section-title {
  margin: 0 0 var(--hf-space-2);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  text-transform: uppercase;
}
.plan-day-panel__operations,
.plan-day-panel__items {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.plan-day-panel__operation {
  display: flex;
  justify-content: space-between;
  gap: var(--hf-space-3);
  padding: var(--hf-space-2) var(--hf-space-3);
}
.plan-day-panel__operation-label {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-2);
  color: var(--hf-color-text-muted);
}
</style>
