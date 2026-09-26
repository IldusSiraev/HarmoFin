<script setup lang="ts">
import { computed, reactive, watch } from 'vue';

import {
  selectableCategories,
  type CategoryDto,
  type CreateRegularPlanInput,
  type EnvelopeDto,
  type RegularPlanDto,
  type UpdateRegularPlanInput,
} from '../../composables/useBudgetReferenceData.js';
import OperationAmountField from '../operations/OperationAmountField.vue';
import UiButton from '../ui/Button.vue';
import UiDatePicker from '../ui/DatePicker.vue';
import UiInput from '../ui/Input.vue';
import UiSelect from '../ui/Select.vue';

const props = withDefaults(
  defineProps<{
    plan?: RegularPlanDto | null;
    planType: 'INCOME' | 'EXPENSE' | 'SAVINGS';
    defaultDate?: string | undefined;
    accounts: ReadonlyArray<{ value: string; label: string }>;
    categories: ReadonlyArray<CategoryDto>;
    envelopes: ReadonlyArray<{
      value: string;
      label: string;
      envelopeType?: EnvelopeDto['envelopeType'];
    }>;
    errors?: Partial<Record<string, string>>;
    pending?: boolean;
  }>(),
  { plan: null, defaultDate: undefined, errors: () => ({}), pending: false },
);

const emit = defineEmits<{
  submit: [input: CreateRegularPlanInput | UpdateRegularPlanInput];
  remove: [];
}>();

type FormModel = {
  name: string;
  amount: string;
  date: string;
  anchorDate: string;
  endOn: string;
  recurrence: 'ONE_TIME' | 'MONTHLY' | 'EVERY_N_MONTHS' | 'YEARLY';
  intervalMonths: string;
  accountId: string;
  categoryId: string;
  envelopeId: string;
  comment: string;
  isActive: boolean;
};

const form = reactive<FormModel>(fromPlan(props.plan, props.defaultDate));
const isEditing = computed(() => props.plan !== null);

const amountAccent = computed<'danger' | 'success' | 'info'>(() => {
  if (props.planType === 'EXPENSE') return 'danger';
  if (props.planType === 'INCOME') return 'success';
  return 'info';
});

watch(
  () => props.plan,
  (plan) => Object.assign(form, fromPlan(plan, props.defaultDate)),
);
watch(
  () => props.planType,
  (type) => {
    if (type === 'INCOME') form.envelopeId = '';
  },
);

function categoryOptions() {
  return selectableCategories(props.categories)
    .filter(
      (category) => category.categoryType === (props.planType === 'INCOME' ? 'INCOME' : 'EXPENSE'),
    )
    .map((category) => ({ value: category.id, label: category.name }));
}

function envelopeOptions() {
  return props.envelopes
    .filter((envelope) => props.planType !== 'SAVINGS' || envelope.envelopeType === 'SAVINGS_GOAL')
    .map((envelope) => ({ value: envelope.value, label: envelope.label }));
}

function normalizeAmount(value: string): string {
  return value.replace(/\s/g, '').replace(',', '.');
}

function submit() {
  // The single visible "Дата" field drives both anchorOn and startOn when
  // creating. When editing a periodic plan we must preserve the stored anchor
  // (the worker derives every future occurrence's day-of-month from it), so the
  // optional "Опорная дата" field wins whenever it is set.
  const anchorOn =
    isEditing.value && form.recurrence !== 'ONE_TIME' && form.anchorDate
      ? form.anchorDate
      : form.date;
  const base = {
    name: form.name.trim(),
    planType: props.planType,
    amount: form.amount,
    anchorOn,
    startOn: form.date,
    endOn: form.endOn || null,
    recurrence: form.recurrence,
    intervalMonths: form.recurrence === 'EVERY_N_MONTHS' ? Number(form.intervalMonths) : null,
    accountId: form.accountId || null,
    categoryId: form.categoryId || null,
    envelopeId: props.planType === 'INCOME' ? null : form.envelopeId || null,
    comment: form.comment.trim() || null,
  } satisfies CreateRegularPlanInput;
  // isActive only exists on UpdateRegularPlanInput — built as a separate step
  // so the `satisfies CreateRegularPlanInput` above stays a real excess-
  // property check on the fields every plan type shares.
  const input: CreateRegularPlanInput | UpdateRegularPlanInput = isEditing.value
    ? { ...base, isActive: form.isActive }
    : base;
  emit('submit', input);
}

