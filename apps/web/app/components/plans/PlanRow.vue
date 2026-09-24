<script setup lang="ts">
import { computed } from 'vue';
import { Pencil, X } from '@lucide/vue';

import { categoryIcon as resolveCategoryIcon } from '../operations/category-icon.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiListRow from '../ui/ListRow.vue';
import type { RegularPlanDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'PlanRow' });

const props = withDefaults(
  defineProps<{ plan: RegularPlanDto; categoryIcon: string | null; pending?: boolean }>(),
  { pending: false },
);

defineEmits<{ edit: []; remove: [] }>();

const icon = computed(() =>
  resolveCategoryIcon(props.categoryIcon, props.plan.planType === 'INCOME' ? 'INCOME' : 'EXPENSE'),
);

const recurrenceLabel = computed(() => {
  switch (props.plan.recurrence) {
    case 'ONE_TIME':
      return 'Один раз';
    case 'MONTHLY':
      return 'Ежемесячно';
    case 'YEARLY':
      return 'Ежегодно';
    case 'EVERY_N_MONTHS':
      return `Раз в ${props.plan.intervalMonths} мес.`;
  }
});

const rowLabel = computed(() => `План «${props.plan.name}»`);
</script>

<template>
  <UiListRow :label="rowLabel">
    <template #leading><component :is="icon" :size="20" aria-hidden="true" /></template>

    <span class="plan-row__title">{{ plan.name }}</span>
    <span class="plan-row__subtitle">
      {{ recurrenceLabel }}<template v-if="!plan.isActive"> · Отключён</template>
    </span>

    <template #trailing>
      <FinanceMoney
        class="plan-row__amount"
        :minor-units="plan.amountMinor"
        :currency="plan.currency"
        :scale="plan.scale"
      />
    </template>

    <template #actions>
      <button
        type="button"
        data-action="edit-plan"
        class="plan-row__icon-button"
        aria-label="Изменить план"
        :disabled="pending"
        @click="$emit('edit')"
      >
        <Pencil :size="18" aria-hidden="true" />
      </button>
      <button
        type="button"
        data-action="remove-plan"
        class="plan-row__icon-button"
        aria-label="Удалить план"
        :disabled="pending"
        @click="$emit('remove')"
      >
        <X :size="18" aria-hidden="true" />
      </button>
    </template>
  </UiListRow>
</template>

<style scoped>
.plan-row__title {
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-row__subtitle {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}
.plan-row__amount {
  font-weight: var(--hf-font-weight-semibold);
  white-space: nowrap;
}
.plan-row__icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 0;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text-muted);
  cursor: pointer;
}
.plan-row__icon-button:hover:not(:disabled) {
  background: var(--hf-color-action-secondary-hover);
  color: var(--hf-color-text);
}
.plan-row__icon-button:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}
.plan-row__icon-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
