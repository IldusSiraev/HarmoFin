<script setup lang="ts">
import { computed } from 'vue';
import { Pencil, X } from '@lucide/vue';

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
        <button
          type="button"
          data-action="edit-occurrence-plan"
          class="plan-occurrence-row__icon-button"
          aria-label="Изменить план"
          :disabled="pending"
          @click="$emit('edit')"
        >
          <Pencil :size="18" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-action="remove-occurrence-plan"
          class="plan-occurrence-row__icon-button"
          aria-label="Удалить план"
          :disabled="pending"
          @click="$emit('remove')"
        >
          <X :size="18" aria-hidden="true" />
        </button>
        <UiActionMenu v-if="canDraft || canSkip" label="Ещё действия с планом">
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
.plan-occurrence-row__controls {
  display: flex;
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
.plan-occurrence-row__icon-button {
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
.plan-occurrence-row__icon-button:hover:not(:disabled) {
  background: var(--hf-color-action-secondary-hover);
  color: var(--hf-color-text);
}
.plan-occurrence-row__icon-button:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}
.plan-occurrence-row__icon-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
