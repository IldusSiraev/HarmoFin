<script setup lang="ts">
import { Check, ChevronDown } from '@lucide/vue';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

import UiTooltip from './Tooltip.vue';

defineOptions({ name: 'UiSelect' });

type SelectOption = Readonly<{
  value: string;
  label: string;
  disabled?: boolean;
}>;

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: ReadonlyArray<SelectOption>;
    id?: string | undefined;
    name: string;
    label: string;
    placeholder?: string | undefined;
    hint?: string | undefined;
    error?: string | undefined;
    tooltip?: string | undefined;
    required?: boolean;
    disabled?: boolean;
    searchable?: boolean;
  }>(),
  {
    id: undefined,
    placeholder: undefined,
    hint: undefined,
    error: undefined,
    tooltip: undefined,
    required: false,
    disabled: false,
    searchable: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  blur: [event: FocusEvent];
}>();

function getSelectId() {
  return props.id ?? `${props.name}-select`;
}

function getLabelId() {
  return `${getSelectId()}-label`;
}

function getHintId() {
  return `${getSelectId()}-hint`;
}

function getErrorId() {
  return `${getSelectId()}-error`;
}

function getListboxId() {
  return `${getSelectId()}-listbox`;
}

function getOptionId(index: number) {
  return `${getListboxId()}-option-${index}`;
}

function getDescribedBy() {
  return (
    [props.hint ? getHintId() : undefined, props.error ? getErrorId() : undefined]
      .filter(Boolean)
      .join(' ') || undefined
  );
}

function labelFor(value: string): string {
  return props.options.find((option) => option.value === value)?.label ?? '';
}

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLElement | null>(null);
const listbox = ref<HTMLUListElement | null>(null);
const open = ref(false);
const activeIndex = ref(0);
const openUpward = ref(false);

// --- select-only combobox (default mode) ---
const selectedOption = computed(() =>
  props.options.find((option) => option.value === props.modelValue),
);

const displayText = computed(() => selectedOption.value?.label ?? props.placeholder ?? '');

function isEnabled(index: number) {
  const option = props.options[index];
  return option !== undefined && !option.disabled;
}

function firstEnabled(from: number, step: 1 | -1): number {
  for (let index = from; index >= 0 && index < props.options.length; index += step) {
    if (isEnabled(index)) return index;
  }
  return -1;
}

function handleDocumentPointerDown(event: Event) {
  const target = event.target as Node | null;
  if (root.value && target && root.value.contains(target)) return;
  closeSelect();
}

function addOutsideListener() {
  document.addEventListener('pointerdown', handleDocumentPointerDown, true);
}

function removeOutsideListener() {
  if (typeof document === 'undefined') return;
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
}

function scrollActiveIntoView() {
  void nextTick(() => {
    const element = listbox.value?.children[activeIndex.value];
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest' });
    }
  });
}

function setActive(index: number) {
  if (index < 0) return;
  activeIndex.value = index;
  scrollActiveIntoView();
}

function openSelect() {
  if (props.disabled || open.value) return;
  const selectedIndex = props.options.findIndex(
    (option, index) => option.value === props.modelValue && isEnabled(index),
  );
  openUpward.value = shouldOpenUpward();
  open.value = true;
  addOutsideListener();
  const initial = selectedIndex >= 0 ? selectedIndex : firstEnabled(0, 1);
  // No enabled option at all: nothing is active, so no activedescendant.
  if (initial < 0) activeIndex.value = -1;
  else setActive(initial);
}

// The popup's max-height is 16rem. Measured only when opening (a client-side
// event handler), so it never touches `window` during SSR.
const POPUP_MAX_HEIGHT_REM = 16;

function shouldOpenUpward(): boolean {
  const element = trigger.value;
  if (!element || typeof window === 'undefined') return false;
  const rect = element.getBoundingClientRect();
  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  const popupHeight = POPUP_MAX_HEIGHT_REM * (Number.isFinite(rootFontSize) ? rootFontSize : 16);
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  return spaceBelow < popupHeight && spaceAbove > spaceBelow;
}

function closeSelect() {
  if (!open.value) return;
  open.value = false;
  removeOutsideListener();
  resetTypeahead();
}

function toggleSelect() {
  if (open.value) closeSelect();
  else openSelect();
}

