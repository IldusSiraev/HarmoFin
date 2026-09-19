<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { definePageMeta } from '#imports';

import CyclePreview from '../../../components/settings/CyclePreview.vue';
import ReferencePageLayout from '../../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiCard from '../../../components/ui/Card.vue';
import UiEmptyState from '../../../components/ui/EmptyState.vue';
import UiInput from '../../../components/ui/Input.vue';
import UiStatus from '../../../components/ui/Status.vue';
import { useAuth } from '../../../composables/useAuth.js';
import {
  type BudgetDto,
  type UpdateBudgetInput,
  useBudgetReferenceData,
} from '../../../composables/useBudgetReferenceData.js';
import { useReferenceDataForm } from '../../../composables/useReferenceDataForm.js';

defineOptions({ name: 'AppSettingsPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const cycleFields = ['cycleStartDay', 'periodBoundaryOffset'] as const;

const { currentData, loadMe } = useAuth();
const api = useBudgetReferenceData();
const formHelper = useReferenceDataForm(cycleFields);

const loading = ref(true);
const loadError = ref('');
const budget = ref<BudgetDto | null>(null);

const cycleSaving = ref(false);
const cycleSummary = ref('');
const cycleFieldErrors = ref<Partial<Record<(typeof cycleFields)[number], string>>>({});
const cycleForm = reactive({ cycleStartDay: '', periodBoundaryOffset: '' });

const templateSaving = ref(false);
const templateSummary = ref('');
const templateFailed = ref(false);

const budgetId = computed(() => currentData.value?.workspaces[0]?.budgets[0]?.id);
const previewCycleStartDay = computed(() => Number(cycleForm.cycleStartDay) || 0);
const previewPeriodBoundaryOffset = computed(() => Number(cycleForm.periodBoundaryOffset) || 0);

function syncCycleForm(nextBudget: BudgetDto) {
  cycleForm.cycleStartDay = String(nextBudget.cycleStartDay);
  cycleForm.periodBoundaryOffset = String(nextBudget.periodBoundaryOffset);
}

async function loadPage() {
  loading.value = true;
  loadError.value = '';
  try {
    if (!currentData.value) await loadMe();
    const id = budgetId.value;
    if (!id) return;
    budget.value = await api.getBudget(id);
    syncCycleForm(budget.value);
  } catch {
    loadError.value = 'Не удалось загрузить настройки бюджета. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

function getCycleFieldError(field: (typeof cycleFields)[number]) {
  return cycleFieldErrors.value[field];
}

function accountEmail() {
  return currentData.value?.user?.email ?? '';
}

async function saveCycle() {
  const id = budgetId.value;
  if (!id) return;
  cycleSaving.value = true;
  cycleSummary.value = '';
  cycleFieldErrors.value = {};
  const input: UpdateBudgetInput = {
    cycleStartDay: Number(cycleForm.cycleStartDay),
    periodBoundaryOffset: Number(cycleForm.periodBoundaryOffset),
  };
  try {
    budget.value = await api.updateBudget(id, input);
    syncCycleForm(budget.value);
    cycleSummary.value = 'Финансовый цикл сохранён.';
  } catch (error) {
    const mapped = formHelper.errorMessage(error);
    cycleFieldErrors.value = mapped.fields;
    cycleSummary.value = mapped.summary;
  } finally {
    cycleSaving.value = false;
  }
}

async function initializeTemplate() {
  const id = budgetId.value;
  if (!id) return;
  templateSaving.value = true;
  templateSummary.value = '';
  templateFailed.value = false;
  try {
    await api.initializeTemplate(id);
    templateSummary.value = 'Базовый шаблон создан.';
  } catch {
    templateFailed.value = true;
    templateSummary.value = 'Не удалось выполнить действие. Повторите попытку.';
  } finally {
    templateSaving.value = false;
  }
}

onMounted(() => {
  void loadPage();
});
</script>

<template>
  <template v-if="loading">
    <UiStatus label="Загрузка настроек…" tone="info" aria-live="polite" />
  </template>
  <UiEmptyState v-else-if="loadError" title="Настройки недоступны" :description="loadError">
    <template #action>
      <UiButton @click="loadPage">Повторить</UiButton>
    </template>
  </UiEmptyState>
  <UiEmptyState
    v-else-if="!budgetId"
    title="Бюджет не выбран"
    description="Создайте или выберите бюджет, чтобы изменить настройки."
  />
  <ReferencePageLayout v-else>
    <template #kicker>Настройки</template>
    <template #title>Настройки</template>
    <template #content>
      <p class="settings-page__help-link">
        <NuxtLink to="/app/help">Как пользоваться HarmoFin</NuxtLink>
      </p>
      <div class="settings-page__grid">
        <UiCard
          as="section"
          class="settings-page__area settings-page__area--budget"
          aria-labelledby="settings-budget-title"
        >
          <template #header><h2 id="settings-budget-title">Бюджет</h2></template>
          <NuxtLink to="/app/settings/general" class="settings-page__row">
            <span>Общие настройки</span>
            <span class="settings-page__row-link">Изменить →</span>
          </NuxtLink>
          <div class="settings-page__static-row">
            <div>
              <p class="settings-page__static-row-title">Базовый шаблон</p>
              <p class="settings-page__hint">Создаёт отсутствующие категории и конверты.</p>
            </div>
            <UiButton
              variant="tertiary"
              size="sm"
              data-action="initialize-template"
              :loading="templateSaving"
              @click="initializeTemplate"
            >
              Создать базовый шаблон
            </UiButton>
          </div>
          <UiStatus
            v-if="templateSummary"
            :label="templateSummary"
            :tone="templateFailed ? 'danger' : 'success'"
            aria-live="polite"
          />
        </UiCard>

        <UiCard
          as="section"
          class="settings-page__area settings-page__area--cycle"
          aria-labelledby="settings-cycle-title"
        >
          <template #header><h2 id="settings-cycle-title">Финансовый цикл</h2></template>
          <UiStatus
            v-if="cycleSummary"
            :label="cycleSummary"
            :tone="Object.keys(cycleFieldErrors).length ? 'danger' : 'success'"
            aria-live="polite"
          />
          <form class="settings-page__cycle-form" @submit.prevent="saveCycle">
            <UiInput
              v-model="cycleForm.cycleStartDay"
              name="cycleStartDay"
              label="Начало первого периода"
              tooltip="Финансовый месяц — это ваш период планирования денег между двумя поступлениями. Не обязательно начинается 1-го числа: укажите день, который соответствует вашему графику доходов."
              inputmode="numeric"
              :error="getCycleFieldError('cycleStartDay')"
              required
            />
            <UiInput
              v-model="cycleForm.periodBoundaryOffset"
              name="periodBoundaryOffset"
              label="Граница второго периода (дней от начала первого)"
              tooltip="Финансовый месяц делится на два периода — например, от аванса до зарплаты и от зарплаты до аванса. Здесь указывается, через сколько дней после начала первого периода начинается второй."
              inputmode="numeric"
              :error="getCycleFieldError('periodBoundaryOffset')"
              required
            />
            <CyclePreview
              v-if="previewCycleStartDay && previewPeriodBoundaryOffset"
              :cycle-start-day="previewCycleStartDay"
              :period-boundary-offset="previewPeriodBoundaryOffset"
            />
            <p class="settings-page__cycle-note">
              Изменение цикла не меняет даты операций, но пересчитывает их принадлежность к периодам
              и циклам.
            </p>
            <UiButton type="submit" :loading="cycleSaving">Сохранить</UiButton>
          </form>
        </UiCard>

        <UiCard
          as="section"
          class="settings-page__area settings-page__area--account"
          aria-labelledby="settings-account-title"
        >
          <template #header><h2 id="settings-account-title">Аккаунт</h2></template>
          <div class="settings-page__static-row">
            <p class="settings-page__static-row-title">{{ accountEmail() }}</p>
          </div>
          <NuxtLink to="/app/settings/password" class="settings-page__row">
            <span>Пароль</span>
            <span class="settings-page__row-link">Изменить →</span>
          </NuxtLink>
          <NuxtLink to="/app/settings/sessions" class="settings-page__row">
            <span>Сессии</span>
            <span class="settings-page__row-link">Управлять →</span>
          </NuxtLink>
        </UiCard>
      </div>
    </template>
  </ReferencePageLayout>
</template>

<style scoped>
.settings-page__help-link {
  margin: 0 0 var(--hf-space-5);
  font-size: var(--hf-font-size-small);
}

/* Single column: the spec orders the cards «Бюджет», «Финансовый цикл»,
   «Аккаунт» — the cycle is promoted as the most frequently used setting. */
.settings-page__grid {
  display: grid;
  gap: var(--hf-space-5);
  grid-template-columns: 1fr;
  grid-template-areas:
    'budget'
    'cycle'
    'account';
  align-items: start;
}

.settings-page__area--budget {
  grid-area: budget;
}

.settings-page__area--cycle {
  grid-area: cycle;
}

.settings-page__area--account {
  grid-area: account;
}

.settings-page__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  padding: var(--hf-space-2) var(--hf-space-3);
  border-radius: var(--hf-radius-md);
  color: var(--hf-color-text);
  text-decoration: none;
}

.settings-page__row:hover {
  background: var(--hf-color-surface-subtle);
}

.settings-page__row-link {
  color: var(--hf-color-action-primary-hover);
  font-size: var(--hf-font-size-small);
  white-space: nowrap;
}

.settings-page__static-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  padding: var(--hf-space-2) var(--hf-space-3);
}

.settings-page__static-row-title {
  margin: 0;
  color: var(--hf-color-text);
}

.settings-page__hint {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.settings-page__cycle-form {
  display: grid;
  gap: var(--hf-space-5);
  margin-top: var(--hf-space-4);
}

.settings-page__cycle-note {
  margin: 0;
  padding: var(--hf-space-3);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

/* Two columns: «Бюджет» over «Аккаунт» on the left, «Финансовый цикл»
   spanning both rows on the right. */
@media (min-width: 48rem) {
  .settings-page__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    /* The flexible second row absorbs the taller cycle card, so the spanning
       card cannot inflate row 1 and push «Аккаунт» away from «Бюджет». */
    grid-template-rows: auto 1fr;
    grid-template-areas:
      'budget cycle'
      'account cycle';
  }
}
</style>
