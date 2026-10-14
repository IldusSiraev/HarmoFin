<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { format } from 'date-fns';
import { Search, X } from '@lucide/vue';

import {
  selectableCategories,
  type CategoryDto,
} from '../../composables/useBudgetReferenceData.js';
import type { CreatePlanRequest, PlanRecurrenceV2 } from '../../composables/useEnvelopePlanV2.js';
import OperationAmountField from '../operations/OperationAmountField.vue';
import UiButton from '../ui/Button.vue';
import UiDatePicker from '../ui/DatePicker.vue';
import UiInput from '../ui/Input.vue';
import UiModal from '../ui/Modal.vue';
import UiPillSelect from '../ui/PillSelect.vue';
import {
  buildCreatePlanRequest,
  createPlanForm,
  validatePlanForm,
  type PlanFormErrors,
  type PlanFormField,
  type PlanFormModel,
  type PlanKind,
} from './plan-form.js';

defineOptions({ name: 'PlanCreateDialog' });

// Presentational: the page owns the request, the Idempotency-Key and the
// status. The dialog only validates by pattern and builds the request body;
// the amount stays text and is never computed on.

export interface PlanCreateSubmit {
  kind: PlanKind;
  request: CreatePlanRequest;
}

const props = withDefaults(
  defineProps<{
    open: boolean;
    categories: ReadonlyArray<CategoryDto>;
    pending?: boolean;
    error?: string | null;
    fieldErrors?: PlanFormErrors;
    initialKind?: PlanKind;
    initialDate?: string | undefined;
  }>(),
  {
    pending: false,
    error: null,
    fieldErrors: () => ({}),
    initialKind: 'obligation',
    initialDate: undefined,
  },
);

const emit = defineEmits<{ close: []; submit: [payload: PlanCreateSubmit] }>();

const tabs: ReadonlyArray<{ kind: PlanKind; label: string; modifier: string }> = [
  { kind: 'obligation', label: 'Платёж', modifier: 'plan-dialog__tab--obligation' },
  { kind: 'income', label: 'Доход', modifier: 'plan-dialog__tab--income' },
];
const recurrenceOptions: ReadonlyArray<{ value: PlanRecurrenceV2; label: string }> = [
  { value: 'ONE_TIME', label: 'Разово' },
  { value: 'MONTHLY', label: 'Каждый месяц' },
  { value: 'EVERY_N_MONTHS', label: 'Раз в несколько месяцев' },
  { value: 'YEARLY', label: 'Раз в год' },
];
const CATEGORY_PICKER_LIMIT = 15;

// First invalid field gets focus; ids come from each control's `name`.
const FOCUS_TARGETS: ReadonlyArray<[PlanFormField, string]> = [
  ['amount', 'operation-amount-input'],
  ['name', 'planName-input'],
  ['scheduledOn', 'planScheduledOn-input'],
  ['intervalMonths', 'planIntervalMonths-input'],
  ['categoryId', 'plan-category-group'],
  ['endOn', 'planEndOn-input'],
  ['comment', 'planComment-input'],
];

const kind = ref<PlanKind>('obligation');
const form = reactive<PlanFormModel>(createPlanForm(todayText()));
const localErrors = ref<PlanFormErrors>({});
const categorySearch = ref('');
const extrasOpen = ref(false);