function chooseIndex(index: number) {
  const option = props.options[index];
  if (!option || option.disabled) return;
  closeSelect();
  if (option.value !== props.modelValue) emit('update:modelValue', option.value);
}

let typeaheadBuffer = '';
let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;

function resetTypeahead() {
  typeaheadBuffer = '';
  if (typeaheadTimer !== undefined) clearTimeout(typeaheadTimer);
  typeaheadTimer = undefined;
}

function typeahead(char: string) {
  if (typeaheadTimer !== undefined) clearTimeout(typeaheadTimer);
  typeaheadBuffer += char.toLowerCase();
  typeaheadTimer = setTimeout(resetTypeahead, 500);
  const count = props.options.length;
  const start = typeaheadBuffer.length === 1 ? activeIndex.value + 1 : activeIndex.value;
  for (let offset = 0; offset < count; offset += 1) {
    const index = (start + offset) % count;
    const option = props.options[index];
    if (option && !option.disabled && option.label.toLowerCase().startsWith(typeaheadBuffer)) {
      setActive(index);
      return;
    }
  }
}

function handleTriggerKeydown(event: KeyboardEvent) {
  if (props.disabled) return;
  const { key } = event;
  if (!open.value) {
    if (key === 'Enter' || key === ' ' || key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      openSelect();
    }
    return;
  }
  if (key === 'ArrowDown') {
    event.preventDefault();
    setActive(firstEnabled(activeIndex.value + 1, 1));
  } else if (key === 'ArrowUp') {
    event.preventDefault();
    setActive(firstEnabled(activeIndex.value - 1, -1));
  } else if (key === 'Home') {
    event.preventDefault();
    setActive(firstEnabled(0, 1));
  } else if (key === 'End') {
    event.preventDefault();
    setActive(firstEnabled(props.options.length - 1, -1));
  } else if (key === 'Enter' || (key === ' ' && typeaheadBuffer === '')) {
    event.preventDefault();
    chooseIndex(activeIndex.value);
  } else if (key === 'Escape') {
    // An open list owns this Escape: without stopping it, the surrounding
    // drawer, modal or filter panel would close too. A closed select lets
    // Escape bubble as before.
    event.preventDefault();
    event.stopPropagation();
    closeSelect();
  } else if (key === 'Tab') {
    closeSelect();
  } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    typeahead(key);
  }
}

function handleTriggerBlur(event: FocusEvent) {
  closeSelect();
  emit('blur', event);
}

function handleOptionHover(index: number) {
  if (isEnabled(index)) activeIndex.value = index;
}

// The trigger is not a labelable element, so the label click focuses it by
// hand, like a click on the label of a native select (focus, no opening).
function handleLabelClick() {
  if (!props.searchable && !props.disabled) trigger.value?.focus();
}

onBeforeUnmount(() => {
  removeOutsideListener();
  resetTypeahead();
});

// --- searchable combobox ---
const query = ref('');

watch(
  () => props.modelValue,
  (value) => {
    query.value = labelFor(value);
  },
  { immediate: true },
);

const filteredOptions = computed(() => {
  const search = query.value.trim().toLowerCase();
  if (!search || search === labelFor(props.modelValue).toLowerCase()) return props.options;
  return props.options.filter((option) => option.label.toLowerCase().includes(search));
});

function openList() {
  if (props.disabled) return;
  open.value = true;
  activeIndex.value = 0;
}

function closeList() {
  open.value = false;
  query.value = labelFor(props.modelValue);
}

function selectOption(option: SelectOption) {
  if (option.disabled) return;
  emit('update:modelValue', option.value);
  query.value = option.label;
  open.value = false;
}

function handleQueryInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value;
  open.value = true;
  activeIndex.value = 0;
}

function handleComboKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (!open.value) {
      openList();
      return;
    }
    activeIndex.value = Math.min(activeIndex.value + 1, filteredOptions.value.length - 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
  } else if (event.key === 'Enter') {
    const option = filteredOptions.value[activeIndex.value];
    if (open.value && option) {
      event.preventDefault();
      selectOption(option);
    }
  } else if (event.key === 'Escape') {
    closeList();
  }
}

function handleComboBlur(event: FocusEvent) {
  closeList();
  emit('blur', event);
}
</script>

