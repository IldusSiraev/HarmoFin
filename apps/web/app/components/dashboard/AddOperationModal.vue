<script setup lang="ts">
import { ref } from 'vue';

import UiButton from '../ui/Button.vue';
import UiModal from '../ui/Modal.vue';

defineOptions({ name: 'AddOperationModal' });

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
}>();

const type = ref<'INCOME' | 'EXPENSE'>('EXPENSE');
const amount = ref('');
const description = ref('');

function handleClose() {
  emit('close');
}

function handleSubmit() {
  // TODO: реализовать добавление операции через API
  emit('submit');
  emit('close');
}

function setType(newType: 'INCOME' | 'EXPENSE') {
  type.value = newType;
}
</script>

<template>
  <UiModal :open="open" title="Добавить операцию" @close="handleClose">
    <form class="operation-form" @submit.prevent="handleSubmit">
      <div class="operation-form__type-selector">
        <button
          type="button"
          class="type-button"
          :class="{ 'type-button--active': type === 'EXPENSE' }"
          @click="setType('EXPENSE')"
        >
          Расход
        </button>
        <button
          type="button"
          class="type-button"
          :class="{ 'type-button--active': type === 'INCOME' }"
          @click="setType('INCOME')"
        >
          Доход
        </button>
      </div>

      <div class="operation-form__field">
        <label for="operation-amount" class="operation-form__label">Сумма</label>
        <input
          id="operation-amount"
          v-model="amount"
          type="number"
          step="0.01"
          min="0"
          class="operation-form__input"
          placeholder="0.00"
          required
        />
      </div>

      <div class="operation-form__field">
        <label for="operation-description" class="operation-form__label">Описание</label>
        <input
          id="operation-description"
          v-model="description"
          type="text"
          class="operation-form__input"
          placeholder="Например: Продукты в Магните"
        />
      </div>

      <div class="operation-form__actions">
        <UiButton type="button" variant="secondary" @click="handleClose">Отменить</UiButton>
        <UiButton type="submit" variant="primary">Добавить</UiButton>
      </div>
    </form>
  </UiModal>
</template>

<style scoped>
.operation-form {
  display: flex;
  flex-direction: column;
  gap: var(--hf-space-5);
}

.operation-form__type-selector {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--hf-space-2);
}

.type-button {
  min-height: 44px;
  padding: var(--hf-space-3);
  color: var(--hf-color-text);
  border: 2px solid var(--hf-color-border-strong);
  border-radius: var(--hf-control-radius);
  background: transparent;
  font: inherit;
  font-weight: var(--hf-font-weight-semibold);
  cursor: pointer;
  transition: all var(--hf-transition-fast);
}

.type-button:hover {
  background: var(--hf-color-action-secondary-hover);
}

.type-button:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: -2px;
}

.type-button--active {
  color: white;
  border-color: var(--hf-color-action-primary);
  background: var(--hf-color-action-primary);
}

.type-button--active:hover {
  background: var(--hf-color-action-primary-hover);
  border-color: var(--hf-color-action-primary-hover);
}

.operation-form__field {
  display: flex;
  flex-direction: column;
  gap: var(--hf-space-2);
}

.operation-form__label {
  color: var(--hf-color-text);
  font-size: 0.875rem;
  font-weight: var(--hf-font-weight-semibold);
}

.operation-form__input {
  min-height: 44px;
  padding: var(--hf-space-3);
  color: var(--hf-color-text);
  border: 2px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  font: inherit;
  transition: border-color var(--hf-transition-fast);
}

.operation-form__input:hover {
  border-color: var(--hf-color-border-strong);
}

.operation-form__input:focus {
  border-color: var(--hf-color-action-primary);
  outline: none;
}

.operation-form__input::placeholder {
  color: var(--hf-color-text-muted);
}

.operation-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--hf-space-3);
  padding-top: var(--hf-space-3);
}
</style>
