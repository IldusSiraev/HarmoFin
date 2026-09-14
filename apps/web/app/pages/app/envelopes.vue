<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { definePageMeta } from '#imports';

import EnvelopeCard from '../../components/envelopes/EnvelopeCard.vue';
import FinanceMoneyInput from '../../components/finance/FinanceMoneyInput.vue';
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../components/ui/Button.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiInput from '../../components/ui/Input.vue';
import UiModal from '../../components/ui/Modal.vue';
import UiSelect from '../../components/ui/Select.vue';
import UiStatus from '../../components/ui/Status.vue';
import { useAuth } from '../../composables/useAuth.js';
import {
  type BudgetDto,
  type CreateEnvelopeInput,
  type EnvelopeDto,
  type EnvelopeType,
  type PeriodSlot,
  type ReferenceStatus,
  type UpdateEnvelopeInput,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';
import { useReferenceDataForm } from '../../composables/useReferenceDataForm.js';
import { useToast } from '../../composables/useToast.js';

defineOptions({ name: 'AppEnvelopesPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const envelopeFields = [
  'name',
  'envelopeType',
  'periodSlot',
  'startingBalance',
  'monthlyPlannedAmount',
  'targetAmount',
  'targetDate',
  'displayOrder',
  'comment',
] as const;
const { currentData, loadMe } = useAuth();
const api = useBudgetReferenceData();
const formHelper = useReferenceDataForm(envelopeFields);
const { push } = useToast();
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
  periodSlot: '' as '' | PeriodSlot,
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
  form.periodSlot = '';
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
  form.periodSlot = envelope.periodSlot ?? '';
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

function changeEnvelopeType(value: string) {
  form.envelopeType = value as EnvelopeType;
  if (form.envelopeType !== 'CURRENT_EXPENSES') form.periodSlot = '';
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
        periodSlot: form.periodSlot || null,
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
      push({ tone: 'success', title: 'Конверт обновлён' });
    } else {
      const input: CreateEnvelopeInput = {
        name: form.name,
        envelopeType: form.envelopeType,
        periodSlot: form.periodSlot || null,
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
      push({ tone: 'success', title: 'Конверт создан' });
    }
    cancelForm();
  } catch (error) {
    const mapped = formHelper.errorMessage(error);
    fieldErrors.value = mapped.fields;
    summary.value = mapped.summary;
    push({ tone: 'error', title: 'Не удалось сохранить', description: mapped.summary });
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
    push({ tone: 'success', title: 'Конверт перемещён в архив' });
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
  <div class="reference-page">
    <template v-if="loading">
      <UiStatus label="Загрузка конвертов…" tone="info" aria-live="polite" />
    </template>
    <template v-else-if="loadError">
      <UiEmptyState title="Конверты недоступны" :description="loadError">
        <template #action><UiButton @click="loadPage">Повторить</UiButton></template>
      </UiEmptyState>
    </template>
    <UiEmptyState
      v-else-if="!budgetId"
      title="Бюджет не выбран"
      description="Выберите бюджет, чтобы управлять конвертами."
    />
    <ReferencePageLayout v-else>
      <template #kicker>Справочники</template>
      <template #title>Конверты</template>
      <template #description>Планируйте деньги по целям и направлениям.</template>
      <template #actions>
        <UiButton data-action="create-envelope" @click="startCreate">Создать конверт</UiButton>
      </template>
      <template #filters>
        <UiSelect
          class="reference-status-filter"
          :model-value="status"
          name="status"
          label="Показать конверты"
          :options="getStatusOptions()"
          @update:model-value="changeStatus"
        />
      </template>
      <template #content>
        <UiStatus v-if="summary" :label="summary" tone="info" aria-live="polite" />
        <UiEmptyState
          v-if="envelopes.length === 0"
          title="Конвертов пока нет"
          description="Добавьте конверт, чтобы планировать деньги."
        >
          <template #action><UiButton @click="startCreate">Создать конверт</UiButton></template>
        </UiEmptyState>
        <div v-else class="reference-grid">
          <EnvelopeCard v-for="envelope in envelopes" :key="envelope.id" :envelope="envelope">
            <template #actions>
              <UiButton variant="secondary" data-action="edit-envelope" @click="startEdit(envelope)"
                >Изменить</UiButton
              >
              <NuxtLink
                class="envelope-journal-link"
                :to="`/app/operations?envelopeId=${encodeURIComponent(envelope.id)}`"
                >Операции конверта</NuxtLink
              >
              <UiButton
                v-if="!envelope.archivedAt"
                variant="danger"
                data-action="archive-envelope"
                @click="requestArchive(envelope)"
                >Переместить в архив</UiButton
              >
            </template>
          </EnvelopeCard>
        </div>
      </template>
    </ReferencePageLayout>

    <UiModal
      :open="formVisible"
      :title="editingId ? 'Изменить конверт' : 'Новый конверт'"
      @close="cancelForm"
    >
      <form data-envelope-form @submit.prevent="saveEnvelope">
        <UiInput
          v-model="form.name"
          name="name"
          label="Название конверта"
          :error="getFieldError('name')"
          required
        />
        <UiSelect
          v-model="form.envelopeType"
          name="envelopeType"
          label="Тип конверта"
          tooltip="Определяет, попадает ли конверт в лимит текущего периода или живёт вне периодов (резерв, цель, свободные деньги)."
          :options="getEnvelopeTypeOptions()"
          :error="getFieldError('envelopeType')"
          required
          @update:model-value="changeEnvelopeType"
        />
        <UiSelect
          v-if="form.envelopeType === 'CURRENT_EXPENSES'"
          v-model="form.periodSlot"
          name="periodSlot"
          label="Период текущих расходов"
          :options="[
            { value: '', label: 'Не относится к периоду' },
            { value: 'FIRST', label: 'Первый период' },
            { value: 'SECOND', label: 'Второй период' },
          ]"
          :error="getFieldError('periodSlot')"
        />
        <FinanceMoneyInput
          v-model="form.startingBalance"
          name="startingBalance"
          label="Начальный баланс"
          tooltip="Сумма в конверте на дату начала учёта — используется только один раз, при создании конверта."
          hint="Оставьте пустым при редактировании, чтобы сохранить текущий баланс."
          :error="getFieldError('startingBalance')"
          :required="!editingId"
        />
        <p v-if="negativeBalanceAllowed()" class="reference-form__note">
          Отрицательный баланс разрешён настройками бюджета.
        </p>
        <FinanceMoneyInput
          v-model="form.monthlyPlannedAmount"
          name="monthlyPlannedAmount"
          label="План на месяц"
          :error="getFieldError('monthlyPlannedAmount')"
        />
        <FinanceMoneyInput
          v-model="form.targetAmount"
          name="targetAmount"
          label="Целевая сумма"
          :error="getFieldError('targetAmount')"
        />
        <UiInput
          v-model="form.targetDate"
          name="targetDate"
          label="Дата цели"
          type="date"
          :error="getFieldError('targetDate')"
        />
        <UiInput
          v-model="form.displayOrder"
          name="displayOrder"
          label="Порядок отображения"
          inputmode="numeric"
          :error="getFieldError('displayOrder')"
          required
        />
        <label class="reference-form__field">
          <span>Комментарий</span>
          <textarea
            v-model="form.comment"
            name="comment"
            :aria-invalid="getFieldError('comment') ? 'true' : undefined"
          />
          <small v-if="getFieldError('comment')">{{ getFieldError('comment') }}</small>
        </label>
        <div class="reference-form__actions">
          <UiButton type="submit" :loading="saving">Сохранить конверт</UiButton>
          <UiButton type="button" variant="tertiary" :disabled="saving" @click="cancelForm"
            >Отмена</UiButton
          >
        </div>
      </form>
    </UiModal>

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
  </div>
</template>

<style scoped>
form[data-envelope-form] {
  display: grid;
  gap: var(--hf-space-5);
}
.reference-form__field {
  display: grid;
  gap: var(--hf-space-2);
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
}
.reference-form__field textarea {
  min-height: 6rem;
  padding: var(--hf-space-3);
  resize: vertical;
  color: var(--hf-color-text);
  border: 1px solid var(--hf-color-border-strong);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  font: inherit;
}
.reference-form__field small {
  color: var(--hf-color-text-danger);
  font-weight: var(--hf-font-weight-regular);
}
.reference-form__note {
  margin: calc(var(--hf-space-4) * -1) 0 0;
  color: var(--hf-color-text-muted);
  font-size: 0.875rem;
}
.reference-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
}
.reference-status-filter {
  max-width: 18rem;
}
.reference-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
  gap: var(--hf-space-5);
}
.envelope-journal-link {
  display: inline-flex;
  align-items: center;
  min-height: var(--hf-control-height-md);
  color: var(--hf-color-action-primary-hover);
  font-weight: var(--hf-font-weight-medium);
  text-decoration: none;
}
.envelope-journal-link:hover {
  text-decoration: underline;
}
</style>
