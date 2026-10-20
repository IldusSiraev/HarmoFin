<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import {
  endOfMonth,
  endOfYear,
  format,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { VueDatePicker } from '@vuepic/vue-datepicker';

import UiChip from './Chip.vue';
import { formatPlainDate } from '../obligations/format-plain-date.js';
import { useColorScheme } from '../../composables/useColorScheme.js';

import '@vuepic/vue-datepicker/dist/main.css';
import './datepicker-theme.css';

defineOptions({ name: 'UiDateChip', inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    label: string;
    /** "yyyy-MM-dd" or ''. Ignored without `range`. */
    from?: string;
    /** "yyyy-MM-dd" or ''. The single date when `range` is false. */
    to: string;
    /** Pick a period (from–to) instead of one date. */
    range?: boolean;
  }>(),
  { from: '', range: true },
);

const emit = defineEmits<{ change: [value: { from: string; to: string }] }>();

const DAY = 'yyyy-MM-dd';
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const popover = ref<HTMLElement | null>(null);
const shift = ref(0);
const popoverId = useId();
const { resolved } = useColorScheme();
const isDark = computed(() => resolved() === 'dark');

const valueText = computed(() => {
  const from = props.range ? props.from : '';
  const to = props.to;
  if (from && to) {
    // Same year: the year is said once, at the end ("01.10 – 20.10.2026").
    const start =
      from.slice(0, 4) === to.slice(0, 4)
        ? formatPlainDate(from).slice(0, 5)
        : formatPlainDate(from);
    return `${start} – ${formatPlainDate(to)}`;
  }
  if (from) return `с ${formatPlainDate(from)}`;
  if (to) return props.range ? `по ${formatPlainDate(to)}` : formatPlainDate(to);
  return undefined;
});

const pickerValue = computed(() => {
  if (!props.range) return props.to || null;
  return props.from || props.to ? [props.from || props.to, props.to || props.from] : null;
});

const presets = computed(() => {
  const today = new Date();
  const day = (date: Date) => format(date, DAY);
  if (!props.range) {
    return [
      { label: 'Сегодня', from: '', to: day(today) },
      { label: 'Конец прошлого месяца', from: '', to: day(endOfMonth(subMonths(today, 1))) },
    ];
  }
  const lastMonth = subMonths(today, 1);
  return [
    { label: 'Этот месяц', from: day(startOfMonth(today)), to: day(endOfMonth(today)) },
    { label: 'Прошлый месяц', from: day(startOfMonth(lastMonth)), to: day(endOfMonth(lastMonth)) },
    { label: 'Последние 30 дней', from: day(subDays(today, 29)), to: day(today) },
    { label: 'Этот год', from: day(startOfYear(today)), to: day(endOfYear(today)) },
  ];
});

function isCurrent(preset: { from: string; to: string }): boolean {
  return (props.range ? props.from : '') === preset.from && props.to === preset.to;
}

// The popover hangs under the chip; near the right edge of a narrow screen it
// is shifted left so the calendar stays inside the viewport.
function place(): void {
  shift.value = 0;
  void nextTick(() => {
    const box = popover.value?.getBoundingClientRect();
    if (!box) return;
    const overflow = box.right - (window.innerWidth - 8);
    if (overflow > 0) shift.value = -Math.min(overflow, Math.max(0, box.left - 8));
  });
}

function toggle(): void {
  open.value = !open.value;
  if (!open.value) return;
  place();
  // Keyboard users land inside the popover; Escape returns them to the chip.
  void nextTick(() => popover.value?.querySelector<HTMLElement>('button')?.focus());
}

function close(returnFocus: boolean): void {
  if (!open.value) return;
  open.value = false;
  if (returnFocus) root.value?.querySelector<HTMLElement>('.ui-chip__trigger')?.focus();
}

function apply(value: { from: string; to: string }): void {
  emit('change', value);
  close(true);
}

function handlePick(value: unknown): void {
  if (Array.isArray(value)) {
    const [from, to] = value as Array<string | null | undefined>;
    if (from && to) apply({ from, to });
    return;
  }
  if (typeof value === 'string' && value) apply({ from: '', to: value });
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close(true);
}

function handleDocumentClick(event: MouseEvent): void {
  if (!open.value) return;
  const target = event.target;
  if (target instanceof Node && root.value?.contains(target)) return;
  close(false);
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
  <!-- Date filter as a chip: the chosen period is read on the chip, the
       calendar opens in place (no separate "с" / "по" fields and no drawer). -->
  <span ref="root" class="ui-date-chip">
    <UiChip
      v-bind="$attrs"
      :label="label"
      :value="valueText"
      aria-haspopup="dialog"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="open ? popoverId : undefined"
      @click="toggle"
      @clear="emit('change', { from: '', to: '' })"
    />
    <div
      v-if="open"
      :id="popoverId"
      ref="popover"
      class="ui-date-chip__popover"
      role="dialog"
      :aria-label="label"
      :style="{ transform: shift ? `translateX(${shift}px)` : undefined }"
    >
      <div class="ui-date-chip__presets" role="group" aria-label="Быстрый выбор">
        <button
          v-for="preset in presets"
          :key="preset.label"
          type="button"
          class="ui-date-chip__preset"
          :aria-pressed="isCurrent(preset) ? 'true' : 'false'"
          @click="apply({ from: preset.from, to: preset.to })"
        >
          {{ preset.label }}
        </button>
      </div>
      <VueDatePicker
        :model-value="pickerValue"
        :range="range"
        model-type="yyyy-MM-dd"
        :locale="ru"
        :week-start="1"
        :time-config="{ enableTimePicker: false }"
        :dark="isDark"
        inline
        auto-apply
        @update:model-value="handlePick"
      />
    </div>
  </span>
</template>

<style scoped>
.ui-date-chip {
  position: relative;
  display: inline-flex;
  max-width: 100%;
}

.ui-date-chip__popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 110;
  display: grid;
  gap: var(--hf-space-2);
  padding: var(--hf-space-2);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-md);
}

.ui-date-chip__presets {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-1);
  max-width: 17rem;
}

.ui-date-chip__preset {
  min-height: 2rem;
  padding: 0 var(--hf-space-2);
  border: 1px solid var(--hf-color-border);
  border-radius: 999px;
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
  font-size: var(--hf-font-size-caption);
  font-weight: var(--hf-font-weight-medium);
  cursor: pointer;
}

.ui-date-chip__preset:hover {
  background: var(--hf-color-action-secondary-hover);
}

.ui-date-chip__preset[aria-pressed='true'] {
  border-color: var(--hf-color-brand);
  background: var(--hf-color-brand-soft);
  color: var(--hf-color-action-primary-text);
}

.ui-date-chip__preset:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

/* The inline calendar brings its own border; the popover already has one. */
.ui-date-chip__popover :deep(.dp__menu) {
  border: 0;
}
</style>
