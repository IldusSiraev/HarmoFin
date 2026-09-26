<script setup lang="ts">
import { computed } from 'vue';

import { groupByActive } from './group-by-active.js';
import PlanOccurrenceRow from './PlanOccurrenceRow.vue';
import PlanRow from './PlanRow.vue';
import UiEmptyState from '../ui/EmptyState.vue';
import type {
  PlanOccurrenceDto,
  RegularPlanDto,
} from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'PlanList' });

const props = withDefaults(
  defineProps<{
    activeTab: 'upcoming' | 'all';
    upcomingOccurrences: ReadonlyArray<PlanOccurrenceDto>;
    allPlans: ReadonlyArray<RegularPlanDto>;
    categoryIconById: Record<string, string | null>;
    pending?: boolean;
  }>(),
  { pending: false },
);

function categoryIconFor(categoryId: string | null): string | null {
  return props.categoryIconById[categoryId ?? ''] ?? null;
}

const emit = defineEmits<{
  'update:activeTab': [tab: 'upcoming' | 'all'];
  'complete-occurrence': [occurrence: PlanOccurrenceDto];
  'draft-occurrence': [occurrence: PlanOccurrenceDto];
  'skip-occurrence': [occurrence: PlanOccurrenceDto];
  'edit-occurrence': [occurrence: PlanOccurrenceDto];
  'remove-occurrence': [occurrence: PlanOccurrenceDto];
  'edit-plan': [plan: RegularPlanDto];
  'remove-plan': [plan: RegularPlanDto];
}>();

const sortedUpcoming = computed(() =>
  [...props.upcomingOccurrences].sort((left, right) =>
    left.scheduledOn.localeCompare(right.scheduledOn),
  ),
);

const planGroups = computed(() => groupByActive(props.allPlans));
</script>

<template>
  <section class="plan-list" aria-label="Список планов">
    <div class="plan-list__tabs" role="tablist">
      <button
        type="button"
        role="tab"
        data-action="plans-tab-upcoming"
        class="plan-list__tab"
        :class="{ 'plan-list__tab--active': activeTab === 'upcoming' }"
        :aria-selected="activeTab === 'upcoming'"
        @click="emit('update:activeTab', 'upcoming')"
      >
        Ближайшие
      </button>
      <button
        type="button"
        role="tab"
        data-action="plans-tab-all"
        class="plan-list__tab"
        :class="{ 'plan-list__tab--active': activeTab === 'all' }"
        :aria-selected="activeTab === 'all'"
        @click="emit('update:activeTab', 'all')"
      >
        Все
      </button>
    </div>

    <div
      v-if="activeTab === 'upcoming'"
      class="plan-list__panel"
      role="tabpanel"
      aria-label="Ближайшие"
    >
      <UiEmptyState
        v-if="sortedUpcoming.length === 0"
        title="Ближайших платежей пока нет"
        description="Ближайшие даты появятся здесь автоматически."
      />
      <ul v-else class="plan-list__items">
        <li v-for="occurrence in sortedUpcoming" :key="occurrence.id">
          <PlanOccurrenceRow
            :occurrence="occurrence"
            :category-icon="categoryIconFor(occurrence.categoryId)"
            :pending="pending"
            @complete="emit('complete-occurrence', occurrence)"
            @draft="emit('draft-occurrence', occurrence)"
            @skip="emit('skip-occurrence', occurrence)"
            @edit="emit('edit-occurrence', occurrence)"
            @remove="emit('remove-occurrence', occurrence)"
          />
        </li>
      </ul>
    </div>

    <div v-else class="plan-list__panel" role="tabpanel" aria-label="Все">
      <UiEmptyState
        v-if="planGroups.length === 0"
        title="Планов пока нет"
        description="Добавьте ожидаемый доход, расход или накопление."
      />
      <template v-else>
        <div v-for="group in planGroups" :key="String(group.active)" class="plan-list__group">
          <h3 class="plan-list__group-title">{{ group.label }}</h3>
          <ul class="plan-list__items">
            <li v-for="plan in group.items" :key="plan.id">
              <PlanRow
                :plan="plan"
                :category-icon="categoryIconFor(plan.categoryId)"
                :pending="pending"
                @edit="emit('edit-plan', plan)"
                @remove="emit('remove-plan', plan)"
              />
            </li>
          </ul>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.plan-list {
  display: grid;
  align-content: start;
  gap: var(--hf-space-4);
  padding: var(--hf-card-padding);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
/* This sidebar column is as narrow as UiListRow's own mobile breakpoint, so
   the title/amount fight for space on one line and collapse to almost
   nothing (e.g. "Продукты" renders as "П"). Force the same stacked layout
   UiListRow already uses under 599px, regardless of viewport. */
.plan-list :deep(.ui-list-row__select) {
  display: grid;
  grid-template-areas:
    'leading body'
    'leading trailing';
  grid-template-columns: auto minmax(0, 1fr);
  row-gap: 0.125rem;
}
.plan-list :deep(.ui-list-row__leading) {
  grid-area: leading;
  align-self: start;
}
.plan-list :deep(.ui-list-row__body) {
  grid-area: body;
}
.plan-list :deep(.ui-list-row__trailing) {
  grid-area: trailing;
}
.plan-list__tabs {
  display: flex;
  gap: var(--hf-space-2);
  border-bottom: 1px solid var(--hf-color-border);
}
.plan-list__tab {
  padding: var(--hf-space-2) var(--hf-space-3);
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--hf-color-text-muted);
  font: inherit;
  font-weight: var(--hf-font-weight-medium);
  cursor: pointer;
}
.plan-list__tab--active {
  border-bottom-color: var(--hf-color-brand);
  color: var(--hf-color-text);
}
.plan-list__tab:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}
/* Caps the list instead of letting a long "Ближайшие"/"Все" list stretch the
   whole card — and with it the calendar and day panel, which share this
   row's height via the default grid stretch. */
.plan-list__panel {
  max-height: 28rem;
  padding-right: var(--hf-space-2);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--hf-color-border) transparent;
}
.plan-list__panel::-webkit-scrollbar {
  width: 0.375rem;
}
.plan-list__panel::-webkit-scrollbar-track {
  background: transparent;
}
.plan-list__panel::-webkit-scrollbar-thumb {
  background: var(--hf-color-border);
  border-radius: var(--hf-radius-sm);
}
.plan-list__group + .plan-list__group {
  margin-top: var(--hf-space-4);
}
.plan-list__group-title {
  margin: 0 0 var(--hf-space-2);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  text-transform: uppercase;
}
.plan-list__items {
  display: grid;
  gap: var(--hf-space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
