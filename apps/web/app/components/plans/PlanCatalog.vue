<script setup lang="ts">
import { CirclePause, CirclePlay } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import UiButton from '../ui/Button.vue';
import { recurrenceLabel, type PlanCatalogEntry } from './plan-edit.js';

defineOptions({ name: 'PlanCatalog' });

withDefaults(
  defineProps<{
    entries: PlanCatalogEntry[];
    loadFailed?: boolean;
    busy?: boolean;
  }>(),
  { loadFailed: false, busy: false },
);

const emit = defineEmits<{
  edit: [entry: PlanCatalogEntry];
  resume: [entry: PlanCatalogEntry];
}>();
</script>

<template>
  <details class="plan-catalog" data-testid="plan-catalog">
    <summary class="plan-catalog__summary">
      {{ loadFailed ? 'Все планы (ошибка загрузки)' : `Все планы (${entries.length})` }}
    </summary>

    <p v-if="loadFailed" class="plan-catalog__error" role="alert" data-testid="catalog-error">
      Не удалось загрузить список планов.
    </p>
    <p v-else-if="entries.length === 0" class="plan-catalog__empty" data-testid="catalog-empty">
      Планов пока нет.
    </p>
    <ul v-else class="plan-catalog__items">
      <li
        v-for="entry in entries"
        :key="`${entry.kind}-${entry.id}`"
        class="obligation-row"
        :data-testid="`catalog-row-${entry.kind}-${entry.id}`"
      >
        <div class="obligation-row__main">
          <span class="obligation-row__name">{{ entry.name }}</span>
          <span class="obligation-row__meta">
            {{ entry.kind === 'obligation' ? 'Платёж' : 'Доход' }} ·
            {{ recurrenceLabel(entry.recurrence, entry.intervalMonths) }}
          </span>
          <span class="obligation-row__meta plan-catalog__status">
            <CirclePlay v-if="entry.active" :size="14" aria-hidden="true" />
            <CirclePause v-else :size="14" aria-hidden="true" />
            {{ entry.active ? 'Активен' : 'Остановлен' }}
          </span>
        </div>
        <div class="obligation-row__amounts">
          <FinanceMoney :minor-units="entry.amountMinor" currency="RUB" :scale="2" />
        </div>
        <div class="obligation-row__actions">
          <UiButton
            v-if="entry.active"
            variant="secondary"
            size="sm"
            :aria-label="`Изменить план ${entry.name}`"
            :data-testid="`catalog-edit-${entry.id}`"
            :disabled="busy"
            @click="emit('edit', entry)"
          >
            Изменить
          </UiButton>
          <UiButton
            v-else
            variant="secondary"
            size="sm"
            :aria-label="`Возобновить план ${entry.name}`"
            :data-testid="`catalog-resume-${entry.id}`"
            :disabled="busy"
            @click="emit('resume', entry)"
          >
            Возобновить
          </UiButton>
        </div>
      </li>
    </ul>
  </details>
</template>

<style scoped>
.plan-catalog {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-space-2) var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}
.plan-catalog__summary {
  display: flex;
  align-items: center;
  min-height: 2.75rem;
  font-weight: var(--hf-font-weight-semibold);
  cursor: pointer;
}
.plan-catalog__summary:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}
.plan-catalog__items {
  display: grid;
  gap: var(--hf-space-2);
  margin: var(--hf-space-2) 0;
  padding: 0;
  list-style: none;
}
.plan-catalog__empty,
.plan-catalog__error {
  margin: var(--hf-space-2) 0;
}
.plan-catalog__empty {
  color: var(--hf-color-text-muted);
}
.plan-catalog__error {
  color: var(--hf-color-text-danger);
}
.plan-catalog__status {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
}
.obligation-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-3);
  padding: var(--hf-space-3) var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
}
.obligation-row__main,
.obligation-row__amounts {
  display: grid;
  gap: var(--hf-space-1);
  min-width: 0;
}
.obligation-row__name {
  font-weight: var(--hf-font-weight-medium);
  overflow-wrap: anywhere;
}
.obligation-row__meta {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
.obligation-row__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}
</style>
