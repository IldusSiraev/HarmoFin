<script setup lang="ts">
import { reactive, watch } from 'vue';

import UiDatePicker from '../ui/DatePicker.vue';
import UiSelect from '../ui/Select.vue';

export type AnalyticsFilters = {
  from: string;
  to: string;
  accountId: string;
  categoryId: string;
  envelopeId: string;
  type: '' | 'INCOME' | 'EXPENSE';
};

const props = defineProps<{
  modelValue: AnalyticsFilters;
  accounts?: ReadonlyArray<{ value: string; label: string }>;
  categories?: ReadonlyArray<{ value: string; label: string }>;
  envelopes?: ReadonlyArray<{ value: string; label: string }>;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: AnalyticsFilters] }>();
const model = reactive({ ...props.modelValue });

watch(
  () => props.modelValue,
  (value) => Object.assign(model, value),
  { deep: true },
);

function update() {
  emit('update:modelValue', { ...model });
}
</script>

<template>
  <section class="report-filters" aria-label="Фильтры аналитики">
    <UiDatePicker v-model="model.from" name="from" label="С даты" @update:model-value="update" />
    <UiDatePicker v-model="model.to" name="to" label="По дату" @update:model-value="update" />
    <UiSelect
      v-model="model.type"
      name="type"
      label="Тип"
      :options="[
        { value: '', label: 'Все операции' },
        { value: 'INCOME', label: 'Доходы' },
        { value: 'EXPENSE', label: 'Расходы' },
      ]"
      @update:model-value="update"
    />
    <UiSelect
      v-model="model.accountId"
      name="accountId"
      label="Счёт"
      :options="[{ value: '', label: 'Все счета' }, ...(accounts ?? [])]"
      @update:model-value="update"
    />
    <UiSelect
      v-model="model.categoryId"
      name="categoryId"
      label="Категория"
      :options="[{ value: '', label: 'Все категории' }, ...(categories ?? [])]"
      @update:model-value="update"
    />
    <UiSelect
      v-model="model.envelopeId"
      name="envelopeId"
      label="Конверт"
      :options="[{ value: '', label: 'Все конверты' }, ...(envelopes ?? [])]"
      @update:model-value="update"
    />
  </section>
</template>

<style scoped>
.report-filters {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--hf-space-3);
}
@media (max-width: 47.9375rem) {
  .report-filters {
    grid-template-columns: 1fr;
  }
}
</style>
