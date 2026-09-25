<script setup lang="ts">
import { computed } from 'vue';

import { categoryIcon as resolveCategoryIcon } from '../operations/category-icon.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiActionMenu from '../ui/ActionMenu.vue';
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
    default: {
      const exhaustive: never = props.plan.recurrence;
      return exhaustive;
    }
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
      <UiActionMenu label="Действия с планом">
        <button
          type="button"
          role="menuitem"
          data-action="edit-plan"
          :disabled="pending"
          @click="$emit('edit')"
        >
          Изменить
        </button>
        <button
          type="button"
          role="menuitem"
          data-action="remove-plan"
          :disabled="pending"
          @click="$emit('remove')"
        >
          Удалить
        </button>
      </UiActionMenu>
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
</style>