function todayText(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function resetForm(): void {
  kind.value = props.initialKind;
  Object.assign(form, createPlanForm(props.initialDate ?? todayText()));
  localErrors.value = {};
  categorySearch.value = '';
  extrasOpen.value = false;
}

watch(
  () => props.open,
  (open) => open && resetForm(),
  { immediate: true },
);

watch(form, () => {
  localErrors.value = {};
});

function selectKind(next: PlanKind): void {
  if (next === kind.value) return;
  kind.value = next;
  form.categoryId = '';
  categorySearch.value = '';
}

const isObligation = computed(() => kind.value === 'obligation');
const accent = computed<'danger' | 'success'>(() => (isObligation.value ? 'danger' : 'success'));
const categoryType = computed(() => (isObligation.value ? 'EXPENSE' : 'INCOME'));
const typeNoun = computed(() => (isObligation.value ? 'расходов' : 'доходов'));

const categoryOptions = computed(() =>
  selectableCategories(props.categories)
    .filter((item) => item.categoryType === categoryType.value && !item.archivedAt)
    .map((item) => ({ value: item.id, label: item.name })),
);
const visibleCategoryOptions = computed(() => {
  const query = categorySearch.value.trim().toLowerCase();
  if (query) {
    return categoryOptions.value.filter((option) => option.label.toLowerCase().includes(query));
  }
  const shown = categoryOptions.value.slice(0, CATEGORY_PICKER_LIMIT);
  const selected = categoryOptions.value.find((option) => option.value === form.categoryId);
  return selected && !shown.includes(selected) ? [...shown, selected] : shown;
});

const canSubmit = computed(
  () =>
    form.amount.trim() !== '' &&
    form.name.trim() !== '' &&
    form.categoryId !== '' &&
    categoryOptions.value.length > 0,
);

function errorFor(field: PlanFormField): string | undefined {
  return localErrors.value[field] ?? props.fieldErrors[field];
}

// A server error on a field inside "Дополнительно" must be visible.
watch(
  () => props.fieldErrors,
  (errors) => {
    if (errors.endOn || errors.comment) extrasOpen.value = true;
  },
);

function focusFirstError(errors: PlanFormErrors): void {
  const target = FOCUS_TARGETS.find(([field]) => errors[field]);
  if (!target) return;
  if (target[0] === 'endOn' || target[0] === 'comment') extrasOpen.value = true;
  void nextTick(() => {
    const element = document.getElementById(target[1]);
    const focusable = element?.matches('input, button')
      ? element
      : element?.querySelector('button');
    focusable?.focus();
  });
}

function submit(): void {
  if (!canSubmit.value || props.pending) return;
  const errors = validatePlanForm(form);
  localErrors.value = errors;
  if (Object.keys(errors).length > 0) {
    focusFirstError(errors);
    return;
  }
  emit('submit', { kind: kind.value, request: buildCreatePlanRequest(form) });
}
</script>

<template>
  <UiModal :open="open" title="Создать план" @close="emit('close')">
    <template #header>
      <div class="plan-dialog__tabs" role="tablist" aria-label="Тип плана">
        <button
          v-for="tab in tabs"
          :key="tab.kind"
          type="button"
          role="tab"
          class="plan-dialog__tab"
          :class="[tab.modifier, { 'plan-dialog__tab--active': kind === tab.kind }]"
          :aria-selected="kind === tab.kind"
          :data-testid="`plan-tab-${tab.kind}`"
          @click="selectKind(tab.kind)"
        >
          {{ tab.label }}
        </button>
      </div>
      <button type="button" class="plan-dialog__close" aria-label="Закрыть" @click="emit('close')">
        <X :size="20" aria-hidden="true" />
      </button>
    </template>

    <p v-if="error" class="plan-dialog__error" role="alert">{{ error }}</p>

    <form class="plan-dialog__body" novalidate @submit.prevent="submit">
      <OperationAmountField
        v-model="form.amount"
        :accent="accent"
        :error="errorFor('amount')"
        hide-stepper
      />

      <UiInput
        v-model="form.name"
        name="planName"
        label="Название"
        :placeholder="isObligation ? 'Например: аренда' : 'Например: зарплата'"
        autocomplete="off"
        required
        :error="errorFor('name')"
      />

      <UiDatePicker
        v-model="form.scheduledOn"
        name="planScheduledOn"
        :label="isObligation ? 'Ближайший платёж' : 'Первое поступление'"
        required
        quick-dates
        :error="errorFor('scheduledOn')"
      />

      <UiPillSelect
        v-model="form.recurrence"
        name="planRecurrence"
        label="Повторение"
        :options="recurrenceOptions"
        :accent="accent"
        required
        :error="errorFor('recurrence')"
      />
      <UiInput
        v-if="form.recurrence === 'EVERY_N_MONTHS'"
        v-model="form.intervalMonths"
        name="planIntervalMonths"
        label="Каждые сколько месяцев"
        placeholder="От 2 до 120"
        inputmode="numeric"
        autocomplete="off"
        required
        :error="errorFor('intervalMonths')"
      />

      <p
        v-if="categoryOptions.length === 0"
        class="plan-dialog__hint"
        data-testid="plan-no-categories"
      >
        Нет категорий {{ typeNoun }}. Сначала создайте базовый шаблон: чек-лист на
        <NuxtLink to="/app">главной</NuxtLink>.
      </p>
      <div v-else id="plan-category-group" class="plan-dialog__category">
        <UiInput
          v-model="categorySearch"
          name="planCategorySearch"
          label="Поиск категории"
          hide-label
          placeholder="Поиск категории"
          autocomplete="off"
        >
          <template #icon><Search :size="16" aria-hidden="true" /></template>
        </UiInput>
        <UiPillSelect
          v-model="form.categoryId"
          name="planCategory"
          label="Категория"
          :options="visibleCategoryOptions"
          :accent="accent"
          required
          :error="errorFor('categoryId')"
        />
      </div>

      <details
        class="plan-dialog__extras"
        :open="extrasOpen"
        @toggle="extrasOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary>Дополнительно</summary>
        <div class="plan-dialog__extras-body">
          <UiDatePicker
            v-if="form.recurrence !== 'ONE_TIME'"
            v-model="form.endOn"
            name="planEndOn"
            label="Дата окончания"
            :error="errorFor('endOn')"
          />
          <UiInput
            v-model="form.comment"
            name="planComment"
            label="Комментарий"
            placeholder="Необязательно"
            autocomplete="off"
            :error="errorFor('comment')"
          />
        </div>
      </details>

      <p class="plan-dialog__hint" data-testid="plan-hint">
        {{
          isObligation
            ? 'План ничего не списывает. Когда придёт срок, нажмите «Оплатить» и выберите счёт.'
            : 'План ничего не добавляет на счёт. Когда деньги придут, нажмите «Записать доход».'
        }}
      </p>

      <UiButton
        type="submit"
        class="plan-dialog__submit"
        full-width
        data-testid="plan-submit"
        :disabled="!canSubmit || pending"
        :loading="pending"
      >
        {{ isObligation ? 'Добавить платёж' : 'Добавить доход' }}
      </UiButton>
    </form>
  </UiModal>
</template>

<style scoped>
.plan-dialog__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  flex-shrink: 0;
  border: none;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text-muted);
  cursor: pointer;
}

