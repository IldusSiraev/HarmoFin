<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { definePageMeta } from '#imports';

import EnvelopeCard from '../../components/envelopes/EnvelopeCard.vue';
import FinanceMoneyInput from '../../components/finance/FinanceMoneyInput.vue';
import UiButton from '../../components/ui/Button.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiInput from '../../components/ui/Input.vue';
import UiSelect from '../../components/ui/Select.vue';
import UiStatus from '../../components/ui/Status.vue';
import { useAuth } from '../../composables/useAuth.js';
import {
  type BudgetDto,
  type CreateEnvelopeInput,
  type EnvelopeDto,
  type EnvelopeType,
  type ReferenceStatus,
  type UpdateEnvelopeInput,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';
import { useReferenceDataForm } from '../../composables/useReferenceDataForm.js';

defineOptions({ name: 'AppEnvelopesPage' });
definePageMeta({ middleware: 'auth' });

const envelopeFields = ['name', 'envelopeType', 'startingBalance', 'monthlyPlannedAmount', 'targetAmount', 'targetDate', 'displayOrder', 'comment'] as const;
const { currentData, loadMe } = useAuth();
const api = useBudgetReferenceData();
const formHelper = useReferenceDataForm(envelopeFields);
const envelopes = ref<EnvelopeDto[]>([]);
const budget = ref<BudgetDto | null>(null);
const loading = ref(true);
const loadError = ref('');
const summary = ref('');
const saving = ref(false);
const archiving = ref(false);
const formVisible = ref(false);
const editingId = ref<string | null>(null);
const archiveTarget = ref<EnvelopeDto | null>(null);
const status = ref<ReferenceStatus>('active');
const fieldErrors = ref<Partial<Record<(typeof envelopeFields)[number], string>>>({});
const form = reactive({
  name: '',
  envelopeType: 'CURRENT_EXPENSES' as EnvelopeType,
  startingBalance: '',
  monthlyPlannedAmount: '',
  targetAmount: '',
  targetDate: '',
  displayOrder: '0',
  comment: '',
});

const budgetId = computed(() => currentData.value?.workspaces[0]?.budgets[0]?.id);
function getStatusOptions() {
  return [
    { value: 'active', label: 'Активные' },
    { value: 'archived', label: 'В архиве' },
    { value: 'all', label: 'Все' },
  ];
}

function getEnvelopeTypeOptions() {
  return [
    { value: 'CURRENT_EXPENSES', label: 'Текущие расходы' },
    { value: 'MANDATORY_EXPENSES', label: 'Обязательные расходы' },
    { value: 'SAVINGS_GOAL', label: 'Цель накоплений' },
    { value: 'RESERVE', label: 'Резерв' },
    { value: 'FREE_MONEY', label: 'Свободные деньги' },
    { value: 'CUSTOM', label: 'Другое' },
  ];
}

function getFieldError(field: (typeof envelopeFields)[number]) {
  return fieldErrors.value[field];
}

function resetForm() {
  form.name = '';
  form.envelopeType = 'CURRENT_EXPENSES';
  form.startingBalance = '';
  form.monthlyPlannedAmount = '';
  form.targetAmount = '';
  form.targetDate = '';
  form.displayOrder = '0';
  form.comment = '';
  fieldErrors.value = {};
}

function startCreate() {
  resetForm();
  editingId.value = null;
  formVisible.value = true;
  summary.value = '';
}

function startEdit(envelope: EnvelopeDto) {
  form.name = envelope.name;
  form.envelopeType = envelope.envelopeType;
  form.startingBalance = '';
  form.monthlyPlannedAmount = '';
  form.targetAmount = '';
  form.targetDate = envelope.targetDate ?? '';
  form.displayOrder = String(envelope.displayOrder);
  form.comment = envelope.comment ?? '';
  fieldErrors.value = {};
  editingId.value = envelope.id;
  formVisible.value = true;
  summary.value = '';
}

function cancelForm() {
  formVisible.value = false;
  editingId.value = null;
  resetForm();
}

async function loadEnvelopes() {
  const id = budgetId.value;
  if (!id) return;
  envelopes.value = await api.listEnvelopes(id, status.value);
}

async function loadPage() {
  loading.value = true;
  loadError.value = '';
  try {
    if (!currentData.value) await loadMe();
    const id = budgetId.value;
    if (id) {
      [budget.value] = await Promise.all([api.getBudget(id), loadEnvelopes()]);
    }
  } catch {
    loadError.value = 'Не удалось загрузить конверты. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

async function changeStatus(value: string) {
  status.value = value as ReferenceStatus;
  await loadEnvelopes();
}

function negativeBalanceAllowed() {
  return budget.value?.allowNegativeBalance ?? false;
}

function optionalText(value: string) {
  return value.trim() || null;
}

function optionalMoney(value: string) {
  return value.trim() ? formHelper.normalizeDecimal(value) : null;
}

async function saveEnvelope() {
  const id = budgetId.value;
  if (!id) return;
  saving.value = true;
  summary.value = '';
  fieldErrors.value = {};

  try {
    if (editingId.value) {
      const input: UpdateEnvelopeInput = {
        name: form.name,
        envelopeType: form.envelopeType,
        targetDate: form.targetDate || null,
        displayOrder: Number(form.displayOrder),
        comment: optionalText(form.comment),
      };
      const monthlyPlannedAmount = optionalMoney(form.monthlyPlannedAmount);
      const targetAmount = optionalMoney(form.targetAmount);
      if (monthlyPlannedAmount !== null) {
        input.monthlyPlannedAmount = monthlyPlannedAmount;
      }
      if (targetAmount !== null) {
        input.targetAmount = targetAmount;
      }
      if (form.startingBalance.trim()) {
        input.startingBalance = formHelper.normalizeDecimal(form.startingBalance);
      }
      await api.updateEnvelope(id, editingId.value, input);
      await loadEnvelopes();
      summary.value = 'Конверт обновлён.';
    } else {
      const input: CreateEnvelopeInput = {
        name: form.name,
        envelopeType: form.envelopeType,
        currency: 'RUB',
        startingBalance: formHelper.normalizeDecimal(form.startingBalance),
        monthlyPlannedAmount: optionalMoney(form.monthlyPlannedAmount),
        targetAmount: optionalMoney(form.targetAmount),
        targetDate: form.targetDate || null,
        displayOrder: Number(form.displayOrder),
        comment: optionalText(form.comment),
      };
      await api.createEnvelope(id, input);
      await loadEnvelopes();
      summary.value = 'Конверт создан.';
    }
    cancelForm();
  } catch (error) {
    const mapped = formHelper.errorMessage(error);
    fieldErrors.value = mapped.fields;
    summary.value = mapped.summary;
  } finally {
    saving.value = false;
  }
}

function requestArchive(envelope: EnvelopeDto) {
  archiveTarget.value = envelope;
}

function cancelArchive() {
  if (!archiving.value) archiveTarget.value = null;
}

async function confirmArchive() {
  const id = budgetId.value;
  const target = archiveTarget.value;
  if (!id || !target) return;
  archiving.value = true;
  try {
    await api.archiveEnvelope(id, target.id);
    archiveTarget.value = null;
    await loadEnvelopes();
    summary.value = 'Конверт перемещён в архив.';
  } catch {
    summary.value = 'Не удалось выполнить действие. Повторите попытку.';
  } finally {
    archiving.value = false;
  }
}

onMounted(() => {
  void loadPage();
});
</script>

<template>
  <main class="reference-page">
    <header class="reference-page__header">
      <NuxtLink class="reference-page__wordmark" to="/app">HarmoFin</NuxtLink>
      <nav aria-label="Разделы бюджета">
        <NuxtLink to="/app/settings">Настройки</NuxtLink>
        <NuxtLink to="/app">Главная</NuxtLink>
      </nav>
    </header>

    <section class="reference-page__content" aria-labelledby="envelopes-title">
      <template v-if="loading">
        <UiStatus label="Загрузка конвертов…" tone="info" aria-live="polite" />
      </template>
      <template v-else-if="loadError">
        <UiEmptyState title="Конверты недоступны" :description="loadError">
          <template #action><UiButton @click="loadPage">Повторить</UiButton></template>
        </UiEmptyState>
      </template>
      <UiEmptyState v-else-if="!budgetId" title="Бюджет не выбран" description="Выберите бюджет, чтобы управлять конвертами." />
      <template v-else>
        <div class="reference-page__title-row">
          <div>
            <p class="reference-page__kicker">Справочники</p>
            <h1 id="envelopes-title">Конверты</h1>
            <p class="reference-page__description">Планируйте деньги по целям и направлениям.</p>
          </div>
          <UiButton data-action="create-envelope" @click="startCreate">Создать конверт</UiButton>
        </div>

        <UiStatus v-if="summary" class="reference-page__summary" :label="summary" tone="info" aria-live="polite" />
        <div class="reference-page__filter">
          <UiSelect :model-value="status" name="status" label="Показать конверты" :options="getStatusOptions()" @update:model-value="changeStatus" />
        </div>

        <form v-if="formVisible" class="reference-form" data-envelope-form @submit.prevent="saveEnvelope">
          <h2>{{ editingId ? 'Изменить конверт' : 'Новый конверт' }}</h2>
          <UiInput v-model="form.name" name="name" label="Название конверта" :error="getFieldError('name')" required />
          <UiSelect v-model="form.envelopeType" name="envelopeType" label="Тип конверта" :options="getEnvelopeTypeOptions()" :error="getFieldError('envelopeType')" required />
          <FinanceMoneyInput v-model="form.startingBalance" name="startingBalance" label="Начальный баланс" hint="Оставьте пустым при редактировании, чтобы сохранить текущий баланс." :error="getFieldError('startingBalance')" :required="!editingId" />
          <p v-if="negativeBalanceAllowed()" class="reference-form__note">Отрицательный баланс разрешён настройками бюджета.</p>
          <FinanceMoneyInput v-model="form.monthlyPlannedAmount" name="monthlyPlannedAmount" label="План на месяц" :error="getFieldError('monthlyPlannedAmount')" />
          <FinanceMoneyInput v-model="form.targetAmount" name="targetAmount" label="Целевая сумма" :error="getFieldError('targetAmount')" />
          <UiInput v-model="form.targetDate" name="targetDate" label="Дата цели" type="date" :error="getFieldError('targetDate')" />
          <UiInput v-model="form.displayOrder" name="displayOrder" label="Порядок отображения" inputmode="numeric" :error="getFieldError('displayOrder')" required />
          <label class="reference-form__field">
            <span>Комментарий</span>
            <textarea v-model="form.comment" name="comment" :aria-invalid="getFieldError('comment') ? 'true' : undefined" />
            <small v-if="getFieldError('comment')">{{ getFieldError('comment') }}</small>
          </label>
          <div class="reference-form__actions">
            <UiButton type="submit" :loading="saving">Сохранить конверт</UiButton>
            <UiButton type="button" variant="tertiary" :disabled="saving" @click="cancelForm">Отмена</UiButton>
          </div>
        </form>

        <UiEmptyState v-if="envelopes.length === 0" title="Конвертов пока нет" description="Добавьте конверт, чтобы планировать деньги.">
          <template #action><UiButton @click="startCreate">Создать конверт</UiButton></template>
        </UiEmptyState>
        <div v-else class="reference-grid">
          <EnvelopeCard v-for="envelope in envelopes" :key="envelope.id" :envelope="envelope">
            <template #actions>
              <UiButton variant="secondary" data-action="edit-envelope" @click="startEdit(envelope)">Изменить</UiButton>
              <UiButton v-if="!envelope.archivedAt" variant="danger" data-action="archive-envelope" @click="requestArchive(envelope)">Переместить в архив</UiButton>
            </template>
          </EnvelopeCard>
        </div>
      </template>
    </section>

    <UiConfirmDialog
      :open="archiveTarget !== null"
      title="Архивировать конверт?"
      description="Конверт останется в истории, но будет недоступен для новых операций."
      confirm-label="Архивировать конверт"
      cancel-label="Отмена"
      variant="danger"
      :loading="archiving"
      @confirm="confirmArchive"
      @cancel="cancelArchive"
    />
  </main>
</template>

<style scoped>
.reference-page { min-height: 100vh; color: var(--hf-color-text); background: var(--hf-color-page-background); }
.reference-page__header { display: flex; align-items: center; justify-content: space-between; gap: var(--hf-space-4); max-width: 70rem; margin: 0 auto; padding: var(--hf-space-5) var(--hf-space-8); }
.reference-page__wordmark, .reference-page__header nav a { color: var(--hf-color-text); text-decoration: none; }
.reference-page__wordmark { font-size: 1.125rem; font-weight: var(--hf-font-weight-bold); letter-spacing: -0.04em; }
.reference-page__header nav { display: flex; flex-wrap: wrap; gap: var(--hf-space-4); }
.reference-page__header nav a { font-weight: var(--hf-font-weight-medium); }
.reference-page__content { max-width: 70rem; margin: var(--hf-space-8) auto 0; padding: var(--hf-space-8); }
.reference-page__title-row { display: flex; align-items: end; justify-content: space-between; gap: var(--hf-space-6); }
.reference-page__kicker { margin: 0 0 var(--hf-space-2); color: var(--hf-color-action-primary-hover); font-size: 0.875rem; font-weight: var(--hf-font-weight-semibold); text-transform: uppercase; }
.reference-page h1, .reference-page h2, .reference-page__description { margin: 0; }
.reference-page h1 { font-size: clamp(2rem, 5vw, 3.25rem); letter-spacing: -0.04em; }
.reference-page__description { margin-top: var(--hf-space-3); color: var(--hf-color-text-muted); }
.reference-page__summary { margin-top: var(--hf-space-5); }
.reference-page__filter { max-width: 18rem; margin-top: var(--hf-space-6); }
.reference-form { display: grid; gap: var(--hf-space-5); max-width: 38rem; margin: var(--hf-space-6) 0; padding: var(--hf-space-6); border: 1px solid var(--hf-color-border); border-radius: var(--hf-card-radius); background: var(--hf-color-surface); }
.reference-form__field { display: grid; gap: var(--hf-space-2); color: var(--hf-color-text); font-weight: var(--hf-font-weight-medium); }
.reference-form__field textarea { min-height: 6rem; padding: var(--hf-space-3); resize: vertical; color: var(--hf-color-text); border: 1px solid var(--hf-color-border-strong); border-radius: var(--hf-control-radius); background: var(--hf-color-surface); font: inherit; }
.reference-form__field small { color: var(--hf-color-text-danger); font-weight: var(--hf-font-weight-regular); }
.reference-form__note { margin: calc(var(--hf-space-4) * -1) 0 0; color: var(--hf-color-text-muted); font-size: 0.875rem; }
.reference-form__actions { display: flex; flex-wrap: wrap; gap: var(--hf-space-3); }
.reference-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr)); gap: var(--hf-space-5); margin-top: var(--hf-space-6); }
@media (max-width: 47.9375rem) { .reference-page__header, .reference-page__content { padding-right: var(--hf-space-5); padding-left: var(--hf-space-5); } .reference-page__title-row { align-items: stretch; flex-direction: column; } .reference-page__title-row > :last-child { align-self: start; } }
</style>
