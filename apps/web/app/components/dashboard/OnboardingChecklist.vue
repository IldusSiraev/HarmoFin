<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { CircleCheck, Circle, ChevronDown, ChevronUp } from '@lucide/vue';

import TemplatePreviewSheet from '../funding/TemplatePreviewSheet.vue';
import UiButton from '../ui/Button.vue';
import UiStatus from '../ui/Status.vue';
import { useAuth } from '../../composables/useAuth.js';
import {
  useEnvelopePlanV2,
  type DashboardV2Response,
} from '../../composables/useEnvelopePlanV2.js';
import { useFundingEntry } from '../../composables/useFundingEntry.js';
import type {
  DashboardSummaryDto,
  ReferenceTemplateResult,
} from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'OnboardingChecklist' });

const STORAGE_KEY = 'harmofin-onboarding-collapsed';

type OnboardingStatus = DashboardSummaryDto['onboarding'];
type V2Onboarding = DashboardV2Response['onboarding'];

const props = defineProps<{
  budgetId: string;
  onboarding: OnboardingStatus;
  initializeTemplate: (budgetId: string) => Promise<ReferenceTemplateResult>;
}>();

const emit = defineEmits<{
  templateInitialized: [];
}>();

type StepAction = 'template' | 'assign' | 'link';

type Step = {
  key: string;
  title: string;
  description: string;
  href: string;
  linkLabel: string;
  action: StepAction;
  done: boolean;
};

const auth = useAuth();
const funding = useFundingEntry();

// v1 budgets keep the original checklist and the direct template POST; v2
// budgets read their progress from the server's v2 dashboard onboarding block.
const isModelV2 = computed(
  () => auth.currentData.value?.workspaces[0]?.budgets[0]?.planModelVersion === 2,
);
const v2Status = ref<V2Onboarding | null>(null);
// The v2 client needs the Nuxt app context, so it is only created for v2 budgets.
const v2 = isModelV2.value ? useEnvelopePlanV2() : null;

async function loadV2Status(): Promise<void> {
  if (!isModelV2.value || !v2) return;
  try {
    v2Status.value = (await v2.getDashboard(props.budgetId)).onboarding;
  } catch {
    // Keep the last known status; the dashboard itself reports load errors.
  }
}

const v1Steps = computed<Step[]>(() => {
  const status = props.onboarding;
  return [
    {
      key: 'categoriesSeeded',
      title: 'Базовые категории и конверты',
      description:
        'Создайте набор стандартных категорий и конвертов одним нажатием — их можно будет изменить позже.',
      href: '/app/settings',
      linkLabel: 'Перейти',
      action: 'template',
      done: status.categoriesSeeded,
    },
    {
      key: 'cycleConfigured',
      title: 'Финансовый цикл',
      description:
        'Финансовый месяц не обязан начинаться 1-го числа — настройте день, который соответствует вашему графику доходов.',
      href: '/app/settings',
      linkLabel: 'Перейти',
      action: 'link',
      done: status.cycleConfigured,
    },
    {
      key: 'hasAccounts',
      title: 'Счета',
      description: 'Добавьте счета, на которых реально лежат деньги, с их текущим остатком.',
      href: '/app/accounts',
      linkLabel: 'Перейти',
      action: 'link',
      done: status.hasAccounts,
    },
    {
      key: 'hasEnvelopeStartingBalances',
      title: 'Начальные остатки конвертов',
      description:
        'Разнесите деньги со счетов по конвертам — так будет видно, что уже распределено, а что нет.',
      href: '/app/envelopes',
      linkLabel: 'Перейти',
      action: 'link',
      done: status.hasEnvelopeStartingBalances,
    },
    {
      key: 'hasAllocatedIncome',
      title: 'Первый доход и распределение',
      description:
        'Добавьте операцию дохода и распределите её по конвертам — это включит расчёт доступного лимита периода.',
      href: '/app/operations',
      linkLabel: 'Перейти',
      action: 'link',
      done: status.hasAllocatedIncome,
    },
  ];
});

const v2Steps = computed<Step[]>(() => {
  const status = v2Status.value;
  if (!status) return [];
  return [
    {
      key: 'categoriesSeeded',
      title: 'Базовые категории и конверты',
      description:
        'Посмотрите, что создастся, и подтвердите. Целевые суммы и накопления необязательны.',
      href: '/app/settings',
      linkLabel: 'Перейти',
      action: 'template',
      done: status.categoriesSeeded,
    },
    {
      key: 'periodSetup',
      title: 'Периоды и цикл',
      description: 'Проверьте границы финансового месяца и целевые суммы периодов.',
      href: '/app/settings',
      linkLabel: 'Перейти',
      action: 'link',
      done: !status.needsPeriodSetup,
    },
    {
      key: 'hasAccounts',
      title: 'Счета',
      description: 'Добавьте счета, на которых реально лежат деньги, с их текущим остатком.',
      href: '/app/accounts',
      linkLabel: 'Перейти',
      action: 'link',
      done: status.hasAccounts,
    },
    {
      key: 'openingAssignment',
      title: 'Назначить имеющиеся деньги',
      description:
        'Распределите деньги со счетов по конвертам или оставьте свободными: это можно сделать позже.',
      href: '/app/accounts',
      linkLabel: 'Перейти',
      action: 'assign',
      done: status.hasAccounts && !status.needsOpeningAssignment,
    },
    {
      key: 'hasMandatoryPlans',
      title: 'Обязательные платежи',
      description: 'Добавьте регулярные обязательные платежи, чтобы видеть, что нужно оплатить.',
      href: '/app/plans',
      linkLabel: 'Перейти',
      action: 'link',
      done: status.hasMandatoryPlans,
    },
  ];
});

