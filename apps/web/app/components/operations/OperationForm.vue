<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import {
  selectableCategories,
  type CategoryDto,
} from '../../composables/useBudgetReferenceData.js';
import type { TransactionJournalV2Item } from '../../composables/useEnvelopePlanV2.js';
import {
  createOperationEditForm,
  toUpdateTransactionV2Input,
} from '../../composables/useOperationForm.js';
import FinanceMoneyInput from '../finance/FinanceMoneyInput.vue';
import UiButton from '../ui/Button.vue';
import UiDatePicker from '../ui/DatePicker.vue';
import UiInput from '../ui/Input.vue';
import UiSelect from '../ui/Select.vue';

defineOptions({ name: 'OperationForm' });

// Edits one journal operation on the v2 API. The type is fixed, and only the
// fields the PATCH accepts are offered; the form emits just what changed.
const props = withDefaults(
  defineProps<{
    current: TransactionJournalV2Item;
    accounts: ReadonlyArray<{ value: string; label: string }>;
    categories: ReadonlyArray<CategoryDto>;
    envelopes: ReadonlyArray<{ value: string; label: string }>;
    errors?: Partial<Record<string, string>>;
    // A problem that does not belong to one field; shown inside the form so it
    // is not hidden behind the modal.
    formError?: string;
    pending?: boolean;
  }>(),
  { errors: () => ({}), formError: '', pending: false },
);

const emit = defineEmits<{
  submit: [input: ReturnType<typeof toUpdateTransactionV2Input>];
}>();

const original = computed(() => createOperationEditForm(props.current));
const form = reactive({ ...original.value });
const unchanged = ref(false);

watch(original, (next) => {
  Object.assign(form, next);
  unchanged.value = false;
});

const isExpense = computed(() => props.current.transactionType === 'EXPENSE');

const categoryOptions = computed(() =>
  selectableCategories(props.categories)
    .filter(
      (category) =>
        category.categoryType === props.current.transactionType &&
        (!category.archivedAt || category.id === props.current.categoryId),
    )
    .map((category) => ({ value: category.id, label: category.name })),
);

const envelopeOptions = computed(() => [{ value: '', label: 'Без конверта' }, ...props.envelopes]);

function submit() {
  if (props.pending) return;
  const input = toUpdateTransactionV2Input(form, original.value, props.current.transactionType);
  unchanged.value = Object.keys(input).length === 0;
  if (!unchanged.value) emit('submit', input);
}
</script>

<template>
  <form class="operation-form" novalidate @submit.prevent="submit">
    <p v-if="formError || unchanged" class="operation-form__error" role="alert">
      {{ formError || 'Нет изменений: измените хотя бы одно поле.' }}
    </p>

    <FinanceMoneyInput
      v-model="form.amount"
      name="amount"
      label="Сумма"
      :error="errors.amount"
      required
    />
    <UiDatePicker
      v-model="form.occurredOn"
      name="occurredOn"
      label="Дата операции"
      :error="errors.occurredOn"
      required
      quick-dates
    />
    <UiSelect
      v-model="form.accountId"
      name="accountId"
      label="Счёт"
      :options="accounts"
      :error="errors.accountId"
      required
    />
    <UiSelect
      v-model="form.categoryId"
      name="categoryId"
      label="Категория"
      :options="categoryOptions"
      :error="errors.categoryId"
      required
    />
    <UiSelect
      v-if="isExpense"
      v-model="form.envelopeId"
      name="envelopeId"
      label="Конверт"
      :options="envelopeOptions"
      :error="errors.envelopeId"
    />
    <UiInput v-model="form.comment" name="comment" label="Комментарий" :error="errors.comment" />

    <div class="operation-form__actions">
      <UiButton type="submit" data-action="save-operation" :disabled="pending" :loading="pending"
        >Сохранить изменения</UiButton
      >
    </div>
  </form>
</template>

<style scoped>
.operation-form {
  display: grid;
  gap: var(--hf-space-4);
}
.operation-form__error {
  margin: 0;
  color: var(--hf-color-text-danger);
}
.operation-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
}
</style>
