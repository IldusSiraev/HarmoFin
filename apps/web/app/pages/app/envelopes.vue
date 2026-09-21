<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { definePageMeta, navigateTo, useRoute } from '#imports';

import EnvelopeDrawer from '../../components/envelopes/EnvelopeDrawer.vue';
import EnvelopeRow from '../../components/envelopes/EnvelopeRow.vue';
import { groupByType } from '../../components/envelopes/group-by-type.js';
import FinanceMoney from '../../components/finance/FinanceMoney.vue';
import FinanceMoneyInput from '../../components/finance/FinanceMoneyInput.vue';
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiActionMenu from '../../components/ui/ActionMenu.vue';
import UiButton from '../../components/ui/Button.vue';
import UiChip from '../../components/ui/Chip.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import UiDatePicker from '../../components/ui/DatePicker.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiInput from '../../components/ui/Input.vue';
import UiModal from '../../components/ui/Modal.vue';
import UiSelect from '../../components/ui/Select.vue';
import UiSkeleton from '../../components/ui/Skeleton.vue';
import UiStatus from '../../components/ui/Status.vue';
import { useAuth } from '../../composables/useAuth.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';
import {
  type BudgetDto,
  type CreateEnvelopeInput,
  type EnvelopeDto,
  type EnvelopeSummaryDto,
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
const route = useRoute();
const api = useBudgetReferenceData();
const formHelper = useReferenceDataForm(envelopeFields);
const { push } = useToast();
const envelopes = ref<EnvelopeDto[]>([]);
const summary = ref<EnvelopeSummaryDto | null>(null);
const detailed = ref<EnvelopeDto | null>(null);
const budget = ref<BudgetDto | null>(null);
const loading = ref(true);
const loadError = ref('');
// A short-lived confirmation/failure line for form and archive actions,
// separate from the server-computed envelopes summary above the list.
const statusMessage = ref('');
const saving = ref(false);
const archiving = ref(false);
const formVisible = ref(false);
const editingId = ref<string | null>(null);
const archiveTarget = ref<EnvelopeDto | null>(null);
const hydrated = ref(false);
// The archive filter lives in the URL so the view survives a reload and can be shared.
const status = ref<ReferenceStatus>(route.query.status === 'archived' ? 'archived' : 'active');
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
const groups = computed(() => groupByType(envelopes.value, summary.value));

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
  statusMessage.value = '';
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
  // Close the drawer first, otherwise the modal opens stacked on top of it.
  detailed.value = null;
  formVisible.value = true;
  statusMessage.value = '';
}

function cancelForm() {
  formVisible.value = false;
  editingId.value = null;
  resetForm();
}

async function loadEnvelopes(): Promise<void> {
  const id = budgetId.value;
  if (!id) return;
  // A reference record may have just changed, so the shared cache the journal,
  // the transfers page and the global dialogs read must not stay on old names.
  useOperationReferenceData().invalidate();
  const [items, totals] = await Promise.all([
    api.listEnvelopes(id, status.value),
    api.getEnvelopesSummary(id, status.value),
  ]);
  envelopes.value = items;
  summary.value = totals;
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

async function toggleArchived(): Promise<void> {
  status.value = status.value === 'archived' ? 'active' : 'archived';
  await navigateTo(
    { path: route.path, query: status.value === 'archived' ? { status: 'archived' } : {} },
    { replace: true },
  );
  await loadPage();
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
  statusMessage.value = '';
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
      statusMessage.value = 'Конверт обновлён.';
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
      statusMessage.value = 'Конверт создан.';
      push({ tone: 'success', title: 'Конверт создан' });
    }
    cancelForm();
  } catch (error) {
    const mapped = formHelper.errorMessage(error);
    fieldErrors.value = mapped.fields;
    statusMessage.value = mapped.summary;
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
    detailed.value = null;
    await loadEnvelopes();
    statusMessage.value = 'Конверт перемещён в архив.';
    push({ tone: 'success', title: 'Конверт перемещён в архив' });
  } catch {
    statusMessage.value = 'Не удалось выполнить действие. Повторите попытку.';
  } finally {
    archiving.value = false;
  }
}

onMounted(() => {
  hydrated.value = true;
  void loadPage();
});
</script>

