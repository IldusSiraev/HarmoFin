<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import type { CategoryDto, TransactionDto } from '../../composables/useBudgetReferenceData.js';
import {
  toTransactionInput,
  toUpdateTransactionInput,
  type OperationFormModel,
} from '../../composables/useOperationForm.js';
import FinanceMoneyInput from '../finance/FinanceMoneyInput.vue';
import UiButton from '../ui/Button.vue';
import UiInput from '../ui/Input.vue';
import UiSelect from '../ui/Select.vue';

defineOptions({ name: 'OperationForm' });

const props = withDefaults(
  defineProps<{
    mode: 'create' | 'edit';
    model: OperationFormModel;
    accounts: ReadonlyArray<{ value: string; label: string }>;
    categories: ReadonlyArray<CategoryDto>;
    envelopes: ReadonlyArray<{ value: string; label: string }>;
    errors?: Partial<Record<string, string>>;
    pending?: boolean;
    current?: TransactionDto | null;
  }>(),
  { errors: () => ({}), pending: false, current: null },
);

const emit = defineEmits<{
  submit: [
    input: ReturnType<typeof toTransactionInput> | ReturnType<typeof toUpdateTransactionInput>,
  ];
}>();
const form = reactive({ ...props.model });

// New operations are filled out one decision at a time; editing an existing
// one shows every field at once so a correction doesn't require re-stepping
// through fields that are already right.
const stepped = props.mode === 'create';
const totalSteps = 4;
const currentStep = ref(1);

const stepTitles: Record<number, string> = {
  1: 'Когда и сколько',
  2: 'Счёт',
  3: 'Категория',
  4: 'Детали',
};

watch(
  () => props.model,
  (model) => {
    Object.assign(form, model);
    currentStep.value = 1;
  },
  { deep: true },
);
watch(
  () => form.transactionType,
  (type) => {
    if (type === 'INCOME') {
      form.envelopeId = '';
      form.merchantName = '';
    } else {
      form.sourceDescription = '';
    }
  },
);

function categoriesFor(type: 'INCOME' | 'EXPENSE') {
  return props.categories
    .filter((category) => category.categoryType === type && !category.archivedAt)
    .map((category) => ({ value: category.id, label: category.name }));
}

const canAdvance = computed(() => {
  if (currentStep.value === 1) return Boolean(form.occurredOn && form.amount);
  if (currentStep.value === 2) return Boolean(form.accountId);
  if (currentStep.value === 3) return Boolean(form.categoryId);
  return true;
});

function goNext() {
  if (canAdvance.value && currentStep.value < totalSteps) currentStep.value += 1;
}

function goBack() {
  if (currentStep.value > 1) currentStep.value -= 1;
}

function showsStep(step: number): boolean {
  return !stepped || currentStep.value === step;
}

function submit(status: 'DRAFT' | 'CONFIRMED') {
  if (props.mode === 'edit') {
    emit('submit', toUpdateTransactionInput(form, props.current?.status === 'CONFIRMED'));
    return;
  }
  emit('submit', toTransactionInput(form, status));
}
</script>

<template>
  <form class="operation-form" @submit.prevent="submit('DRAFT')">
    <p v-if="stepped" class="operation-form__step">
      Шаг {{ currentStep }} из {{ totalSteps }} · {{ stepTitles[currentStep] }}
    </p>

    <template v-if="showsStep(1)">
      <UiSelect
        v-model="form.transactionType"
        name="transactionType"
        label="Тип операции"
        :options="[
          { value: 'INCOME', label: 'Доход' },
          { value: 'EXPENSE', label: 'Расход' },
        ]"
        required
      />
      <UiInput
        v-model="form.occurredOn"
        name="occurredOn"
        label="Дата операции"
        type="date"
        :error="errors.occurredOn"
        required
      />
      <FinanceMoneyInput
        v-model="form.amount"
        name="amount"
        label="Сумма"
        :error="errors.amount"
        required
      />
    </template>

    <template v-if="showsStep(2)">
      <UiSelect
        v-model="form.accountId"
        name="accountId"
        label="Счёт"
        :options="accounts"
        :error="errors.accountId"
        required
      />
    </template>

    <template v-if="showsStep(3)">
      <UiSelect
        v-model="form.categoryId"
        name="categoryId"
        label="Категория"
        :options="categoriesFor(form.transactionType)"
        :error="errors.categoryId"
        required
      />
    </template>

    <template v-if="showsStep(4)">
      <template v-if="form.transactionType === 'INCOME'">
        <UiInput
          v-model="form.sourceDescription"
          name="sourceDescription"
          label="Источник дохода"
          :error="errors.sourceDescription"
        />
        <label class="operation-form__check"
          ><input v-model="form.isPlanned" type="checkbox" /> Запланированная операция</label
        >
      </template>
      <template v-else>
        <UiSelect
          v-model="form.envelopeId"
          name="envelopeId"
          label="Конверт"
          :options="envelopes"
          :error="errors.envelopeId"
          required
        />
        <UiInput
          v-model="form.merchantName"
          name="merchantName"
          label="Получатель или магазин"
          :error="errors.merchantName"
        />
      </template>
    </template>

    <div class="operation-form__actions">
      <UiButton
        v-if="stepped && currentStep > 1"
        type="button"
        variant="tertiary"
        :disabled="pending"
        @click="goBack"
        >Назад</UiButton
      >
      <UiButton
        v-if="stepped && currentStep < totalSteps"
        type="button"
        :disabled="!canAdvance"
        @click="goNext"
        >Далее</UiButton
      >
      <template v-if="showsStep(totalSteps)">
        <template v-if="mode === 'edit'">
          <UiButton
            type="submit"
            data-action="save-operation"
            :disabled="pending"
            :loading="pending"
            >Сохранить изменения</UiButton
          >
        </template>
        <template v-else>
          <UiButton type="submit" variant="secondary" :disabled="pending" :loading="pending"
            >Создать черновик</UiButton
          >
          <UiButton type="button" :disabled="pending" @click="submit('CONFIRMED')"
            >Подтвердить операцию</UiButton
          >
        </template>
      </template>
    </div>
  </form>
</template>

<style scoped>
.operation-form {
  display: grid;
  gap: var(--hf-space-4);
}
.operation-form__step {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.operation-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
}
.operation-form__check {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  min-height: var(--hf-control-height-md);
}
</style>
