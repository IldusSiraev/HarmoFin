<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { definePageMeta } from '#imports';

import UiButton from '../../components/ui/Button.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiInput from '../../components/ui/Input.vue';
import UiSelect from '../../components/ui/Select.vue';
import UiStatus from '../../components/ui/Status.vue';
import { useAuth } from '../../composables/useAuth.js';
import {
  type BudgetDto,
  type CategoryDto,
  type EnvelopeDto,
  type UpdateBudgetInput,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';
import { useReferenceDataForm } from '../../composables/useReferenceDataForm.js';

defineOptions({ name: 'AppSettingsPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const settingsFields = [
  'name',
  'timezone',
  'cycleStartDay',
  'periodBoundaryOffset',
  'incomeAllocationSourceCategoryId',
  'incomeAllocationTargetEnvelopeId',
] as const;

const { currentData, loadMe } = useAuth();
const api = useBudgetReferenceData();
const formHelper = useReferenceDataForm(settingsFields);
const loading = ref(true);
const saving = ref(false);
const initializingTemplate = ref(false);
const loadError = ref('');
const summary = ref('');
const fieldErrors = ref<Partial<Record<(typeof settingsFields)[number], string>>>({});
const budget = ref<BudgetDto | null>(null);
const categories = ref<CategoryDto[]>([]);
const envelopes = ref<EnvelopeDto[]>([]);
const form = reactive({
  name: '',
  timezone: '',
  cycleStartDay: '',
  periodBoundaryOffset: '',
  allowNegativeBalance: false,
  incomeAllocationRuleEnabled: false,
  incomeAllocationSourceCategoryId: '',
  incomeAllocationTargetEnvelopeId: '',
});

const budgetId = computed(() => currentData.value?.workspaces[0]?.budgets[0]?.id);

function syncForm(nextBudget: BudgetDto) {
  form.name = nextBudget.name;
  form.timezone = nextBudget.timezone;
  form.cycleStartDay = String(nextBudget.cycleStartDay);
  form.periodBoundaryOffset = String(nextBudget.periodBoundaryOffset);
  form.allowNegativeBalance = nextBudget.allowNegativeBalance;
  form.incomeAllocationRuleEnabled = nextBudget.incomeAllocationRuleEnabled;
  form.incomeAllocationSourceCategoryId = nextBudget.incomeAllocationRuleEnabled
    ? (nextBudget.incomeAllocationSourceCategoryId ?? '')
    : '';
  form.incomeAllocationTargetEnvelopeId = nextBudget.incomeAllocationRuleEnabled
    ? (nextBudget.incomeAllocationTargetEnvelopeId ?? '')
    : '';
}

async function loadReferenceData() {
  const id = budgetId.value;
  if (!id) return;

  const [nextBudget, nextCategories, nextEnvelopes] = await Promise.all([
    api.getBudget(id),
    api.listCategories(id, 'INCOME', 'active'),
    api.listEnvelopes(id, 'active'),
  ]);
  budget.value = nextBudget;
  categories.value = nextCategories;
  envelopes.value = nextEnvelopes;
  syncForm(nextBudget);
}

async function loadPage() {
  loading.value = true;
  loadError.value = '';

  try {
    if (!currentData.value) await loadMe();
    await loadReferenceData();
  } catch {
    loadError.value = 'Не удалось загрузить настройки бюджета. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

function getIncomeCategoryOptions() {
  return categories.value.map((category) => ({ value: category.id, label: category.name }));
}

function getEnvelopeOptions() {
  return envelopes.value.map((envelope) => ({ value: envelope.id, label: envelope.name }));
}

function getFieldError(field: (typeof settingsFields)[number]) {
  return fieldErrors.value[field];
}

function requiresRuleReferences() {
  return (
    form.incomeAllocationRuleEnabled &&
    (!form.incomeAllocationSourceCategoryId || !form.incomeAllocationTargetEnvelopeId)
  );
}

async function saveSettings() {
  const id = budgetId.value;
  if (!id || requiresRuleReferences()) return;

  saving.value = true;
  summary.value = '';
  fieldErrors.value = {};

  const input: UpdateBudgetInput = {
    name: form.name,
    timezone: form.timezone,
    cycleStartDay: Number(form.cycleStartDay),
    periodBoundaryOffset: Number(form.periodBoundaryOffset),
    allowNegativeBalance: form.allowNegativeBalance,
    incomeAllocationRuleEnabled: form.incomeAllocationRuleEnabled,
    incomeAllocationSourceCategoryId: form.incomeAllocationRuleEnabled
      ? form.incomeAllocationSourceCategoryId
      : undefined,
    incomeAllocationTargetEnvelopeId: form.incomeAllocationRuleEnabled
      ? form.incomeAllocationTargetEnvelopeId
      : undefined,
  };

  try {
    await api.updateBudget(id, input);
    await loadReferenceData();
    summary.value = 'Настройки бюджета сохранены.';
  } catch (error) {
    const mapped = formHelper.errorMessage(error);
    fieldErrors.value = mapped.fields;
    summary.value = mapped.summary;
  } finally {
    saving.value = false;
  }
}

async function initializeTemplate() {
  const id = budgetId.value;
  if (!id) return;

  initializingTemplate.value = true;
  summary.value = '';

  try {
    await api.initializeTemplate(id);
    await loadReferenceData();
    summary.value = 'Базовый шаблон создан.';
  } catch {
    summary.value = 'Не удалось выполнить действие. Повторите попытку.';
  } finally {
    initializingTemplate.value = false;
  }
}

onMounted(() => {
  void loadPage();
});
</script>

<template>
  <div class="settings-page">
    <section class="settings-page__content">
      <template v-if="loading">
        <UiStatus label="Загрузка настроек…" tone="info" aria-live="polite" />
      </template>
      <template v-else-if="loadError">
        <UiEmptyState title="Настройки недоступны" :description="loadError">
          <template #action>
            <UiButton @click="loadPage">Повторить</UiButton>
          </template>
        </UiEmptyState>
      </template>
      <UiEmptyState
        v-else-if="!budgetId"
        title="Бюджет не выбран"
        description="Создайте или выберите бюджет, чтобы изменить настройки."
      />
      <template v-else-if="budget">
        <p class="settings-page__kicker">Настройки</p>
        <h1 id="settings-title">Бюджет</h1>
        <p class="settings-page__description">Параметры финансового цикла и справочных данных.</p>

        <UiStatus
          v-if="summary"
          class="settings-page__summary"
          :label="summary"
          :tone="fieldErrors && Object.keys(fieldErrors).length ? 'danger' : 'success'"
          aria-live="polite"
        />

        <form class="settings-form" @submit.prevent="saveSettings">
          <UiInput
            v-model="form.name"
            name="name"
            label="Название бюджета"
            :error="getFieldError('name')"
            required
          />
          <UiInput
            v-model="form.timezone"
            name="timezone"
            label="Часовой пояс"
            hint="Например, Europe/Moscow"
            :error="getFieldError('timezone')"
            required
          />
          <UiInput
            v-model="form.cycleStartDay"
            name="cycleStartDay"
            label="День начала цикла"
            inputmode="numeric"
            :error="getFieldError('cycleStartDay')"
            required
          />
          <UiInput
            v-model="form.periodBoundaryOffset"
            name="periodBoundaryOffset"
            label="Граница периода"
            inputmode="numeric"
            :error="getFieldError('periodBoundaryOffset')"
            required
          />

          <fieldset class="settings-form__options">
            <legend>Баланс и распределение</legend>
            <label class="settings-form__checkbox">
              <input v-model="form.allowNegativeBalance" type="checkbox" />
              <span>Разрешить отрицательный баланс</span>
            </label>
            <label class="settings-form__checkbox">
              <input v-model="form.incomeAllocationRuleEnabled" type="checkbox" />
              <span>Настроить автоматическое распределение дохода</span>
            </label>
          </fieldset>

          <div v-if="form.incomeAllocationRuleEnabled" class="settings-form__rule-fields">
            <UiSelect
              v-model="form.incomeAllocationSourceCategoryId"
              name="incomeAllocationSourceCategoryId"
              label="Категория дохода"
              placeholder="Выберите категорию"
              :options="getIncomeCategoryOptions()"
              :error="getFieldError('incomeAllocationSourceCategoryId')"
              required
            />
            <UiSelect
              v-model="form.incomeAllocationTargetEnvelopeId"
              name="incomeAllocationTargetEnvelopeId"
              label="Конверт"
              placeholder="Выберите конверт"
              :options="getEnvelopeOptions()"
              :error="getFieldError('incomeAllocationTargetEnvelopeId')"
              required
            />
          </div>

          <UiButton type="submit" :loading="saving" :disabled="requiresRuleReferences()">
            Сохранить настройки
          </UiButton>
        </form>

        <section class="settings-template" aria-labelledby="settings-template-title">
          <h2 id="settings-template-title">Базовый шаблон</h2>
          <p>Создаёт отсутствующие категории и конверты. Уже созданные данные не изменяются.</p>
          <UiButton
            data-action="initialize-template"
            variant="secondary"
            :loading="initializingTemplate"
            :disabled="initializingTemplate"
            @click="initializeTemplate"
          >
            Создать базовый шаблон
          </UiButton>
        </section>
      </template>
    </section>
  </div>
</template>

<style scoped>
.settings-page {
  min-height: 100vh;
  color: var(--hf-color-text);
  background: var(--hf-color-page-background);
}

.settings-page__content {
  max-width: 44rem;
  margin: var(--hf-space-8) auto 0;
  padding: var(--hf-space-8);
}

.settings-page__kicker {
  margin: 0 0 var(--hf-space-2);
  color: var(--hf-color-action-primary-hover);
  font-size: 0.875rem;
  font-weight: var(--hf-font-weight-semibold);
  text-transform: uppercase;
}

.settings-page h1,
.settings-page h2,
.settings-page__description,
.settings-template p {
  margin: 0;
}

.settings-page h1 {
  font-size: clamp(2rem, 5vw, 3rem);
  letter-spacing: -0.04em;
}

.settings-page__description {
  margin-top: var(--hf-space-3);
  color: var(--hf-color-text-muted);
}

.settings-page__summary {
  margin-top: var(--hf-space-5);
}

.settings-form {
  display: grid;
  gap: var(--hf-space-5);
  margin-top: var(--hf-space-6);
}

.settings-form__options,
.settings-form__rule-fields,
.settings-template {
  display: grid;
  gap: var(--hf-space-4);
}

.settings-form__options {
  padding: var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
}

.settings-form__options legend {
  padding-inline: var(--hf-space-2);
  font-weight: var(--hf-font-weight-semibold);
}

.settings-form__checkbox {
  display: flex;
  align-items: center;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  color: var(--hf-color-text);
}

.settings-form__checkbox input {
  width: 1.25rem;
  height: 1.25rem;
}

.settings-template {
  margin-top: var(--hf-space-10);
  padding-top: var(--hf-space-6);
  border-top: 1px solid var(--hf-color-border);
}

.settings-template p {
  color: var(--hf-color-text-muted);
}

@media (max-width: 47.9375rem) {
  .settings-page__content {
    padding-right: var(--hf-space-5);
    padding-left: var(--hf-space-5);
  }

  .settings-page__content {
    margin-top: var(--hf-space-4);
  }
}
</style>
