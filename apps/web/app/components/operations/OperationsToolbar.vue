<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Search, SlidersHorizontal } from '@lucide/vue';

import UiButton from '../ui/Button.vue';
import UiChip from '../ui/Chip.vue';
import UiDrawer from '../ui/Drawer.vue';
import UiInput from '../ui/Input.vue';
import UiSelect from '../ui/Select.vue';
import type { OperationFilters } from '../../composables/useOperationFilters.js';

defineOptions({ name: 'OperationsToolbar' });

type Option = { value: string; label: string };
type ChipKey = 'periodStart' | 'accountId' | 'categoryId' | 'envelopeId';

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
const root = ref<HTMLElement | null>(null);
const chipsRow = ref<HTMLElement | null>(null);
const optionsLeft = ref(0);
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

const typeTabs: Option[] = [
  { value: '', label: 'Все' },
  { value: 'INCOME', label: 'Доходы' },
  { value: 'EXPENSE', label: 'Расходы' },
];

const chips = computed<Array<{ key: ChipKey; label: string; options: ReadonlyArray<Option> }>>(
  () => [
    { key: 'periodStart', label: 'Период', options: props.periods },
    { key: 'accountId', label: 'Счёт', options: props.accounts },
    { key: 'categoryId', label: 'Категория', options: props.categories },
    { key: 'envelopeId', label: 'Конверт', options: props.envelopes },
  ],
);

const openChipData = computed(
  () => chips.value.find((chip) => chip.key === openChip.value) ?? null,
);

function chosenLabel(key: ChipKey, options: ReadonlyArray<Option>): string | undefined {
  const current = props.filters[key];
  if (!current) return undefined;
  return options.find((option) => option.value === current)?.label ?? current;
}

function chipTrigger(key: ChipKey): HTMLElement | null {
  return chipsRow.value?.querySelector<HTMLElement>(`[data-testid="chip-${key}"]`) ?? null;
}

// The chip row scrolls horizontally, and a scroll container clips on both axes,
// so the option list lives outside it and is placed under its own chip.
function placeOptions(key: ChipKey): void {
  const trigger = chipTrigger(key);
  if (!trigger || !root.value) return;
  const triggerBox = trigger.getBoundingClientRect();
  const rootBox = root.value.getBoundingClientRect();
  const maxLeft = Math.max(0, rootBox.width - OPTIONS_WIDTH_REM * 16);
  optionsLeft.value = Math.max(0, Math.min(triggerBox.left - rootBox.left, maxLeft));
}

const OPTIONS_WIDTH_REM = 12;

function toggleChip(key: ChipKey): void {
  if (openChip.value === key) {
    openChip.value = null;
    return;
  }
  openChip.value = key;
  void nextTick(() => placeOptions(key));
}

function closeOptions(returnFocus: boolean): void {
  const key = openChip.value;
  if (key === null) return;
  openChip.value = null;
  if (returnFocus) chipTrigger(key)?.focus();
}

// Choosing the value that is already applied clears the filter — the chip is a
// toggle, not a one-way switch.
function chooseOption(key: ChipKey, value: string): void {
  openChip.value = null;
  emit('change', key, props.filters[key] === value ? '' : value);
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeOptions(true);
}

function handleDocumentClick(event: MouseEvent): void {
  if (openChip.value === null) return;
  const target = event.target;
  if (target instanceof Node && root.value?.contains(target)) return;
  closeOptions(false);
}

onMounted(() => {
  document.addEventListener('keydown', handleDocumentKeydown);
  document.addEventListener('click', handleDocumentClick);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleDocumentKeydown);
  document.removeEventListener('click', handleDocumentClick);
});
</script>

<template>
  <div ref="root" class="operations-toolbar">
    <div class="operations-toolbar__primary">
      <div class="operations-toolbar__tabs" role="tablist" aria-label="Тип операций">
        <button
          v-for="tab in typeTabs"
          :key="tab.value"
          type="button"
          role="tab"
          class="operations-toolbar__tab"
          :class="{ 'operations-toolbar__tab--active': filters.type === tab.value }"
          :aria-selected="filters.type === tab.value ? 'true' : 'false'"
          :data-testid="`type-tab-${tab.value || 'all'}`"
          @click="emit('change', 'type', tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>

      <UiInput
        class="operations-toolbar__search"
        name="operations-search"
        type="search"
        label="Поиск по операциям"
        hide-label
        placeholder="Категория, получатель, комментарий"
        data-testid="operations-search"
        :model-value="searchText"
        @update:model-value="onSearchInput"
      >
        <template #icon><Search :size="18" /></template>
      </UiInput>
    </div>

    <div ref="chipsRow" class="operations-toolbar__chips">
      <UiChip
        v-for="chip in chips"
        v-show="chip.options.length > 0"
        :key="chip.key"
        :label="chip.label"
        :value="chosenLabel(chip.key, chip.options)"
        :active="Boolean(filters[chip.key])"
        :data-testid="`chip-${chip.key}`"
        @click="toggleChip(chip.key)"
      />

      <UiButton variant="secondary" data-testid="more-filters" @click="moreOpen = true">
        <SlidersHorizontal :size="16" aria-hidden="true" />
        Ещё фильтры{{ activeCount > 0 ? ` (${activeCount})` : '' }}
      </UiButton>
    </div>

    <div
      v-if="openChipData"
      class="operations-toolbar__options"
      data-testid="chip-options"
      role="listbox"
      :style="{ left: `${optionsLeft}px` }"
    >
      <button
        v-for="option in openChipData.options"
        :key="option.value"
        type="button"
        role="option"
        class="operations-toolbar__option"
        :aria-selected="filters[openChipData.key] === option.value ? 'true' : 'false'"
        :data-testid="`chip-option-${openChipData.key}-${option.value}`"
        @click="chooseOption(openChipData.key, option.value)"
      >
        {{ option.label }}
      </button>
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
  position: relative;
  display: grid;
  gap: var(--hf-space-3);
}

.operations-toolbar__primary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
  align-items: center;
}

.operations-toolbar__tabs {
  display: flex;
  flex-shrink: 0;
  gap: var(--hf-space-2);
}

.operations-toolbar__tab {
  min-height: 2.75rem;
  padding: 0 var(--hf-space-4);
  border: 1px solid var(--hf-color-border-strong);
  border-radius: var(--hf-radius-xl);
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
  font-weight: var(--hf-font-weight-medium);
  white-space: nowrap;
  cursor: pointer;
}

.operations-toolbar__tab:hover {
  background: var(--hf-color-action-secondary-hover);
}

.operations-toolbar__tab:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.operations-toolbar__tab--active {
  border-color: var(--hf-color-brand);
  background: var(--hf-color-brand-soft);
  color: var(--hf-color-brand);
}

.operations-toolbar__search {
  flex: 1 1 16rem;
  min-width: 12rem;
  max-width: 28rem;
}

.operations-toolbar__chips {
  display: flex;
  gap: var(--hf-space-2);
  align-items: center;
  overflow-x: auto;
  padding-bottom: var(--hf-space-1);
}

.operations-toolbar__chips > * {
  flex-shrink: 0;
}

.operations-toolbar__options {
  position: absolute;
  top: 100%;
  z-index: 110;
  display: grid;
  width: 12rem;
  max-height: 16rem;
  overflow-y: auto;
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
