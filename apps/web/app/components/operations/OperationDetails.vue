<script setup lang="ts">
import type {
  AuditEventDto,
  IncomeAllocationDto,
} from '../../composables/useBudgetReferenceData.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiEmptyState from '../ui/EmptyState.vue';

withDefaults(
  defineProps<{
    allocations: ReadonlyArray<
      Pick<IncomeAllocationDto, 'id' | 'status' | 'amountMinor' | 'occurredOn' | 'envelopeId'>
    >;
    auditEvents: ReadonlyArray<Pick<AuditEventDto, 'id' | 'createdAt' | 'action' | 'actor'>>;
  }>(),
  { allocations: () => [], auditEvents: () => [] },
);

function allocationStatus(status: IncomeAllocationDto['status']) {
  return { CONFIRMED: 'Подтверждено', CANCELLED: 'Отменено', DELETED: 'Удалено' }[status];
}
</script>

<template>
  <section class="operation-details" aria-label="Детали операции">
    <div>
      <h3>Распределения дохода</h3>
      <UiEmptyState
        v-if="allocations.length === 0"
        title="Распределений нет"
        description="Для этой операции пока нет распределений."
      />
      <ul v-else class="operation-details__list">
        <li v-for="allocation in allocations" :key="allocation.id">
          <FinanceMoney :minor-units="allocation.amountMinor" currency="RUB" :scale="2" />
          <span>{{ allocation.occurredOn }}</span>
          <span>{{ allocationStatus(allocation.status) }}</span>
        </li>
      </ul>
    </div>
    <div>
      <h3>История изменений</h3>
      <UiEmptyState
        v-if="auditEvents.length === 0"
        title="История пуста"
        description="Изменения этой операции появятся здесь."
      />
      <ol v-else class="operation-details__list">
        <li v-for="event in auditEvents" :key="event.id">
          <span>{{ event.createdAt }}</span>
          <span>{{ event.action }}</span>
          <span>{{ event.actor?.displayName ?? event.actor?.email ?? 'Система' }}</span>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.operation-details {
  display: grid;
  gap: var(--hf-space-5);
}
.operation-details h3 {
  margin: 0 0 var(--hf-space-3);
}
.operation-details__list {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.operation-details__list li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: center;
  color: var(--hf-color-text-muted);
}
</style>
