<script setup lang="ts">
import { reactive, watch } from 'vue';

import type {
  CategoryDto,
  CreateRegularPlanInput,
  EnvelopeDto,
  RegularPlanDto,
  UpdateRegularPlanInput,
} from '../../composables/useBudgetReferenceData.js';
import FinanceMoneyInput from '../finance/FinanceMoneyInput.vue';
import UiButton from '../ui/Button.vue';
import UiInput from '../ui/Input.vue';
import UiSelect from '../ui/Select.vue';

const props = withDefaults(
  defineProps<{
    plan?: RegularPlanDto | null;
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
  { plan: null, errors: () => ({}), pending: false },
);

const emit = defineEmits<{ submit: [input: CreateRegularPlanInput | UpdateRegularPlanInput] }>();

type FormModel = {
  name: string;
  planType: 'INCOME' | 'EXPENSE' | 'SAVINGS';
  amount: string;
  anchorOn: string;
  startOn: string;
  endOn: string;
  recurrence: 'ONE_TIME' | 'MONTHLY' | 'EVERY_N_MONTHS' | 'YEARLY';
  intervalMonths: string;
  accountId: string;
  categoryId: string;
  envelopeId: string;
  comment: string;
};

const form = reactive<FormModel>(fromPlan(props.plan));

watch(
  () => props.plan,
  (plan) => Object.assign(form, fromPlan(plan)),
);
watch(
  () => form.planType,
  (type) => {
    if (type === 'INCOME') form.envelopeId = '';
  },
);

function categoryOptions() {
  return props.categories
    .filter(
      (category) => category.categoryType === (form.planType === 'INCOME' ? 'INCOME' : 'EXPENSE'),
    )
    .map((category) => ({ value: category.id, label: category.name }));
}

function envelopeOptions() {
  return props.envelopes
    .filter((envelope) => form.planType !== 'SAVINGS' || envelope.envelopeType === 'SAVINGS_GOAL')
    .map((envelope) => ({ value: envelope.value, label: envelope.label }));
}

function normalizeAmount(value: string): string {
  return value.replace(/[\s ]/g, '').replace(',', '.');
}

function submit() {
  const input = {
    name: form.name.trim(),
    planType: form.planType,
    amount: form.amount,
    anchorOn: form.anchorOn,
    startOn: form.startOn,
    endOn: form.endOn || null,
    recurrence: form.recurrence,
    intervalMonths: form.recurrence === 'EVERY_N_MONTHS' ? Number(form.intervalMonths) : null,
    accountId: form.accountId || null,
    categoryId: form.categoryId || null,
    envelopeId: form.planType === 'INCOME' ? null : form.envelopeId || null,
    comment: form.comment.trim() || null,
  } satisfies CreateRegularPlanInput;
  emit('submit', input);
}

function fromPlan(plan: RegularPlanDto | null): FormModel {
  if (!plan) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      name: '',
      planType: 'EXPENSE',
      amount: '',
      anchorOn: today,
      startOn: today,
      endOn: '',
      recurrence: 'MONTHLY',
      intervalMonths: '',
      accountId: '',
      categoryId: '',
      envelopeId: '',
      comment: '',
    };
  }
  return {
    name: plan.name,
    planType: plan.planType,
    amount: minorToDecimal(plan.amountMinor),
    anchorOn: plan.anchorOn,
    startOn: plan.startOn,
    endOn: plan.endOn ?? '',
    recurrence: plan.recurrence,
    intervalMonths: plan.intervalMonths?.toString() ?? '',
    accountId: plan.accountId ?? '',
    categoryId: plan.categoryId ?? '',
    envelopeId: plan.envelopeId ?? '',
    comment: plan.comment ?? '',
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
    <UiInput v-model="form.name" name="name" label="Название" :error="errors.name" required />
    <UiSelect
      v-model="form.planType"
      name="planType"
      label="Тип плана"
      :options="[
        { value: 'EXPENSE', label: 'Расход' },
        { value: 'INCOME', label: 'Доход' },
        { value: 'SAVINGS', label: 'Накопление' },
      ]"
      :error="errors.planType"
      required
    />
    <FinanceMoneyInput
      :model-value="form.amount"
      name="amount"
      @update:model-value="form.amount = normalizeAmount($event)"
      label="Сумма"
      :error="errors.amount"
      required
    />
    <UiInput
      v-model="form.anchorOn"
      name="anchorOn"
      label="Опорная дата"
      type="date"
      :error="errors.anchorOn"
      required
    />
    <UiInput
      v-model="form.startOn"
      name="startOn"
      label="Дата начала"
      type="date"
      :error="errors.startOn"
      required
    />
    <UiInput
      v-model="form.endOn"
      name="endOn"
      label="Дата окончания"
      type="date"
      :error="errors.endOn"
    />
    <UiSelect
      v-model="form.recurrence"
      name="recurrence"
      label="Периодичность"
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
      label="Счёт по умолчанию"
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
      v-if="form.planType !== 'INCOME'"
      v-model="form.envelopeId"
      name="envelopeId"
      label="Конверт"
      :options="envelopeOptions()"
      :error="errors.envelopeId"
      required
    />
    <UiInput v-model="form.comment" name="comment" label="Комментарий" :error="errors.comment" />
    <UiButton type="submit" :loading="pending" :disabled="pending">Сохранить план</UiButton>
  </form>
</template>

<style scoped>
.plan-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--hf-space-4);
  padding: var(--hf-card-padding);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.plan-form > :last-child {
  grid-column: 1 / -1;
  justify-self: start;
}
@media (max-width: 47.9375rem) {
  .plan-form {
    grid-template-columns: 1fr;
  }
}
</style>
