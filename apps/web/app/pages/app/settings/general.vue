<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { definePageMeta } from '#imports';

import ReferencePageLayout from '../../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiCard from '../../../components/ui/Card.vue';
import UiEmptyState from '../../../components/ui/EmptyState.vue';
import UiInfoTooltip from '../../../components/ui/InfoTooltip.vue';
import UiInput from '../../../components/ui/Input.vue';
import UiSelect from '../../../components/ui/Select.vue';
import UiStatus from '../../../components/ui/Status.vue';
import { useAuth } from '../../../composables/useAuth.js';
import {
  type BudgetDto,
  type UpdateBudgetInput,
  useBudgetReferenceData,
} from '../../../composables/useBudgetReferenceData.js';
import { useReferenceDataForm } from '../../../composables/useReferenceDataForm.js';

defineOptions({ name: 'AppSettingsGeneralPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const generalFields = ['name', 'timezone', 'allowNegativeBalance'] as const;

const { currentData, loadMe } = useAuth();
const api = useBudgetReferenceData();
const formHelper = useReferenceDataForm(generalFields);

const loading = ref(true);
const saving = ref(false);
const loadError = ref('');
const summary = ref('');
const fieldErrors = ref<Partial<Record<(typeof generalFields)[number], string>>>({});
const budget = ref<BudgetDto | null>(null);
const form = reactive({ name: '', timezone: '', allowNegativeBalance: false });

const budgetId = computed(() => currentData.value?.workspaces[0]?.budgets[0]?.id);

const timezoneOptions = computed(() => {
  const zones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [form.timezone || 'UTC'];
  return zones.map((zone) => ({ value: zone, label: zone }));
});

function syncForm(nextBudget: BudgetDto) {
  form.name = nextBudget.name;
  form.timezone = nextBudget.timezone;
  form.allowNegativeBalance = nextBudget.allowNegativeBalance;
}

async function loadPage() {
  loading.value = true;
  loadError.value = '';
  try {
    if (!currentData.value) await loadMe();
    const id = budgetId.value;
    if (!id) return;
    budget.value = await api.getBudget(id);
    syncForm(budget.value);
  } catch {
    loadError.value = 'Не удалось загрузить настройки бюджета. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

function getFieldError(field: (typeof generalFields)[number]) {
  return fieldErrors.value[field];
}

async function save() {
  const id = budgetId.value;
  if (!id) return;
  saving.value = true;
  summary.value = '';
  fieldErrors.value = {};
  const input: UpdateBudgetInput = {
    name: form.name,
    timezone: form.timezone,
    allowNegativeBalance: form.allowNegativeBalance,
  };
  try {
    budget.value = await api.updateBudget(id, input);
    syncForm(budget.value);
    summary.value = 'Общие настройки сохранены.';
  } catch (error) {
    const mapped = formHelper.errorMessage(error);
    fieldErrors.value = mapped.fields;
    summary.value = mapped.summary;
  } finally {
    saving.value = false;
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
    v-else-if="!budget"
    title="Бюджет не выбран"
    description="Создайте или выберите бюджет, чтобы изменить настройки."
  />
  <ReferencePageLayout v-else>
    <template #kicker>Настройки</template>
    <template #title>Общие настройки</template>
    <template #actions>
      <UiButton variant="tertiary" to="/app/settings">← Настройки</UiButton>
    </template>
    <template #content>
      <UiCard as="section">
        <UiStatus
          v-if="summary"
          :label="summary"
          :tone="Object.keys(fieldErrors).length ? 'danger' : 'success'"
          aria-live="polite"
        />
        <form class="general-settings-form" @submit.prevent="save">
          <UiInput
            v-model="form.name"
            name="name"
            label="Название бюджета"
            :error="getFieldError('name')"
            required
          />
          <UiSelect
            v-model="form.timezone"
            name="timezone"
            label="Часовой пояс"
            searchable
            :options="timezoneOptions"
            tooltip="Часовой пояс используется для расчёта границ финансового месяца и определения «сегодня» на дашборде, в отчётах и планах."
            :error="getFieldError('timezone')"
            required
          />
          <label class="general-settings-form__checkbox">
            <input v-model="form.allowNegativeBalance" type="checkbox" />
            <span>Разрешить уходить в минус</span>
            <UiInfoTooltip
              text="Если выключено, HarmoFin не даст сохранить операцию, которая уведёт счёт или конверт в минус."
            />
          </label>
          <UiButton type="submit" :loading="saving">Сохранить</UiButton>
        </form>
      </UiCard>
    </template>
  </ReferencePageLayout>
</template>

<style scoped>
.general-settings-form {
  display: grid;
  gap: var(--hf-space-5);
  margin-top: var(--hf-space-4);
}

.general-settings-form__checkbox {
  display: flex;
  align-items: center;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  color: var(--hf-color-text);
}

.general-settings-form__checkbox input {
  width: 1.25rem;
  height: 1.25rem;
}
</style>