<template>
  <div v-if="hydrated" class="reference-page" data-hydrated="true">
    <template v-if="loadError">
      <UiEmptyState title="Конверты недоступны" :description="loadError">
        <template #action><UiButton @click="loadPage">Повторить</UiButton></template>
      </UiEmptyState>
    </template>
    <UiEmptyState
      v-else-if="!loading && !budgetId"
      title="Бюджет не выбран"
      description="Выберите бюджет, чтобы управлять конвертами."
    />
    <ReferencePageLayout v-else>
      <template #kicker>Справочники</template>
      <template #title>Конверты</template>
      <template #description>
        Конверт показывает, для чего предназначены деньги — например, продукты, ипотека или ремонт.
        Один счёт может одновременно содержать деньги нескольких конвертов.
      </template>
      <template #actions>
        <UiButton data-action="create-envelope" @click="startCreate">Создать конверт</UiButton>
      </template>
      <template #filters>
        <UiChip
          label="В архиве"
          :active="status === 'archived'"
          data-testid="chip-archived"
          @click="toggleArchived"
        />
      </template>
      <template #content>
        <UiStatus v-if="statusMessage" :label="statusMessage" tone="info" aria-live="polite" />

        <div
          v-if="loading && envelopes.length === 0"
          data-testid="envelopes-loading"
          aria-busy="true"
        >
          <UiSkeleton variant="row" :count="4" />
        </div>

        <template v-else>
          <p v-if="summary" class="envelopes-page__total" data-testid="envelopes-total">
            Всего в конвертах
            <FinanceMoney
              :minor-units="summary.totalMinor"
              :currency="summary.currency"
              :scale="summary.scale"
            />
          </p>

          <UiEmptyState
            v-if="envelopes.length === 0 && status === 'archived'"
            title="В архиве пусто"
            description="Архивные конверты появятся здесь после архивирования."
          />
          <UiEmptyState
            v-else-if="envelopes.length === 0"
            title="Конвертов пока нет"
            description="Создайте конверт, чтобы распределять в него деньги."
          >
            <template #action><UiButton @click="startCreate">Создать конверт</UiButton></template>
          </UiEmptyState>

          <div v-if="groups.length > 0" class="envelopes-page__panel">
            <section
              v-for="group in groups"
              :key="group.envelopeType"
              class="envelopes-page__group"
            >
              <header class="envelopes-page__group-header">
                <h2 class="envelopes-page__group-label" data-testid="envelope-group-label">
                  {{ group.label }}
                </h2>
                <p
                  v-if="group.totalMinor !== null"
                  class="envelopes-page__group-total"
                  data-testid="envelope-group-total"
                >
                  <FinanceMoney :minor-units="group.totalMinor" currency="RUB" :scale="2" />
                </p>
              </header>

              <ul class="envelopes-page__list" :aria-label="`Конверты: ${group.label}`">
                <li
                  v-for="envelope in group.items"
                  :key="envelope.id"
                  class="envelopes-page__list-item"
                >
                  <EnvelopeRow :envelope="envelope" @select="detailed = envelope">
                    <template #actions>
                      <UiActionMenu
                        label="Действия над конвертом"
                        :trigger-test-id="`row-actions-${envelope.id}`"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          data-testid="row-edit"
                          data-action="edit-envelope"
                          @click="startEdit(envelope)"
                        >
                          Изменить
                        </button>
                        <NuxtLink
                          role="menuitem"
                          data-testid="row-operations"
                          :to="`/app/operations?envelopeId=${encodeURIComponent(envelope.id)}`"
                        >
                          Операции конверта
                        </NuxtLink>
                        <button
                          v-if="!envelope.archivedAt"
                          type="button"
                          role="menuitem"
                          data-testid="row-archive"
                          data-action="archive-envelope"
                          @click="requestArchive(envelope)"
                        >
                          Переместить в архив
                        </button>
                      </UiActionMenu>
                    </template>
                  </EnvelopeRow>
                </li>
              </ul>
            </section>
          </div>
        </template>
      </template>
    </ReferencePageLayout>

    <EnvelopeDrawer
      :envelope="detailed"
      @close="detailed = null"
      @edit="startEdit"
      @archive="requestArchive"
    />

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
          label="Плановая сумма в месяц"
          tooltip="Сколько денег вы обычно выделяете на этот конверт за месяц. Используется, чтобы сравнивать план с фактическими тратами. Необязательно."
          :error="getFieldError('monthlyPlannedAmount')"
        />
        <FinanceMoneyInput
          v-model="form.targetAmount"
          name="targetAmount"
          label="Целевая сумма накоплений"
          tooltip="Сумма, которую хотите накопить в этом конверте — например, на отпуск, ремонт или подушку безопасности. Необязательно."
          :error="getFieldError('targetAmount')"
        />
        <UiDatePicker
          v-model="form.targetDate"
          name="targetDate"
          label="Срок достижения цели"
          tooltip="Дата, к которой хотите накопить целевую сумму. Необязательно."
          :error="getFieldError('targetDate')"
        />
        <details class="reference-form__advanced">
          <summary>Дополнительные настройки</summary>
          <UiInput
            v-model="form.displayOrder"
            name="displayOrder"
            label="Порядок в списке"
            tooltip="Чем меньше число, тем выше конверт в списке. Можно оставить как есть."
            inputmode="numeric"
            :error="getFieldError('displayOrder')"
            required
          />
        </details>
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
.reference-form__advanced {
  color: var(--hf-color-text);
}
.reference-form__advanced summary {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
  cursor: pointer;
}
.reference-form__advanced > :not(summary) {
  margin-top: var(--hf-space-3);
}
.reference-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
}
.envelopes-page__total {
  margin: 0;
  display: flex;
  gap: var(--hf-space-2);
  align-items: baseline;
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-h3);
  font-weight: var(--hf-font-weight-semibold);
}
.envelopes-page__panel {
  padding: var(--hf-space-2) var(--hf-card-padding);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.envelopes-page__group {
  display: grid;
  gap: var(--hf-space-3);
  padding-top: var(--hf-space-6);
}
.envelopes-page__group:first-of-type {
  padding-top: var(--hf-space-4);
}
.envelopes-page__group-header {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: baseline;
  justify-content: space-between;
  padding-bottom: var(--hf-space-2);
  border-bottom: 1px solid var(--hf-color-border);
}
.envelopes-page__group-label {
  margin: 0;
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
}
.envelopes-page__group-total {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-weight: var(--hf-font-weight-medium);
}
.envelopes-page__list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}
.envelopes-page__list-item {
  min-width: 0;
}
.envelopes-page__list-item + .envelopes-page__list-item {
  border-top: 1px solid var(--hf-color-border);
}
</style>
