<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CircleCheck, Circle, ChevronDown, ChevronUp } from '@lucide/vue';

import UiButton from '../ui/Button.vue';
import UiStatus from '../ui/Status.vue';
import type {
  DashboardSummaryDto,
  ReferenceTemplateResult,
} from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'OnboardingChecklist' });

const STORAGE_KEY = 'harmofin-onboarding-collapsed';

type OnboardingStatus = DashboardSummaryDto['onboarding'];

const props = defineProps<{
  budgetId: string;
  onboarding: OnboardingStatus;
  initializeTemplate: (budgetId: string) => Promise<ReferenceTemplateResult>;
}>();

const emit = defineEmits<{
  templateInitialized: [];
}>();

type StepKey = keyof OnboardingStatus;

type Step = {
  key: StepKey;
  title: string;
  description: string;
  href: string;
  linkLabel: string;
};

const steps: Step[] = [
  {
    key: 'categoriesSeeded',
    title: 'Базовые категории и конверты',
    description:
      'Создайте набор стандартных категорий и конвертов одним нажатием — их можно будет изменить позже.',
    href: '/app/settings',
    linkLabel: 'Перейти',
  },
  {
    key: 'cycleConfigured',
    title: 'Финансовый цикл',
    description:
      'Финансовый месяц не обязан начинаться 1-го числа — настройте день, который соответствует вашему графику доходов.',
    href: '/app/settings',
    linkLabel: 'Перейти',
  },
  {
    key: 'hasAccounts',
    title: 'Счета',
    description: 'Добавьте счета, на которых реально лежат деньги, с их текущим остатком.',
    href: '/app/accounts',
    linkLabel: 'Перейти',
  },
  {
    key: 'hasEnvelopeStartingBalances',
    title: 'Начальные остатки конвертов',
    description:
      'Разнесите деньги со счетов по конвертам — так будет видно, что уже распределено, а что нет.',
    href: '/app/envelopes',
    linkLabel: 'Перейти',
  },
  {
    key: 'hasAllocatedIncome',
    title: 'Первый доход и распределение',
    description:
      'Добавьте операцию дохода и распределите её по конвертам — это включит расчёт доступного лимита периода.',
    href: '/app/operations',
    linkLabel: 'Перейти',
  },
];

const collapsed = ref(false);

onMounted(() => {
  collapsed.value = window.localStorage.getItem(STORAGE_KEY) === 'true';
});

function setCollapsed(value: boolean): void {
  collapsed.value = value;
  window.localStorage.setItem(STORAGE_KEY, String(value));
}

const doneCount = computed(() => steps.filter((step) => props.onboarding[step.key]).length);
const allDone = computed(() => doneCount.value === steps.length);

const templateSaving = ref(false);
const templateFailed = ref(false);

async function runInitializeTemplate(): Promise<void> {
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
</script>

<template>
  <section
    v-if="!allDone"
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
            :class="{ 'onboarding-checklist__icon--done': onboarding[step.key] }"
          >
            <CircleCheck
              v-if="onboarding[step.key]"
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
                :label="onboarding[step.key] ? 'Готово' : 'Не начато'"
                :tone="onboarding[step.key] ? 'success' : 'neutral'"
              />
            </span>
            <span class="onboarding-checklist__description">{{ step.description }}</span>
          </span>

          <UiButton
            v-if="step.key === 'categoriesSeeded'"
            variant="tertiary"
            size="sm"
            data-action="onboarding-initialize-template"
            :loading="templateSaving"
            @click="runInitializeTemplate"
          >
            Создать базовый шаблон
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
