<script setup lang="ts">
import { ref } from 'vue';

import UiButton from '../ui/Button.vue';
import UiModal from '../ui/Modal.vue';

defineOptions({ name: 'AddTransferModal' });

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
}>();

const amount = ref('');
const fromAccount = ref('');
const toAccount = ref('');
const description = ref('');

function handleClose() {
  emit('close');
}

function handleSubmit() {
  // TODO: реализовать добавление перевода через API
  emit('submit');
  emit('close');
}
</script>

<template>
  <UiModal :open="open" title="Перевод между счетами" @close="handleClose">
    <form class="transfer-form" @submit.prevent="handleSubmit">
      <div class="transfer-form__field">
        <label for="transfer-amount" class="transfer-form__label">Сумма</label>
        <input
          id="transfer-amount"
          v-model="amount"
          type="number"
          step="0.01"
          min="0"
          class="transfer-form__input"
          placeholder="0.00"
          required
        />
      </div>

      <div class="transfer-form__field">
        <label for="transfer-from" class="transfer-form__label">Откуда</label>
        <select
          id="transfer-from"
          v-model="fromAccount"
          class="transfer-form__select"
          required
        >
          <option value="" disabled>Выберите счет</option>
          <option value="cash">Наличные</option>
          <option value="card">Карта</option>
        </select>
      </div>

      <div class="transfer-form__field">
        <label for="transfer-to" class="transfer-form__label">Куда</label>
        <select
          id="transfer-to"
          v-model="toAccount"
          class="transfer-form__select"
          required
        >
          <option value="" disabled>Выберите счет</option>
          <option value="cash">Наличные</option>
          <option value="card">Карта</option>
        </select>
      </div>

      <div class="transfer-form__field">
        <label for="transfer-description" class="transfer-form__label">Описание</label>
        <input
          id="transfer-description"
          v-model="description"
          type="text"
          class="transfer-form__input"
          placeholder="Например: Снятие с карты"
        />
      </div>

      <div class="transfer-form__actions">
        <UiButton type="button" variant="secondary" @click="handleClose">Отменить</UiButton>
        <UiButton type="submit" variant="primary">Перевести</UiButton>
      </div>
    </form>
  </UiModal>
</template>

<style scoped>
.transfer-form {
  display: flex;
  flex-direction: column;
  gap: var(--hf-space-5);
}

.transfer-form__field {
  display: flex;
  flex-direction: column;
  gap: var(--hf-space-2);
}

.transfer-form__label {
  color: var(--hf-color-text);
  font-size: 0.875rem;
  font-weight: var(--hf-font-weight-semibold);
}

.transfer-form__input,
.transfer-form__select {
  min-height: 44px;
  padding: var(--hf-space-3);
  color: var(--hf-color-text);
  border: 2px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  font: inherit;
  transition: border-color var(--hf-transition-fast);
}

.transfer-form__input:hover,
.transfer-form__select:hover {
  border-color: var(--hf-color-border-strong);
}

.transfer-form__input:focus,
.transfer-form__select:focus {
  border-color: var(--hf-color-action-primary);
  outline: none;
}

.transfer-form__input::placeholder {
  color: var(--hf-color-text-muted);
}

.transfer-form__select {
  cursor: pointer;
}

.transfer-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--hf-space-3);
  padding-top: var(--hf-space-3);
}
</style>