const steps = computed<Step[]>(() => (isModelV2.value ? v2Steps.value : v1Steps.value));
const ready = computed(() => !isModelV2.value || v2Status.value !== null);

const collapsed = ref(false);
const templateSheetOpen = ref(false);

onMounted(() => {
  collapsed.value = window.localStorage.getItem(STORAGE_KEY) === 'true';
  void loadV2Status();
});

// A confirmed funding or an applied template bumps this counter: re-read the
// server status instead of deriving anything in the browser.
watch(
  () => funding.confirmedCount.value,
  () => void loadV2Status(),
);

function setCollapsed(value: boolean): void {
  collapsed.value = value;
  window.localStorage.setItem(STORAGE_KEY, String(value));
}

const doneCount = computed(() => steps.value.filter((step) => step.done).length);
const allDone = computed(() => steps.value.length > 0 && doneCount.value === steps.value.length);

const templateSaving = ref(false);
const templateFailed = ref(false);

async function runInitializeTemplate(): Promise<void> {
  if (isModelV2.value) {
    templateSheetOpen.value = true;
    return;
  }
  templateSaving.value = true;
  templateFailed.value = false;
  try {
    await props.initializeTemplate(props.budgetId);
    emit('templateInitialized');
  } catch {
    templateFailed.value = true;
  } finally {
    templateSaving.value = false;
  }
}

function onTemplateApplied(): void {
  emit('templateInitialized');
}

function offerOpeningAssignment(): void {
  funding.offer({ sourceKind: 'OPENING' });
}
</script>

<template>
  <section
    v-if="ready && !allDone"
    class="onboarding-checklist"
    data-testid="onboarding-checklist"
    :aria-labelledby="collapsed ? undefined : 'onboarding-checklist-title'"
  >
    <button
      v-if="collapsed"
      type="button"
      class="onboarding-checklist__pill"
      data-testid="onboarding-pill"
      aria-expanded="false"
      @click="setCollapsed(false)"
    >
      Начало работы: {{ doneCount }}/{{ steps.length }}
      <ChevronDown :size="16" aria-hidden="true" />
    </button>

    <template v-else>
      <div class="onboarding-checklist__header">
        <h2 id="onboarding-checklist-title" class="onboarding-checklist__title">
          Начало работы: {{ doneCount }}/{{ steps.length }}
        </h2>
        <UiButton
          variant="tertiary"
          size="sm"
          data-action="onboarding-collapse"
          aria-label="Свернуть"
          aria-expanded="true"
          tooltip="Свернуть"
          tooltip-placement="bottom"
          @click="setCollapsed(true)"
        >
          <ChevronUp :size="18" aria-hidden="true" />
        </UiButton>
      </div>

      <ul class="onboarding-checklist__list">
        <li
          v-for="step in steps"
          :key="step.key"
          class="onboarding-checklist__row"
          data-testid="onboarding-step"
        >
          <span
            class="onboarding-checklist__icon"
            :class="{ 'onboarding-checklist__icon--done': step.done }"
          >
            <CircleCheck
              v-if="step.done"
              data-testid="onboarding-step-done"
              :size="20"
              aria-hidden="true"
            />
            <Circle v-else :size="20" aria-hidden="true" />
          </span>

          <span class="onboarding-checklist__body">
            <span class="onboarding-checklist__row-head">
              <span class="onboarding-checklist__row-title">{{ step.title }}</span>
              <UiStatus
                :label="step.done ? 'Готово' : 'Не начато'"
                :tone="step.done ? 'success' : 'neutral'"
              />
            </span>
            <span class="onboarding-checklist__description">{{ step.description }}</span>
          </span>

          <UiButton
            v-if="step.action === 'template'"
            variant="tertiary"
            size="sm"
            data-action="onboarding-initialize-template"
            :loading="templateSaving"
            @click="runInitializeTemplate"
          >
            {{ isModelV2 ? 'Настроить базовый шаблон' : 'Создать базовый шаблон' }}
          </UiButton>
          <UiButton
            v-else-if="step.action === 'assign'"
            variant="tertiary"
            size="sm"
            data-action="onboarding-assign-money"
            @click="offerOpeningAssignment"
          >
            Назначить деньги
          </UiButton>
          <UiButton v-else variant="tertiary" size="sm" :to="step.href">
            {{ step.linkLabel }}
          </UiButton>
        </li>
      </ul>

      <UiStatus
        v-if="templateFailed"
        label="Не удалось выполнить действие. Повторите попытку."
        tone="danger"
        aria-live="polite"
      />
      <TemplatePreviewSheet
        v-if="isModelV2"
        :open="templateSheetOpen"
        :budget-id="budgetId"
        @close="templateSheetOpen = false"
        @applied="onTemplateApplied"
      />
    </template>
  </section>
</template>

<style scoped>
.onboarding-checklist {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

.onboarding-checklist__pill {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  min-height: var(--hf-control-height-sm);
  padding: var(--hf-space-2) var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-full, 999px);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
  cursor: pointer;
}

.onboarding-checklist__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-3);
}

.onboarding-checklist__title {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}

.onboarding-checklist__list {
  display: grid;
  gap: var(--hf-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.onboarding-checklist__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
  align-items: center;
}

.onboarding-checklist__icon {
  flex-shrink: 0;
  color: var(--hf-color-text-muted);
}

.onboarding-checklist__icon--done {
  color: var(--hf-color-status-success);
}

.onboarding-checklist__body {
  display: grid;
  flex: 1 1 14rem;
  gap: 0.125rem;
  min-width: 0;
}

.onboarding-checklist__row-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: center;
}

.onboarding-checklist__row-title {
  font-weight: var(--hf-font-weight-medium);
}

.onboarding-checklist__description {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}
</style>