.plan-dialog__close:hover {
  background: var(--hf-color-action-secondary-hover);
  color: var(--hf-color-text);
}

.plan-dialog__close:focus-visible,
.plan-dialog__tab:focus-visible,
.plan-dialog__extras summary:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.plan-dialog__tabs {
  display: flex;
  flex: 1;
  justify-content: center;
  gap: var(--hf-space-1);
}

.plan-dialog__tab {
  min-height: 2.75rem;
  padding: 0 var(--hf-space-4);
  border: none;
  border-radius: var(--hf-radius-xl);
  background: transparent;
  color: var(--hf-color-text-muted);
  font: inherit;
  font-weight: var(--hf-font-weight-medium);
  cursor: pointer;
}

.plan-dialog__tab--obligation.plan-dialog__tab--active {
  background: var(--hf-color-status-danger-background);
  color: var(--hf-color-status-danger);
}

.plan-dialog__tab--income.plan-dialog__tab--active {
  background: var(--hf-color-status-success-background);
  color: var(--hf-color-status-success);
}

.plan-dialog__body {
  display: grid;
  gap: var(--hf-space-5);
}

.plan-dialog__category {
  display: grid;
  gap: var(--hf-space-3);
}

.plan-dialog__extras summary {
  min-height: 2.75rem;
  display: flex;
  align-items: center;
  color: var(--hf-color-text-muted);
  font-weight: var(--hf-font-weight-medium);
  cursor: pointer;
}

.plan-dialog__extras-body {
  display: grid;
  gap: var(--hf-space-4);
  padding-top: var(--hf-space-2);
}

.plan-dialog__hint {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.plan-dialog__error {
  margin: 0 0 var(--hf-space-4);
  color: var(--hf-color-text-danger);
}

.plan-dialog__submit {
  min-height: 2.75rem;
}
</style>
