<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Search, SlidersHorizontal } from '@lucide/vue';

import UiButton from '../ui/Button.vue';
import UiChip from '../ui/Chip.vue';
import UiDrawer from '../ui/Drawer.vue';
import UiInput from '../ui/Input.vue';
import UiSelect from '../ui/Select.vue';
import type { OperationFilters } from '../../composables/useOperationFilters.js';

defineOptions({ name: 'OperationsToolbar' });

type Option = { value: string; label: string };
type ChipKey = 'periodStart' | 'accountId' | 'categoryId' | 'envelopeId' | 'type';

const props = defineProps<{
  filters: OperationFilters;
  activeCount: number;
  accounts: ReadonlyArray<Option>;
  categories: ReadonlyArray<Option>;
  envelopes: ReadonlyArray<Option>;
  periods: ReadonlyArray<Option>;
}>();

const emit = defineEmits<{
  change: [key: keyof OperationFilters, value: string];
  search: [value: string];
  reset: [];
}>();

const SEARCH_DEBOUNCE_MS = 300;

const searchText = ref(props.filters.search);
const openChip = ref<ChipKey | null>(null);
const moreOpen = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => props.filters.search,
  (value) => {
    searchText.value = value;
  },
);

function onSearchInput(value: string): void {
  searchText.value = value;
  if (searchTimer !== undefined) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => emit('search', value), SEARCH_DEBOUNCE_MS);
}

onBeforeUnmount(() => {
  if (searchTimer !== undefined) clearTimeout(searchTimer);
});

const typeOptions: Option[] = [
  { value: 'INCOME', label: 'Доход' },
  { value: 'EXPENSE', label: 'Расход' },
];

const chips = computed<Array<{ key: ChipKey; label: string; options: ReadonlyArray<Option> }>>(
  () => [
    { key: 'periodStart', label: 'Период', options: props.periods },
    { key: 'accountId', label: 'Счёт', options: props.accounts },
    { key: 'categoryId', label: 'Категория', options: props.categories },
    { key: 'envelopeId', label: 'Конверт', options: props.envelopes },
    { key: 'type', label: 'Тип', options: typeOptions },
  ],
);

function chosenLabel(key: ChipKey, options: ReadonlyArray<Option>): string | undefined {
  const current = props.filters[key];
  if (!current) return undefined;
  return options.find((option) => option.value === current)?.label ?? current;
}

function toggleChip(key: ChipKey): void {
  openChip.value = openChip.value === key ? null : key;
}

// Choosing the value that is already applied clears the filter — the chip is a
// toggle, not a one-way switch.
function chooseOption(key: ChipKey, value: string): void {
  openChip.value = null;
  emit('change', key, props.filters[key] === value ? '' : value);
}
</script>

<template>
  <div class="operations-toolbar">
    <div class="operations-toolbar__search">
      <Search :size="18" aria-hidden="true" />
      <UiInput
        name="operations-search"
        type="search"
        label="Поиск по операциям"
        data-testid="operations-search"
        :model-value="searchText"
        @update:model-value="onSearchInput"
      />
    </div>

    <div class="operations-toolbar__chips">
      <div
        v-for="chip in chips"
        v-show="chip.options.length > 0"
        :key="chip.key"
        class="operations-toolbar__chip"
      >
        <UiChip
          :label="chip.label"
          :value="chosenLabel(chip.key, chip.options)"
          :active="Boolean(filters[chip.key])"
          :data-testid="`chip-${chip.key}`"
          @click="toggleChip(chip.key)"
        />
        <div v-if="openChip === chip.key" class="operations-toolbar__options" role="listbox">
          <button
            v-for="option in chip.options"
            :key="option.value"
            type="button"
            role="option"
            class="operations-toolbar__option"
            :aria-selected="filters[chip.key] === option.value ? 'true' : 'false'"
            :data-testid="`chip-option-${chip.key}-${option.value}`"
            @click="chooseOption(chip.key, option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <UiButton variant="secondary" data-testid="more-filters" @click="moreOpen = true">
        <SlidersHorizontal :size="16" aria-hidden="true" />
        Ещё фильтры{{ activeCount > 0 ? ` (${activeCount})` : '' }}
      </UiButton>
    </div>

    <UiDrawer :open="moreOpen" title="Фильтры и сортировка" @close="moreOpen = false">
      <div class="operations-toolbar__more">
        <UiSelect
          name="status"
          label="Статус"
          :model-value="filters.status"
          :options="[
            { value: '', label: 'Активные' },
            { value: 'DRAFT', label: 'Черновики' },
            { value: 'CONFIRMED', label: 'Подтверждённые' },
            { value: 'CANCELLED', label: 'Отменённые' },
            { value: 'DELETED', label: 'Удалённые' },
            { value: 'all', label: 'Все' },
          ]"
          @update:model-value="emit('change', 'status', $event)"
        />
        <UiInput
          name="from"
          type="date"
          label="Дата с"
          :model-value="filters.from"
          @update:model-value="emit('change', 'from', $event)"
        />
        <UiInput
          name="to"
          type="date"
          label="Дата по"
          :model-value="filters.to"
          @update:model-value="emit('change', 'to', $event)"
        />
        <UiInput
          name="cycleStart"
          type="date"
          label="Начало цикла"
          :model-value="filters.cycleStart"
          @update:model-value="emit('change', 'cycleStart', $event)"
        />
        <UiSelect
          name="sortBy"
          label="Сортировка"
          :model-value="filters.sortBy"
          :options="[
            { value: 'occurredOn', label: 'По дате' },
            { value: 'amount', label: 'По сумме' },
          ]"
          @update:model-value="emit('change', 'sortBy', $event)"
        />
        <UiSelect
          name="sortDirection"
          label="Направление"
          :model-value="filters.sortDirection"
          :options="[
            { value: 'desc', label: 'По убыванию' },
            { value: 'asc', label: 'По возрастанию' },
          ]"
          @update:model-value="emit('change', 'sortDirection', $event)"
        />
      </div>

      <template #footer>
        <UiButton variant="tertiary" data-testid="reset-filters" @click="emit('reset')">
          Сбросить всё
        </UiButton>
        <UiButton variant="secondary" @click="moreOpen = false">Готово</UiButton>
      </template>
    </UiDrawer>
  </div>
</template>

<style scoped>
.operations-toolbar {
  display: grid;
  gap: var(--hf-space-3);
}

.operations-toolbar__search {
  display: flex;
  gap: var(--hf-space-2);
  align-items: center;
  color: var(--hf-color-text-muted);
}

.operations-toolbar__search > :last-child {
  flex: 1;
}

.operations-toolbar__chips {
  display: flex;
  gap: var(--hf-space-2);
  align-items: center;
  overflow-x: auto;
  padding-bottom: var(--hf-space-1);
}

.operations-toolbar__chip {
  position: relative;
  flex-shrink: 0;
}

.operations-toolbar__options {
  position: absolute;
  left: 0;
  z-index: 110;
  display: grid;
  min-width: 12rem;
  max-height: 16rem;
  overflow-y: auto;
  margin-top: var(--hf-space-1);
  padding: var(--hf-space-2);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-md);
}

.operations-toolbar__option {
  min-height: 2.75rem;
  padding: 0 var(--hf-space-3);
  border: 0;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.operations-toolbar__option:hover,
.operations-toolbar__option[aria-selected='true'] {
  background: var(--hf-color-action-secondary-hover);
}

.operations-toolbar__more {
  display: grid;
  gap: var(--hf-space-4);
}
</style>