function fromPlan(plan: RegularPlanDto | null, defaultDate: string | undefined): FormModel {
  if (!plan) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      name: '',
      amount: '',
      date: defaultDate ?? today,
      anchorDate: '',
      endOn: '',
      recurrence: 'MONTHLY',
      intervalMonths: '',
      accountId: '',
      categoryId: '',
      envelopeId: '',
      comment: '',
      isActive: true,
    };
  }
  return {
    name: plan.name,
    amount: minorToDecimal(plan.amountMinor),
    date: plan.startOn,
    anchorDate: plan.anchorOn,
    endOn: plan.endOn ?? '',
    recurrence: plan.recurrence,
    intervalMonths: plan.intervalMonths?.toString() ?? '',
    accountId: plan.accountId ?? '',
    categoryId: plan.categoryId ?? '',
    envelopeId: plan.envelopeId ?? '',
    comment: plan.comment ?? '',
    isActive: plan.isActive,
  };
}

function minorToDecimal(value: string): string {
  const amount = BigInt(value);
  const sign = amount < 0n ? '-' : '';
  const absolute = (amount < 0n ? -amount : amount).toString().padStart(3, '0');
  return `${sign}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
}
</script>

<template>
  <form class="plan-form" @submit.prevent="submit">
    <OperationAmountField
      class="plan-form__amount"
      :model-value="form.amount"
      :accent="amountAccent"
      :error="errors.amount"
      @update:model-value="form.amount = normalizeAmount($event)"
    />

    <UiInput v-model="form.name" name="name" label="Название" :error="errors.name" required />

    <UiDatePicker v-model="form.date" name="date" label="Дата" :error="errors.anchorOn" required />

    <UiSelect
      v-model="form.recurrence"
      name="recurrence"
      label="Повторение"
      :options="[
        { value: 'ONE_TIME', label: 'Один раз' },
        { value: 'MONTHLY', label: 'Ежемесячно' },
        { value: 'EVERY_N_MONTHS', label: 'Раз в несколько месяцев' },
        { value: 'YEARLY', label: 'Ежегодно' },
      ]"
      :error="errors.recurrence"
      required
    />
    <UiInput
      v-if="form.recurrence === 'EVERY_N_MONTHS'"
      v-model="form.intervalMonths"
      name="intervalMonths"
      label="Интервал в месяцах"
      type="text"
      :error="errors.intervalMonths"
      required
    />

    <UiSelect
      v-model="form.accountId"
      name="accountId"
      label="Счёт"
      :options="accounts"
      :error="errors.accountId"
    />
    <UiSelect
      v-model="form.categoryId"
      name="categoryId"
      label="Категория"
      :options="categoryOptions()"
      :error="errors.categoryId"
      required
    />
    <UiSelect
      v-if="planType !== 'INCOME'"
      v-model="form.envelopeId"
      name="envelopeId"
      label="Конверт"
      :options="envelopeOptions()"
      :error="errors.envelopeId"
      required
    />

    <details class="plan-form__advanced">
      <summary>Дополнительные настройки</summary>
      <UiDatePicker
        v-if="isEditing && form.recurrence !== 'ONE_TIME'"
        v-model="form.anchorDate"
        name="anchorDate"
        label="Опорная дата"
        hint="День (для годовых — день и месяц) регулярного повторения. Меняйте только при переносе даты платежа."
        :error="errors.anchorOn"
      />
      <UiDatePicker
        v-model="form.endOn"
        name="endOn"
        label="Дата окончания"
        :error="errors.endOn"
      />
      <UiInput v-model="form.comment" name="comment" label="Заметка" :error="errors.comment" />
    </details>

    <label v-if="isEditing" class="plan-form__active">
      <input v-model="form.isActive" type="checkbox" name="isActive" />
      Активен
    </label>

    <div class="plan-form__actions">
      <UiButton
        v-if="isEditing"
        type="button"
        variant="danger"
        data-action="delete-plan"
        :disabled="pending"
        @click="emit('remove')"
      >
        Удалить
      </UiButton>
      <UiButton type="submit" :loading="pending" :disabled="pending">
        {{ isEditing ? 'Сохранить изменения' : 'Добавить план' }}
      </UiButton>
    </div>
  </form>
</template>

<style scoped>
.plan-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--hf-space-4);
}
.plan-form__amount,
.plan-form__advanced,
.plan-form__active,
.plan-form__actions {
  grid-column: 1 / -1;
}
.plan-form__advanced {
  color: var(--hf-color-text);
}
.plan-form__advanced summary {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
  cursor: pointer;
}
.plan-form__advanced > :not(summary) {
  margin-top: var(--hf-space-3);
}
.plan-form__active {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
}
.plan-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}
@media (max-width: 47.9375rem) {
  .plan-form {
    grid-template-columns: 1fr;
  }
}
</style>
