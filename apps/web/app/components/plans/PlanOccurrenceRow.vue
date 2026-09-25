<script setup lang="ts">
import { computed } from 'vue';

import { categoryIcon as resolveCategoryIcon } from '../operations/category-icon.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiActionMenu from '../ui/ActionMenu.vue';
import UiListRow from '../ui/ListRow.vue';
import type { PlanOccurrenceDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'PlanOccurrenceRow' });

const props = withDefaults(
  defineProps<{ occurrence: PlanOccurrenceDto; categoryIcon: string | null; pending?: boolean }>(),
  { pending: false },
);

const emit = defineEmits<{
  complete: [];
  draft: [];
  skip: [];
  edit: [];
  remove: [];
}>();

const icon = computed(() =>
  resolveCategoryIcon(
    props.categoryIcon,
    props.occurrence.planType === 'INCOME' ? 'INCOME' : 'EXPENSE',
  ),
);

const isActionable = computed(
  () => props.occurrence.status === 'PENDING' || props.occurrence.status === 'DUE',
);

const canDraft = computed(
  () =>
    isActionable.value &&
    props.occurrence.planType !== 'SAVINGS' &&
    !props.occurrence.transactionId,
);

const canSkip = computed(() => isActionable.value && !props.occurrence.transactionId);

const statusLabel = computed(() => {
  if (props.occurrence.status === 'SKIPPED') return 'Пропущено';
  if (props.occurrence.status === 'COMPLETED') return 'Выполнено';
  if (props.occurrence.status === 'CANCELLED') return 'Отменено';
  return null;
});

const rowLabel = computed(
  () => `Возникновение плана «${props.occurrence.planName}» от ${props.occurrence.scheduledOn}`,
);

function handleCheckbox(event: Event) {
  if ((event.target as HTMLInputElement).checked) emit('complete');
}
</script>

<template>
  <UiListRow :label="rowLabel">
    <template #leading><component :is="icon" :size="20" aria-hidden="true" /></template>

    <span class="plan-occurrence-row__title">{{ occurrence.planName }}</span>
    <span class="plan-occurrence-row__subtitle">{{ occurrence.scheduledOn }}</span>
    <span v-if="statusLabel" class="plan-occurrence-row__status">{{ statusLabel }}</span>

    <template #trailing>
      <FinanceMoney
        class="plan-occurrence-row__amount"
        :minor-units="occurrence.amountMinor"
        :currency="occurrence.currency"
        :scale="occurrence.scale"
      />
    </template>

    <template #actions>
      <div v-if="isActionable" class="plan-occurrence-row__controls">
        <label class="plan-occurrence-row__complete">
          <input
            type="checkbox"
            :disabled="pending"
            :aria-label="`Отметить «${occurrence.planName}» выполненным`"
            @change="handleCheckbox"
          />
        </label>
        <UiActionMenu label="Действия с планом">
          <button
            type="button"
            role="menuitem"
            data-action="edit-occurrence-plan"
            @click="$emit('edit')"
          >
            Изменить
          </button>
          <button
            v-if="canDraft"
            type="button"
            role="menuitem"
            data-testid="row-draft"
            @click="$emit('draft')"
          >
            Создать черновик
          </button>
          <button
            v-if="canSkip"
            type="button"
            role="menuitem"
            data-testid="row-skip"
            @click="$emit('skip')"
          >
            Пропустить
          </button>
          <button
            type="button"
            role="menuitem"
            data-action="remove-occurrence-plan"
            @click="$emit('remove')"
          >
            Удалить
          </button>
        </UiActionMenu>
      </div>
    </template>
  </UiListRow>
</template>

<style scoped>
.plan-occurrence-row__title {
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-occurrence-row__subtitle,
.plan-occurrence-row__status {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}
.plan-occurrence-row__amount {
  font-weight: var(--hf-font-weight-semibold);
  white-space: nowrap;
}
/* Column, not row: a narrow sidebar column has room for the select button's
   own leading/body/trailing stack but not also a full checkbox-plus-menu row
   next to it — stacking these two controls keeps their footprint to a single
   44px-wide column instead of doubling it. */
.plan-occurrence-row__controls {
  display: flex;
  flex-direction: column;
  gap: var(--hf-space-1);
  align-items: center;
}
.plan-occurrence-row__complete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
}
.plan-occurrence-row__complete input {
  width: 1.25rem;
  height: 1.25rem;
}
</style>
