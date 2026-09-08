<script setup lang="ts">
import type { PlanOccurrenceDto } from '../../composables/useBudgetReferenceData.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiButton from '../ui/Button.vue';

withDefaults(defineProps<{ occurrence: PlanOccurrenceDto; pending?: boolean }>(), {
  pending: false,
});
defineEmits<{ draft: []; skip: []; complete: [] }>();
</script>

<template>
  <article class="occurrence-card">
    <div>
      <h2>{{ occurrence.planName }}</h2>
      <p>{{ occurrence.scheduledOn }}</p>
    </div>
    <FinanceMoney :minor-units="occurrence.amountMinor" currency="RUB" :scale="2" />
    <p class="occurrence-card__state">
      {{
        occurrence.status === 'DUE'
          ? 'Требует действия'
          : occurrence.status === 'PENDING'
            ? 'Предстоящее'
            : occurrence.status === 'SKIPPED'
              ? 'Пропущено'
              : occurrence.status === 'COMPLETED'
                ? 'Выполнено'
                : 'Отменено'
      }}
    </p>
    <div
      v-if="occurrence.status === 'PENDING' || occurrence.status === 'DUE'"
      class="occurrence-card__actions"
    >
      <UiButton
        v-if="occurrence.planType !== 'SAVINGS' && !occurrence.transactionId"
        data-action="create-occurrence-draft"
        :disabled="pending"
        @click="$emit('draft')"
        >Создать черновик</UiButton
      >
      <UiButton
        variant="secondary"
        :disabled="pending || Boolean(occurrence.transactionId)"
        @click="$emit('complete')"
        >Отметить выполненным</UiButton
      >
      <UiButton
        variant="tertiary"
        :disabled="pending || Boolean(occurrence.transactionId)"
        @click="$emit('skip')"
        >Пропустить</UiButton
      >
    </div>
  </article>
</template>

<style scoped>
.occurrence-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
  border-left: 4px solid var(--hf-color-action-primary);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.occurrence-card h2,
.occurrence-card p {
  margin: 0;
}
.occurrence-card p {
  color: var(--hf-color-text-muted);
}
.occurrence-card__state {
  font-weight: var(--hf-font-weight-bold);
}
.occurrence-card__actions {
  display: flex;
  flex-wrap: wrap;
  grid-column: 1 / -1;
  gap: var(--hf-space-2);
}
@media (max-width: 47.9375rem) {
  .occurrence-card {
    grid-template-columns: 1fr;
  }
}
</style>