<template>
  <div ref="root" class="ui-select" :data-select-name="name">
    <div class="ui-select__label-row">
      <label
        :id="getLabelId()"
        class="ui-select__label"
        :for="searchable ? getSelectId() : undefined"
        @click="handleLabelClick"
      >
        {{ label }}<span v-if="required" aria-hidden="true"> *</span>
      </label>
      <UiTooltip v-if="tooltip" :text="tooltip" v-slot="{ describedby }">
        <button
          type="button"
          class="ui-select__tooltip-trigger"
          aria-label="Подсказка"
          :aria-describedby="describedby"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5" />
            <path d="M8 7v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            <circle cx="8" cy="5.2" r="0.9" fill="currentColor" />
          </svg>
        </button>
      </UiTooltip>
    </div>

    <div v-if="searchable" class="ui-select__combobox">
      <input
        :id="getSelectId()"
        class="ui-select__control"
        :class="{ 'ui-select__control--error': error }"
        type="text"
        role="combobox"
        autocomplete="off"
        :name="name"
        :value="query"
        :placeholder="placeholder"
        aria-autocomplete="list"
        :aria-expanded="open"
        :aria-controls="getListboxId()"
        :aria-activedescendant="
          open && filteredOptions[activeIndex] ? getOptionId(activeIndex) : undefined
        "
        :aria-describedby="getDescribedBy()"
        :aria-invalid="error ? 'true' : undefined"
        :aria-required="required || undefined"
        :disabled="disabled"
        @focus="openList"
        @input="handleQueryInput"
        @keydown="handleComboKeydown"
        @blur="handleComboBlur"
      />
      <ul v-if="open" :id="getListboxId()" class="ui-select__listbox" role="listbox">
        <li
          v-for="(option, index) in filteredOptions"
          :id="getOptionId(index)"
          :key="option.value"
          role="option"
          class="ui-select__option"
          :class="{
            'ui-select__option--active': index === activeIndex,
            'ui-select__option--selected': option.value === modelValue,
            'ui-select__option--disabled': option.disabled,
          }"
          :aria-selected="option.value === modelValue"
          :aria-disabled="option.disabled || undefined"
          @mousedown.prevent="selectOption(option)"
        >
          <span class="ui-select__option-label">{{ option.label }}</span>
          <Check
            v-if="option.value === modelValue"
            class="ui-select__option-check"
            :size="16"
            aria-hidden="true"
          />
        </li>
        <li v-if="filteredOptions.length === 0" class="ui-select__option ui-select__option--empty">
          Ничего не найдено
        </li>
      </ul>
    </div>
    <div v-else class="ui-select__combobox">
      <input type="hidden" :name="name" :value="modelValue" />
      <div
        :id="getSelectId()"
        ref="trigger"
        role="combobox"
        class="ui-select__control ui-select__trigger"
        :class="{
          'ui-select__control--error': error,
          'ui-select__trigger--open': open,
          'ui-select__trigger--disabled': disabled,
        }"
        :tabindex="disabled ? undefined : 0"
        aria-haspopup="listbox"
        :aria-labelledby="getLabelId()"
        :aria-expanded="open ? 'true' : 'false'"
        :aria-controls="getListboxId()"
        :aria-activedescendant="open && activeIndex >= 0 ? getOptionId(activeIndex) : undefined"
        :aria-describedby="getDescribedBy()"
        :aria-invalid="error ? 'true' : undefined"
        :aria-required="required || undefined"
        :aria-disabled="disabled || undefined"
        @click="toggleSelect"
        @keydown="handleTriggerKeydown"
        @blur="handleTriggerBlur"
      >
        <span
          class="ui-select__value"
          :class="{ 'ui-select__value--placeholder': !selectedOption }"
        >
          {{ displayText }}
        </span>
        <ChevronDown class="ui-select__chevron" :size="18" aria-hidden="true" />
      </div>
      <ul
        v-show="open"
        :id="getListboxId()"
        ref="listbox"
        class="ui-select__listbox"
        :class="{ 'ui-select__listbox--up': openUpward }"
        role="listbox"
        :aria-labelledby="getLabelId()"
        @mousedown.prevent
      >
        <li
          v-for="(option, index) in options"
          :id="getOptionId(index)"
          :key="option.value"
          role="option"
          class="ui-select__option"
          :class="{
            'ui-select__option--active': open && index === activeIndex,
            'ui-select__option--selected': option.value === modelValue,
            'ui-select__option--disabled': option.disabled,
          }"
          :data-value="option.value"
          :aria-selected="option.value === modelValue ? 'true' : 'false'"
          :aria-disabled="option.disabled || undefined"
          @mousedown.prevent
          @mouseenter="handleOptionHover(index)"
          @click="chooseIndex(index)"
        >
          <span class="ui-select__option-label">{{ option.label }}</span>
          <Check
            v-if="option.value === modelValue"
            class="ui-select__option-check"
            :size="16"
            aria-hidden="true"
          />
        </li>
      </ul>
    </div>

    <p v-if="hint" :id="getHintId()" class="ui-select__hint">{{ hint }}</p>
    <p v-if="error" :id="getErrorId()" class="ui-select__error">{{ error }}</p>
  </div>
