<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useSlots } from 'vue';
import { RotateCcw } from '@lucide/vue';

import UiChip from './Chip.vue';

defineOptions({ name: 'UiFilterBar' });

export interface FilterBarOption {
  value: string;
  label: string;
}

export interface FilterBarChip {
  key: string;
  label: string;
  options: ReadonlyArray<FilterBarOption>;
}

const props = withDefaults(
  defineProps<{
    /** Single-choice filters shown as chips; a chip without options is hidden. */
    chips?: ReadonlyArray<FilterBarChip>;
    values: Readonly<Record<string, string>>;
    /** Shows "Сбросить" when any filter of the bar (chips or extra slot) is set. */
    canReset?: boolean;
  }>(),
  { chips: () => [], canReset: false },
);

const emit = defineEmits<{
  change: [key: string, value: string];
  reset: [];
}>();

const slots = useSlots();
const openKey = ref<string | null>(null);
const root = ref<HTMLElement | null>(null);
const optionsLeft = ref(0);
const optionsTop = ref<number | null>(null);

const OPTIONS_WIDTH_REM = 16;

const visibleChips = computed(() => props.chips.filter((chip) => chip.options.length > 0));
const openChip = computed(() => props.chips.find((chip) => chip.key === openKey.value) ?? null);

function chosenLabel(chip: FilterBarChip): string | undefined {
  const current = props.values[chip.key];
  if (!current) return undefined;
  return chip.options.find((option) => option.value === current)?.label ?? current;
}

function chipTrigger(key: string): HTMLElement | null {
  return root.value?.querySelector<HTMLElement>(`[data-testid="chip-${key}"]`) ?? null;
}

// The option list lives outside the chip row (the row wraps, and its layout
// must not grow with an open list) and is placed under its own chip, kept
// inside the bar width.
function placeOptions(key: string): void {
  const trigger = chipTrigger(key);
  if (!trigger || !root.value) return;
  const triggerBox = trigger.getBoundingClientRect();
  const rootBox = root.value.getBoundingClientRect();
  const width = Math.min(OPTIONS_WIDTH_REM * 16, rootBox.width);
  const maxLeft = Math.max(0, rootBox.width - width);
  optionsLeft.value = Math.max(0, Math.min(triggerBox.left - rootBox.left, maxLeft));
  optionsTop.value = triggerBox.bottom - rootBox.top + 4;
}

function toggleChip(key: string): void {
  if (openKey.value === key) {
    openKey.value = null;
    return;
  }
  openKey.value = key;
  void nextTick(() => placeOptions(key));
}

function closeOptions(returnFocus: boolean): void {
  const key = openKey.value;
  if (key === null) return;
  openKey.value = null;
  if (returnFocus) chipTrigger(key)?.focus();
}

// Choosing the value that is already applied clears the filter — the chip is a
// toggle, not a one-way switch.
function chooseOption(key: string, value: string): void {
  openKey.value = null;
  emit('change', key, props.values[key] === value ? '' : value);
}

function clearChip(key: string): void {
  openKey.value = null;
  emit('change', key, '');
  void nextTick(() => chipTrigger(key)?.focus());
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeOptions(true);
}

