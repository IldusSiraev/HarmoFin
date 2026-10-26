<script setup lang="ts">
import { computed } from 'vue';

import UiButtonGroup from '../ui/ButtonGroup.vue';
import UiDateChip from '../ui/DateChip.vue';
import UiFilterBar, { type FilterBarChip } from '../ui/FilterBar.vue';
import type { OperationFilters } from '../../composables/useOperationFilters.js';

defineOptions({ name: 'OperationsToolbar' });

type Option = { value: string; label: string };

const props = withDefaults(
  defineProps<{
    filters: OperationFilters;
    accounts: ReadonlyArray<Option>;
    categories: ReadonlyArray<Option>;
    envelopes: ReadonlyArray<Option>;
    // Deleted operations are visible to the owner only: the API answers 403 otherwise.
    canViewDeleted: boolean;
    // Empty in a single-member family: the page then hides the chip rather
    // than offering a filter with only one possible value.
    authors?: ReadonlyArray<Option>;
  }>(),
  { authors: () => [] },
);

const emit = defineEmits<{
  change: [key: keyof OperationFilters, value: string];
  reset: [];
}>();

const typeTabs: Option[] = [
  { value: '', label: 'Все' },
  { value: 'INCOME', label: 'Доходы' },
  { value: 'EXPENSE', label: 'Расходы' },
  { value: 'TRANSFER', label: 'Переводы' },
];

// No status chosen means the default view (drafts and confirmed), so the
// status chip offers only the departures from it.
const statusOptions = computed<Option[]>(() => [
  { value: 'DRAFT', label: 'Черновики' },
  { value: 'CONFIRMED', label: 'Подтверждённые' },
  { value: 'CANCELLED', label: 'Отменённые' },
  ...(props.canViewDeleted ? [{ value: 'DELETED', label: 'Удалённые' }] : []),
]);

const chips = computed<FilterBarChip[]>(() => [
  { key: 'accountId', label: 'Счёт', options: props.accounts },
  { key: 'categoryId', label: 'Категория', options: props.categories },
  { key: 'envelopeId', label: 'Конверт', options: props.envelopes },
  { key: 'status', label: 'Статус', options: statusOptions.value },
  { key: 'createdByUserId', label: 'Автор', options: props.authors },
]);

const chipValues = computed<Record<string, string>>(() => ({
  accountId: props.filters.accountId,
  categoryId: props.filters.categoryId,
  envelopeId: props.filters.envelopeId,
  status: props.filters.status,
  createdByUserId: props.filters.createdByUserId,
}));

const canReset = computed(() => Object.values(props.filters).some((value) => value !== ''));

function onChipChange(key: string, value: string): void {
  emit('change', key as keyof OperationFilters, value);
}

function onPeriodChange(value: { from: string; to: string }): void {
  if (value.from !== props.filters.from) emit('change', 'from', value.from);
  if (value.to !== props.filters.to) emit('change', 'to', value.to);
}
</script>

<template>
  <UiFilterBar
    class="operations-toolbar"
    :chips="chips"
    :values="chipValues"
    :can-reset="canReset"
    @change="onChipChange"
    @reset="emit('reset')"
  >
    <template #leading>
      <UiButtonGroup
        :options="typeTabs"
        :model-value="filters.type"
        label="Тип операций"
        testid-prefix="type-tab"
        @update:model-value="emit('change', 'type', $event)"
      />
    </template>

    <template #extra>
      <UiDateChip
        label="Период"
        :from="filters.from"
        :to="filters.to"
        data-testid="chip-period"
        @change="onPeriodChange"
      />
    </template>
  </UiFilterBar>
</template>