</template>

<style scoped>
.ui-select {
  display: grid;
  gap: var(--hf-space-2);
}

.ui-select__label-row {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
}

.ui-select__label {
  font-weight: var(--hf-font-weight-medium);
  color: var(--hf-color-text);
}

.ui-select__tooltip-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  color: var(--hf-color-text-subtle);
  border: none;
  background: none;
  cursor: pointer;
}

.ui-select__tooltip-trigger:hover,
.ui-select__tooltip-trigger:focus-visible {
  color: var(--hf-color-action-primary);
}

.ui-select__tooltip-trigger:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}

.ui-select__control {
  width: 100%;
  min-height: var(--hf-control-height-md);
  padding-inline: var(--hf-control-padding-inline);
  color: var(--hf-color-text);
  border: 1px solid var(--hf-color-border-strong);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
}

.ui-select__control--error {
  border-color: var(--hf-color-border-danger);
}

.ui-select__control:disabled {
  background: var(--hf-color-surface-subtle);
}

.ui-select__trigger {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  font: inherit;
  text-align: left;
  cursor: pointer;
  user-select: none;
}

.ui-select__trigger--disabled {
  color: var(--hf-color-text-muted);
  background: var(--hf-color-surface-subtle);
  cursor: not-allowed;
}

.ui-select__value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-select__value--placeholder {
  color: var(--hf-color-text-subtle);
}

.ui-select__chevron {
  flex-shrink: 0;
  color: var(--hf-color-text-muted);
  transition: transform var(--hf-transition-fast);
}

.ui-select__trigger--open .ui-select__chevron {
  transform: rotate(180deg);
}

.ui-select__hint,
.ui-select__error {
  margin: 0;
  font-size: 0.875rem;
}

.ui-select__hint {
  color: var(--hf-color-text-muted);
}

.ui-select__error {
  color: var(--hf-color-text-danger);
}

.ui-select__combobox {
  position: relative;
}

.ui-select__listbox {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: var(--hf-z-index-tooltip);
  box-sizing: border-box;
  min-width: 100%;
  width: max-content;
  max-width: min(24rem, calc(100vw - 2rem));
  max-height: 16rem;
  margin: var(--hf-space-1) 0 0;
  padding: var(--hf-space-1);
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-md);
}

/* Not enough room below the field and more above it: open upward. */
.ui-select__listbox--up {
  top: auto;
  bottom: 100%;
  margin: 0 0 var(--hf-space-1);
}

.ui-select__option {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  min-height: 2.75rem;
  padding: 0 var(--hf-space-3);
  color: var(--hf-color-text);
  border-radius: var(--hf-radius-sm);
  cursor: pointer;
}

.ui-select__option-label {
  flex: 1;
  min-width: 0;
}

.ui-select__option-check {
  flex-shrink: 0;
  color: var(--hf-color-action-primary);
}

.ui-select__option:hover,
.ui-select__option--active {
  background: var(--hf-color-surface-subtle);
}

.ui-select__option--selected,
.ui-select__option--selected:hover {
  font-weight: var(--hf-font-weight-medium);
  background: var(--hf-color-brand-soft);
}

.ui-select__option--selected.ui-select__option--active {
  box-shadow: inset 0 0 0 1px var(--hf-color-border-strong);
}

.ui-select__option--disabled,
.ui-select__option--disabled:hover {
  color: var(--hf-color-text-muted);
  background: none;
  cursor: not-allowed;
}

.ui-select__option--empty {
  color: var(--hf-color-text-muted);
  cursor: default;
}
</style>