function handleDocumentClick(event: MouseEvent): void {
  if (openKey.value === null) return;
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
  <div ref="root" class="ui-filter-bar" :class="{ 'ui-filter-bar--no-leading': !slots.leading }">
    <div v-if="slots.leading" class="ui-filter-bar__leading"><slot name="leading" /></div>

    <div v-if="visibleChips.length > 0 || slots.extra" class="ui-filter-bar__chips">
      <UiChip
        v-for="chip in visibleChips"
        :key="chip.key"
        :label="chip.label"
        :value="chosenLabel(chip)"
        aria-haspopup="listbox"
        :aria-expanded="openKey === chip.key ? 'true' : 'false'"
        :data-testid="`chip-${chip.key}`"
        @click="toggleChip(chip.key)"
        @clear="clearChip(chip.key)"
      />
      <slot name="extra" />
      <button
        v-if="canReset"
        type="button"
        class="ui-filter-bar__reset"
        data-testid="reset-filters"
        @click="emit('reset')"
      >
        <RotateCcw :size="14" aria-hidden="true" />
        Сбросить
      </button>
    </div>

    <div
      v-if="openChip"
      class="ui-filter-bar__options hf-scroll"
      data-testid="chip-options"
      role="listbox"
      :aria-label="openChip.label"
      :style="{
        left: `${optionsLeft}px`,
        top: optionsTop === null ? undefined : `${optionsTop}px`,
      }"
    >
      <button
        v-for="option in openChip.options"
        :key="option.value"
        type="button"
        role="option"
        class="ui-filter-bar__option"
        :aria-selected="values[openChip.key] === option.value ? 'true' : 'false'"
        :data-testid="`chip-option-${openChip.key}-${option.value}`"
        @click="chooseOption(openChip.key, option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* One filter pattern for every list page, with every filter visible in the
   bar — no drawer or dialog to reach for. The leading switch sits on its own
   row on phones and chips wrap below it — never a horizontal scroll. From
   1024px the switch and the chips share one row. */
.ui-filter-bar {
  /* ReferencePageLayout's #filters slot is a flex row: without an explicit
     width this bar would shrink to its content. */
  width: 100%;
  position: relative;
  display: grid;
  grid-template-areas:
    'leading'
    'chips';
  grid-template-columns: minmax(0, 1fr);
  gap: var(--hf-space-2) var(--hf-space-3);
  align-items: center;
}

@media (min-width: 1024px) {
  .ui-filter-bar {
    grid-template-areas: 'leading chips';
    grid-template-columns: auto minmax(0, 1fr);
  }
}

.ui-filter-bar.ui-filter-bar--no-leading {
  grid-template-areas: 'chips';
  grid-template-columns: minmax(0, 1fr);
}

.ui-filter-bar__leading {
  grid-area: leading;
  min-width: 0;
}

.ui-filter-bar__chips {
  grid-area: chips;
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: center;
  min-width: 0;
}

.ui-filter-bar__chips :deep(.ui-chip) {
  font-weight: var(--hf-font-weight-medium);
}

.ui-filter-bar__reset {
  display: inline-flex;
  gap: var(--hf-space-1);
  align-items: center;
  min-height: 2.25rem;
  padding: 0 var(--hf-space-2);
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--hf-color-action-primary-text);
  font: inherit;
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
  cursor: pointer;
}

/* Same 36px look on every screen; on touch screens the hit area still
   reaches 44px through this invisible vertical extension. */
.ui-filter-bar__reset {
  position: relative;
}

.ui-filter-bar__reset::before {
  content: '';
  position: absolute;
  inset: -4px 0;
}

.ui-filter-bar__reset:hover {
  background: var(--hf-color-action-secondary-hover);
}

.ui-filter-bar__reset:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.ui-filter-bar__options {
  position: absolute;
  top: 100%;
  z-index: 110;
  display: grid;
  align-content: start;
  width: min(16rem, 100%);
  max-height: min(20rem, 60vh);
  overflow-x: hidden;
  overflow-y: auto;
  padding: var(--hf-space-1);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-md);
}

.ui-filter-bar__option {
  min-width: 0;
  min-height: 2.75rem;
  padding: var(--hf-space-2) var(--hf-space-3);
  border: 0;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text);
  font: inherit;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.ui-filter-bar__option:hover {
  background: var(--hf-color-action-secondary-hover);
}

.ui-filter-bar__option[aria-selected='true'] {
  background: var(--hf-color-brand-soft);
  color: var(--hf-color-action-primary-text);
  font-weight: var(--hf-font-weight-medium);
}

.ui-filter-bar__option:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: -2px;
}
</style>
