<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { definePageMeta, navigateTo, useRoute } from '#imports';

import PlanCard from '../../components/plans/PlanCard.vue';
import PlanForm from '../../components/plans/PlanForm.vue';
import PlanOccurrenceCard from '../../components/plans/PlanOccurrenceCard.vue';
import UiButton from '../../components/ui/Button.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import { useAuth } from '../../composables/useAuth.js';
import { ApiRequestError } from '../../composables/useApiClient.js';
import {
  type CategoryDto,
  type CreateRegularPlanInput,
  type EnvelopeType,
  type PlanOccurrenceDto,
  type RegularPlanDto,
  type UpdateRegularPlanInput,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';

definePageMeta({ middleware: 'auth' });

const auth = useAuth();
const route = useRoute();
const api = useBudgetReferenceData();
const plans = ref<RegularPlanDto[]>([]);
const occurrences = ref<PlanOccurrenceDto[]>([]);
const accounts = ref<Array<{ value: string; label: string }>>([]);
const categories = ref<CategoryDto[]>([]);
const envelopes = ref<Array<{ value: string; label: string; envelopeType?: EnvelopeType }>>([]);
const loading = ref(true);
const pending = ref(false);
const error = ref('');
const statusText = ref('');
const formErrors = ref<Partial<Record<string, string>>>({});
const formOpen = ref(false);
const selectedPlan = ref<RegularPlanDto | null>(null);
const confirmation = ref<null | { action: 'disable' | 'remove' | 'skip' | 'complete'; id: string }>(
  null,
);
const mutationKeys = new Map<string, string>();

const budget = computed(() => auth.currentData.value?.workspaces[0]?.budgets[0] ?? null);

onMounted(() => {
  void load();
});

async function load() {
  if (!budget.value) {
    try {
      await auth.loadMe();
    } catch {
      error.value = 'Не удалось загрузить бюджет.';
    }
  }
  if (!budget.value) {
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const [planData, occurrenceData, accountData, categoryData, envelopeData] = await Promise.all([
      api.listRegularPlans(budget.value.id, 'all'),
      api.listPlanOccurrences(budget.value.id),
      api.listAccounts(budget.value.id, 'active'),
      api.listCategories(budget.value.id, undefined, 'active'),
      api.listEnvelopes(budget.value.id, 'active'),
    ]);
    plans.value = planData;
    occurrences.value = occurrenceData;
    accounts.value = accountData.map((account) => ({ value: account.id, label: account.name }));
    categories.value = categoryData;
    envelopes.value = envelopeData.map((envelope) => ({
      value: envelope.id,
      label: envelope.name,
      envelopeType: envelope.envelopeType,
    }));
  } catch {
    error.value = 'Не удалось загрузить планы. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  selectedPlan.value = null;
  formErrors.value = {};
  formOpen.value = true;
}

function openEdit(plan: RegularPlanDto) {
  selectedPlan.value = plan;
  formErrors.value = {};
  formOpen.value = true;
}

async function savePlan(input: CreateRegularPlanInput | UpdateRegularPlanInput) {
  if (!budget.value) return;
  pending.value = true;
  error.value = '';
  formErrors.value = {};
  const operation = selectedPlan.value ? `update:${selectedPlan.value.id}` : 'create';
  try {
    if (selectedPlan.value) {
      await api.updateRegularPlan(budget.value.id, selectedPlan.value.id, input, keyFor(operation));
    } else {
      await api.createRegularPlan(
        budget.value.id,
        input as CreateRegularPlanInput,
        keyFor(operation),
      );
    }
    mutationKeys.delete(operation);
    formOpen.value = false;
    selectedPlan.value = null;
    statusText.value = 'План сохранён.';
    await load();
  } catch (exception) {
    mapFormError(exception);
  } finally {
    pending.value = false;
  }
}

async function createDraft(occurrence: PlanOccurrenceDto) {
  if (!budget.value) return;
  pending.value = true;
  error.value = '';
  const operation = `draft:${occurrence.id}`;
  try {
    const draft = await api.createPlanOccurrenceDraft(
      budget.value.id,
      occurrence.id,
      keyFor(operation),
    );
    await navigateTo(`/app/operations?draftId=${encodeURIComponent(draft.id)}`);
  } catch (exception) {
    error.value = errorMessage(exception);
  } finally {
    pending.value = false;
  }
}

async function runConfirmation() {
  if (!budget.value || !confirmation.value) return;
  const current = confirmation.value;
  confirmation.value = null;
  pending.value = true;
  error.value = '';
  const operation = `${current.action}:${current.id}`;
  try {
    if (current.action === 'disable') {
      await api.updateRegularPlan(
        budget.value.id,
        current.id,
        { isActive: false },
        keyFor(operation),
      );
    }
    if (current.action === 'remove') {
      await api.deleteRegularPlan(budget.value.id, current.id, keyFor(operation));
    }
    if (current.action === 'skip') {
      await api.skipPlanOccurrence(budget.value.id, current.id, keyFor(operation));
    }
    if (current.action === 'complete') {
      await api.completePlanOccurrence(budget.value.id, current.id, keyFor(operation));
    }
    mutationKeys.delete(operation);
    statusText.value = 'Данные обновлены на сервере.';
    await load();
  } catch (exception) {
    error.value = errorMessage(exception);
  } finally {
    pending.value = false;
  }
}

function keyFor(operation: string) {
  const existing = mutationKeys.get(operation);
  if (existing) return existing;
  const key = crypto.randomUUID();
  mutationKeys.set(operation, key);
  return key;
}

function mapFormError(exception: unknown) {
  if (exception instanceof ApiRequestError) {
    formErrors.value = Object.fromEntries(
      (exception.problem.fieldErrors ?? []).map((field) => [field.field, field.message]),
    );
  }
  error.value = errorMessage(exception);
}

function errorMessage(exception: unknown) {
  return exception instanceof ApiRequestError
    ? exception.problem.detail
    : 'Не удалось выполнить действие. Повторите попытку.';
}

const highlightedOccurrenceId = computed(() =>
  typeof route.query.occurrence === 'string' ? route.query.occurrence : null,
);
</script>

<template>
  <main class="plans-page">
    <header class="plans-page__header">
      <div>
        <p class="plans-page__eyebrow">Регулярные планы</p>
        <h1>Планы и обязательства</h1>
      </div>
      <UiButton data-action="create-plan" @click="openCreate">Добавить план</UiButton>
    </header>
    <p v-if="statusText" class="plans-page__status" role="status">{{ statusText }}</p>
    <p v-if="error" class="plans-page__error" role="alert">{{ error }}</p>
    <PlanForm
      v-if="formOpen"
      :plan="selectedPlan"
      :accounts="accounts"
      :categories="categories"
      :envelopes="envelopes"
      :errors="formErrors"
      :pending="pending"
      @submit="savePlan"
    />
    <p v-if="loading">Загрузка планов…</p>
    <template v-else-if="budget">
      <section class="plans-page__section" aria-labelledby="occurrences-title">
        <div class="plans-page__section-heading">
          <h2 id="occurrences-title">Возникновения</h2>
          <p>План не меняет баланс, пока операция не подтверждена.</p>
        </div>
        <UiEmptyState
          v-if="occurrences.length === 0"
          title="Возникновений пока нет"
          description="Worker добавит ближайшие даты активных планов."
        />
        <div v-else class="plans-page__list">
          <PlanOccurrenceCard
            v-for="occurrence in occurrences"
            :key="occurrence.id"
            :class="{
              'plans-page__occurrence--highlighted': occurrence.id === highlightedOccurrenceId,
            }"
            :occurrence="occurrence"
            :pending="pending"
            @draft="createDraft(occurrence)"
            @skip="confirmation = { action: 'skip', id: occurrence.id }"
            @complete="confirmation = { action: 'complete', id: occurrence.id }"
          />
        </div>
      </section>
      <section class="plans-page__section" aria-labelledby="plans-title">
        <div class="plans-page__section-heading">
          <h2 id="plans-title">Шаблоны планов</h2>
          <p>Изменения влияют только на будущие возникновения.</p>
        </div>
        <UiEmptyState
          v-if="plans.length === 0"
          title="Планов пока нет"
          description="Добавьте ожидаемый доход, расход или накопление."
        />
        <div v-else class="plans-page__list">
          <PlanCard
            v-for="plan in plans"
            :key="plan.id"
            :plan="plan"
            :pending="pending"
            @edit="openEdit(plan)"
            @disable="confirmation = { action: 'disable', id: plan.id }"
            @remove="confirmation = { action: 'remove', id: plan.id }"
          />
        </div>
      </section>
    </template>
    <UiEmptyState
      v-else-if="!loading"
      title="Бюджет не выбран"
      description="Создайте или выберите активный бюджет, чтобы управлять планами."
    />
    <UiConfirmDialog
      :open="confirmation !== null"
      :title="confirmation?.action === 'remove' ? 'Удалить план?' : 'Подтвердить действие?'"
      :description="
        confirmation?.action === 'remove'
          ? 'Будущие возникновения будут отменены.'
          : 'Данные будут обновлены на сервере.'
      "
      confirm-label="Подтвердить"
      cancel-label="Отмена"
      variant="primary"
      :loading="pending"
      @confirm="runConfirmation"
      @cancel="confirmation = null"
    />
  </main>
</template>

<style scoped>
.plans-page {
  max-width: 70rem;
  margin: 0 auto;
  padding: var(--hf-space-8);
}
.plans-page__header {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: var(--hf-space-5);
  margin-bottom: var(--hf-space-6);
}
.plans-page__header h1,
.plans-page__eyebrow,
.plans-page__status,
.plans-page__error,
.plans-page__section-heading h2,
.plans-page__section-heading p {
  margin: 0;
}
.plans-page__header h1 {
  font-size: clamp(2rem, 4vw, 3.5rem);
  letter-spacing: -0.04em;
}
.plans-page__eyebrow {
  color: var(--hf-color-action-primary-hover);
  font-size: 0.75rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.plans-page__status {
  margin-bottom: var(--hf-space-4);
  color: var(--hf-color-text-muted);
}
.plans-page__error {
  margin-bottom: var(--hf-space-4);
  color: var(--hf-color-text-danger);
}
.plans-page__section {
  display: grid;
  gap: var(--hf-space-4);
  margin-top: var(--hf-space-8);
}
.plans-page__section-heading {
  display: grid;
  gap: var(--hf-space-1);
}
.plans-page__section-heading p {
  color: var(--hf-color-text-muted);
}
.plans-page__list {
  display: grid;
  gap: var(--hf-space-4);
}
.plans-page__occurrence--highlighted {
  outline: 3px solid var(--hf-color-action-primary);
  outline-offset: 3px;
}
@media (max-width: 47.9375rem) {
  .plans-page {
    padding: var(--hf-space-5);
  }
  .plans-page__header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
