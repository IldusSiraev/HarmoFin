<script setup lang="ts">
import { reactive, watch } from 'vue';

import {
  addTransferPart,
  removeTransferPart,
  syncSourceEnvelope,
  toCreateTransferInput,
  type TransferFormModel,
} from '../../composables/useTransferForm.js';
import FinanceMoneyInput from '../finance/FinanceMoneyInput.vue';
import UiButton from '../ui/Button.vue';
import UiDatePicker from '../ui/DatePicker.vue';
import UiInput from '../ui/Input.vue';
import UiSelect from '../ui/Select.vue';

defineOptions({ name: 'TransferForm' });

const props = withDefaults(
  defineProps<{
    model: TransferFormModel;
    accounts: ReadonlyArray<{ value: string; label: string }>;
    envelopes: ReadonlyArray<{ value: string; label: string }>;
    errors?: Partial<Record<string, string>>;
    pending?: boolean;
  }>(),
  { errors: () => ({}), pending: false },
);

const emit = defineEmits<{
  submit: [input: ReturnType<typeof toCreateTransferInput>];
}>();
const form = reactive<TransferFormModel>({
  ...props.model,
  parts: props.model.parts.map((part) => ({ ...part })),
});

watch(
  () => props.model,
  (model) => Object.assign(form, { ...model, parts: model.parts.map((part) => ({ ...part })) }),
  { deep: true },
);

function submit(status: 'DRAFT' | 'CONFIRMED') {
  emit('submit', toCreateTransferInput(form, status));
}
</script>

<template>
  <form class="transfer-form" @submit.prevent="submit('DRAFT')">
    <div class="transfer-form__core">
      <UiDatePicker
        v-model="form.occurredOn"
        name="occurredOn"
        label="Дата перевода"
        :error="errors.occurredOn"
        required
      />
      <FinanceMoneyInput
        v-model="form.total"
        name="total"
        label="Общая сумма"
        :error="errors.total"
        required
      />
      <UiSelect
        v-model="form.sourceAccountId"
        name="sourceAccountId"
        label="Счёт списания"
        :options="accounts"
        :error="errors.sourceAccountId"
        required
      />
      <UiSelect
        v-model="form.destinationAccountId"
        name="destinationAccountId"
        label="Счёт зачисления"
        :options="accounts"
        :error="errors.destinationAccountId"
        required
      />
    </div>

    <fieldset
      class="transfer-form__parts"
      :aria-describedby="errors.parts ? 'transfer-parts-error' : undefined"
    >
      <legend>Части перевода</legend>
      <p class="transfer-form__hint">
        Конверт зачисления совпадает с конвертом списания, пока его не изменить.
      </p>
      <p v-if="errors.parts" id="transfer-parts-error" class="transfer-form__error" role="alert">
        {{ errors.parts }}
      </p>
      <section
        v-for="(part, index) in form.parts"
        :key="index"
        class="transfer-form__part"
        data-transfer-part
        :aria-label="`Часть перевода ${index + 1}`"
      >
        <h3>Часть {{ index + 1 }}</h3>
        <UiSelect
          :model-value="part.sourceEnvelopeId"
          :name="`sourceEnvelopeId-${index}`"
          :label="`Конверт списания части ${index + 1}`"
          :options="envelopes"
          :error="errors[`parts.${index}.sourceEnvelopeId`]"
          required
          @update:model-value="syncSourceEnvelope(part, $event)"
        />
        <UiSelect
          v-model="part.destinationEnvelopeId"
          :name="`destinationEnvelopeId-${index}`"
          :label="`Конверт зачисления части ${index + 1}`"
          :options="envelopes"
          :error="errors[`parts.${index}.destinationEnvelopeId`]"
          required
        />
        <FinanceMoneyInput
          v-model="part.amount"
          :name="`amount-${index}`"
          :label="`Сумма части ${index + 1}`"
          :error="errors[`parts.${index}.amount`]"
          required
        />
        <UiInput
          v-model="part.comment"
          :name="`partComment-${index}`"
          label="Комментарий к части"
        />
        <UiButton
          type="button"
          variant="tertiary"
          :disabled="form.parts.length === 1 || pending"
          :aria-label="`Удалить часть ${index + 1}`"
          @click="removeTransferPart(form, index)"
          >Удалить часть {{ index + 1 }}</UiButton
        >
      </section>
      <UiButton type="button" variant="secondary" :disabled="pending" @click="addTransferPart(form)"
        >Добавить часть</UiButton
      >
    </fieldset>

    <UiInput
      v-model="form.comment"
      name="comment"
      label="Комментарий к переводу"
      :error="errors.comment"
    />
    <div class="transfer-form__actions">
      <UiButton type="submit" variant="secondary" :disabled="pending" :loading="pending"
        >Создать черновик</UiButton
      >
      <UiButton type="button" :disabled="pending" @click="submit('CONFIRMED')"
        >Подтвердить перевод</UiButton
      >
    </div>
  </form>
</template>

<style scoped>
.transfer-form,
.transfer-form__core,
.transfer-form__parts,
.transfer-form__part {
  display: grid;
  gap: var(--hf-space-4);
}
.transfer-form__parts {
  min-width: 0;
  margin: 0;
  padding: var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-card-radius);
}
.transfer-form__parts legend,
.transfer-form__part h3,
.transfer-form__hint,
.transfer-form__error {
  margin: 0;
}
.transfer-form__hint {
  color: var(--hf-color-text-muted);
}
.transfer-form__error {
  color: var(--hf-color-text-danger);
}
.transfer-form__part {
  padding: var(--hf-space-4);
  border-left: 3px solid var(--hf-color-action-primary);
  background: var(--hf-color-surface);
}
.transfer-form__part h3 {
  font-size: 1rem;
}
.transfer-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
}
</style>
