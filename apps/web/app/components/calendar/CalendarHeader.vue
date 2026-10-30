<script setup lang="ts">
import { ChevronLeft, ChevronRight, Plus } from '@lucide/vue';

import UiButton from '../ui/Button.vue';
import UiButtonGroup from '../ui/ButtonGroup.vue';

defineProps<{
  view: 'month' | 'agenda';
  title: string;
  ownerFilter: 'all' | 'mine';
  showOwnerFilter: boolean;
  showPlans: boolean;
  canCreate: boolean;
}>();
const emit = defineEmits<{
  'update:view': [value: 'month' | 'agenda'];
  'update:ownerFilter': [value: 'all' | 'mine'];
  'update:showPlans': [value: boolean];
  previous: [];
  next: [];
  today: [];
  create: [];
}>();

const VIEW_OPTIONS = [
  { value: 'month', label: 'Месяц' },
  { value: 'agenda', label: 'Повестка' },
];
const OWNER_OPTIONS = [
  { value: 'all', label: 'Все' },
  { value: 'mine', label: 'Мои' },
];
</script>

<template>
  <header class="calendar-header">
    <div class="calendar-header__titles">
      <p class="calendar-header__eyebrow">Семейный календарь</p>
      <h1 class="calendar-header__title">Календарь</h1>
    </div>
    <div class="calendar-header__controls">
      <div class="calendar-header__toggles">
        <UiButtonGroup
          class="calendar-header__view"
          :options="VIEW_OPTIONS"
          :model-value="view"
          label="Вид календаря"
          testid-prefix="calendar-view"
          @update:model-value="emit('update:view', $event as 'month' | 'agenda')"
        />
        <UiButtonGroup
          v-if="showOwnerFilter"
          class="calendar-header__owner"
          :options="OWNER_OPTIONS"
          :model-value="ownerFilter"
          label="Чьи события"
          testid-prefix="calendar-owner"
          @update:model-value="emit('update:ownerFilter', $event as 'all' | 'mine')"
        />
        <button
          type="button"
          class="calendar-header__switch"
          role="switch"
          :aria-checked="showPlans"
          data-testid="calendar-plans-toggle"
          @click="emit('update:showPlans', !showPlans)"
        >
          <span class="calendar-header__switch-track" aria-hidden="true">
            <span class="calendar-header__switch-thumb" />
          </span>
          Платежи
        </button>
      </div>
      <div class="calendar-header__nav">
        <UiButton
          variant="tertiary"
          size="sm"
          aria-label="Предыдущий период"
          tooltip="Предыдущий период"
          tooltip-placement="bottom"
          @click="emit('previous')"
        >
          <ChevronLeft :size="18" aria-hidden="true" />
        </UiButton>
        <span class="calendar-header__period" aria-live="polite" data-testid="calendar-period">
          {{ title }}
        </span>
        <UiButton
          variant="tertiary"
          size="sm"
          aria-label="Следующий период"
          tooltip="Следующий период"
          tooltip-placement="bottom"
          @click="emit('next')"
        >
          <ChevronRight :size="18" aria-hidden="true" />
        </UiButton>
        <UiButton variant="secondary" size="sm" data-testid="calendar-today" @click="emit('today')">
          Сегодня
        </UiButton>
      </div>
      <div v-if="canCreate" class="calendar-header__create">
        <UiButton
          aria-label="Новое событие"
          tooltip="Новое событие"
          tooltip-placement="bottom"
          data-testid="calendar-create"
          @click="emit('create')"
        >
          <Plus :size="18" aria-hidden="true" />
          <span class="calendar-header__create-label">Новое событие</span>
        </UiButton>
      </div>
    </div>
  </header>
</template>

<style scoped>
.calendar-header {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-4);
  align-items: end;
  justify-content: space-between;
}

.calendar-header__titles {
  min-width: 0;
}

.calendar-header__eyebrow,
.calendar-header__title {
  margin: 0;
}

.calendar-header__eyebrow {
  font-size: var(--hf-font-size-caption);
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--hf-color-action-primary-hover);
}

.calendar-header__title {
  font-size: var(--hf-font-size-h1);
  line-height: var(--hf-line-height-h1);
  letter-spacing: -0.04em;
}

/* Below 1024px: toggles on their own row, navigation (with an icon-only "+") under them. */
.calendar-header__controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
  align-items: center;
  width: 100%;
  min-width: 0;
}

.calendar-header__toggles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
  align-items: center;
  width: 100%;
  min-width: 0;
}

.calendar-header__nav {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: var(--hf-space-1);
  align-items: center;
  min-width: 0;
}

.calendar-header__period {
  min-width: 7.5rem;
  font-weight: var(--hf-font-weight-semibold);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.calendar-header__switch {
  display: inline-flex;
  gap: var(--hf-space-2);
  align-items: center;
  min-height: 44px;
  padding: var(--hf-space-1) var(--hf-space-2);
  border: none;
  border-radius: var(--hf-radius-sm);
  background: transparent;
  color: var(--hf-color-text);
  font: inherit;
  cursor: pointer;
}

.calendar-header__switch:focus-visible {
  outline: 2px solid var(--hf-color-focus-ring);
  outline-offset: 2px;
}

.calendar-header__switch-track {
  position: relative;
  flex: 0 0 auto;
  width: 2rem;
  height: 1.125rem;
  border-radius: 999px;
  background: var(--hf-color-border-strong);
  transition: background var(--hf-transition-fast);
}

.calendar-header__switch[aria-checked='true'] .calendar-header__switch-track {
  background: var(--hf-color-action-primary);
}

.calendar-header__switch-thumb {
  position: absolute;
  top: 0.125rem;
  left: 0.125rem;
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 50%;
  background: var(--hf-color-surface);
  transition: transform var(--hf-transition-fast);
}

.calendar-header__switch[aria-checked='true'] .calendar-header__switch-thumb {
  transform: translateX(0.875rem);
}

.calendar-header__create-label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* From 1024px: controls sit in one row on the right when the column is wide
   enough; otherwise they wrap (the title may take its own line), never scroll. */
@media (min-width: 1024px) {
  .calendar-header__controls {
    flex: 1 1 auto;
    justify-content: flex-end;
    width: auto;
  }

  .calendar-header__toggles {
    display: contents;
  }

  .calendar-header__view {
    order: 1;
  }

  .calendar-header__nav {
    flex: 0 0 auto;
    flex-wrap: nowrap;
    order: 2;
  }

  .calendar-header__owner {
    order: 3;
  }

  .calendar-header__switch {
    order: 4;
  }

  .calendar-header__create {
    order: 5;
  }

  .calendar-header__create-label {
    position: static;
    width: auto;
    height: auto;
    overflow: visible;
    clip: auto;
  }
}
</style>
