<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { AlertTriangle, CircleCheck, Circle, ChevronDown, ChevronUp } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import TemplatePreviewSheet from '../funding/TemplatePreviewSheet.vue';
import UiButton from '../ui/Button.vue';
import UiStatus from '../ui/Status.vue';
import {
  useEnvelopePlanV2,
  type DashboardV2Response,
} from '../../composables/useEnvelopePlanV2.js';
import { useFundingEntry } from '../../composables/useFundingEntry.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';

defineOptions({ name: 'OnboardingChecklist' });

const STORAGE_KEY = 'harmofin-onboarding-collapsed';

type V2Onboarding = DashboardV2Response['onboarding'];

const props = defineProps<{
  budgetId: string;
}>();

// `targetDecided`: the period plan was confirmed or rejected here, the page
// rereads its dashboard. `hostsTarget`: this checklist currently shows the
// plan decision, so the period card must not repeat it.
const emit = defineEmits<{
  templateInitialized: [];
  targetDecided: [];
  hostsTarget: [hosts: boolean];
}>();

type StepAction = 'template' | 'assign' | 'target' | 'mandatory' | 'link';

type Step = {
  key: string;
  title: string;
  description: string;
  href: string;
  linkLabel: string;
  action: StepAction;
  done: boolean;
};

const funding = useFundingEntry();

// Progress comes from the server's dashboard onboarding block.
const v2Status = ref<V2Onboarding | null>(null);
// The draft period plan proposed by the template; the server owns the amount.
const proposal = ref<{ amountMinor: string; periodId: string } | null>(null);
const v2 = useEnvelopePlanV2();

async function loadV2Status(): Promise<void> {
  try {
    const dashboard = await v2.getDashboard(props.budgetId);
    v2Status.value = dashboard.onboarding;
    const periodId = dashboard.period?.periodId ?? null;
    proposal.value =
      dashboard.suggestedTarget != null && periodId !== null
        ? { amountMinor: dashboard.suggestedTarget, periodId }
        : null;
  } catch {
    // Keep the last known status; the dashboard itself reports load errors.
  }
}

const CYCLE_NOTE = 'Цикл уже задан в шаблоне; изменить его можно в Настройках.';

function periodStep(status: V2Onboarding): Step {
  const done = !status.needsPeriodSetup;
  if (proposal.value && !done) {
    return {
      key: 'periodSetup',
      title: 'Подтвердите лимит на период',
      description: `Шаблон предложил сумму на обычные траты периода. Пока вы её не подтвердите, «Можно потратить» не считается. «Отклонить» — задать лимит самостоятельно. ${CYCLE_NOTE}`,
      href: '/app/envelopes',
      linkLabel: 'Перейти',
      action: 'target',
      done,
    };
  }
  if (done) {
    return {
      key: 'periodSetup',
      title: 'Лимит на текущий период',
      description:
        status.needsOpeningAssignment || !status.hasAccounts
          ? 'Лимит на период подтверждён. Деньги появятся в нём, когда вы распределите их по конвертам: это шаг «Распределить деньги по конвертам».'
          : 'Лимит на период подтверждён.',
      href: '/app/envelopes',
      linkLabel: 'Открыть конверты',
      action: 'link',
      done,
    };
  }
  return {
    key: 'periodSetup',
    title: 'Лимит на текущий период',
    description: `Укажите, сколько планируете тратить на обычные траты в этом периоде. ${CYCLE_NOTE}`,
    href: '/app/envelopes',
    linkLabel: 'Задать лимит',
    action: 'link',
    done,
  };
}

const MONEY_STEP_WARNING =
  'Сначала добавьте обязательные платежи — иначе на них ничего не будет отложено.';

function mandatoryStep(status: V2Onboarding): Step {
  const done = status.hasMandatoryPlans || status.mandatoryPlansDeclined;
  return {
    key: 'hasMandatoryPlans',
    title: 'Обязательные платежи',
    description:
      status.mandatoryPlansDeclined && !status.hasMandatoryPlans
        ? 'Обязательных платежей нет. Если появятся, добавьте их в «Планах».'
        : 'Добавьте регулярные обязательные платежи: аренду, коммунальные услуги, кредиты. Из них складывается сумма, которую нужно отложить в «Обязательные».',
    href: '/app/plans',
    linkLabel: 'Перейти',
    action: done ? 'link' : 'mandatory',
    done,
  };
}

const steps = computed<Step[]>(() => {
  const status = v2Status.value;
  if (!status) return [];
  const mandatory = mandatoryStep(status);
  const assignDone = status.hasAccounts && !status.needsOpeningAssignment;
  const assignBase =
    'Распределите деньги со счетов по конвертам или оставьте свободными: это можно сделать позже.';
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
      key: 'hasAccounts',
      title: 'Счета',
      description: 'Добавьте счета, на которых реально лежат деньги, с их текущим остатком.',
      href: '/app/accounts',
      linkLabel: 'Перейти',
      action: 'link',
      done: status.hasAccounts,
    },
    mandatory,
    periodStep(status),
    {
      key: 'openingAssignment',
      title: 'Распределить деньги по конвертам',
      description:
        !assignDone && !mandatory.done ? `${assignBase} ${MONEY_STEP_WARNING}` : assignBase,
      href: '/app/accounts',
      linkLabel: 'Перейти',
      action: 'assign',
      done: assignDone,
    },
  ];
});

const ready = computed(() => v2Status.value !== null);

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

function openTemplateSheet(): void {
  templateSheetOpen.value = true;
}

function onTemplateApplied(): void {
  emit('templateInitialized');
}

function offerOpeningAssignment(): void {
  funding.offer({ sourceKind: 'OPENING' });
}

const hostsTarget = computed(
  () =>
    ready.value &&
    !allDone.value &&
    !collapsed.value &&
    proposal.value !== null &&
    steps.value.some((step) => step.action === 'target' && !step.done),
);
watch(hostsTarget, (value) => emit('hostsTarget', value), { immediate: true });
onBeforeUnmount(() => emit('hostsTarget', false));

// One Idempotency-Key per attempt: a retry of the same decision reuses it.
let attempt: { fingerprint: string; key: string } | null = null;
const targetPending = ref(false);
const targetError = ref('');
// Polite announcement for screen readers: the focused button disappears.
const decisionNotice = ref('');

async function decideTarget(kind: 'confirm' | 'reject'): Promise<void> {
  const current = proposal.value;
  if (targetPending.value || current === null) return;
  targetPending.value = true;
  targetError.value = '';
  try {
    const fingerprint = `${kind}:${current.periodId}`;
    if (attempt?.fingerprint !== fingerprint) attempt = { fingerprint, key: crypto.randomUUID() };
    if (kind === 'confirm') {
      await v2.confirmPeriodTarget(props.budgetId, current.periodId, attempt.key);
    } else {
      await v2.rejectPeriodTarget(props.budgetId, current.periodId, attempt.key);
    }
    attempt = null;
    // The decision is done: never offer it again, even if the reread fails.
    proposal.value = null;
    decisionNotice.value =
      kind === 'confirm' ? 'Лимит на период подтверждён.' : 'Лимит на период отклонён.';
    await loadV2Status();
    emit('targetDecided');
  } catch (error) {
    targetError.value = v2ErrorMessage(error, 'Не удалось выполнить действие. Попробуйте ещё раз.');
  } finally {
    targetPending.value = false;
  }
}

// One Idempotency-Key per decline attempt: a retry after a failure reuses it.
let declineKey: string | null = null;
const declinePending = ref(false);
const declineError = ref('');

async function declineMandatoryPlans(): Promise<void> {
  if (declinePending.value) return;
  declinePending.value = true;
  declineError.value = '';
  try {
    declineKey ??= crypto.randomUUID();
    await v2.declineMandatoryPlans(props.budgetId, declineKey);
    declineKey = null;
    decisionNotice.value = 'Шаг «Обязательные платежи» пропущен.';
    await loadV2Status();
  } catch (error) {
    declineError.value = v2ErrorMessage(error, 'Не удалось сохранить. Попробуйте ещё раз.');
  } finally {
    declinePending.value = false;
  }
}
</script>

<template>
  <section
    v-if="ready && !allDone"
    class="onboarding-checklist"
    data-testid="onboarding-checklist"
    :aria-labelledby="collapsed ? undefined : 'onboarding-checklist-title'"
  >
    <p class="onboarding-checklist__sr" role="status" data-testid="onboarding-notice">
      {{ decisionNotice }}
    </p>
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
          :data-step="step.key"
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
            <template v-if="step.action === 'target' && proposal">
              <FinanceMoney
                class="onboarding-checklist__amount"
                data-testid="onboarding-target-amount"
                :minor-units="proposal.amountMinor"
                currency="RUB"
                :scale="2"
              />
              <span
                v-if="targetError"
                class="onboarding-checklist__error"
                role="alert"
                data-testid="onboarding-target-error"
              >
                <AlertTriangle :size="14" aria-hidden="true" />
                {{ targetError }}
              </span>
            </template>
            <span
              v-if="step.action === 'mandatory' && declineError"
              class="onboarding-checklist__error"
              role="alert"
              data-testid="onboarding-mandatory-error"
            >
              <AlertTriangle :size="14" aria-hidden="true" />
              {{ declineError }}
            </span>
          </span>

          <div v-if="step.action === 'target'" class="onboarding-checklist__actions">
            <UiButton
              variant="primary"
              size="sm"
              :loading="targetPending"
              data-testid="onboarding-target-confirm"
              @click="decideTarget('confirm')"
            >
              Подтвердить план
            </UiButton>
            <UiButton
              variant="secondary"
              size="sm"
              :disabled="targetPending"
              data-testid="onboarding-target-reject"
              @click="decideTarget('reject')"
            >
              Отклонить
            </UiButton>
          </div>

          <div v-else-if="step.action === 'mandatory'" class="onboarding-checklist__actions">
            <UiButton
              variant="tertiary"
              size="sm"
              :to="step.href"
              data-testid="onboarding-mandatory-add"
            >
              Добавить платёж
            </UiButton>
            <UiButton
              variant="secondary"
              size="sm"
              :loading="declinePending"
              data-testid="onboarding-mandatory-decline"
              @click="declineMandatoryPlans"
            >
              У меня их нет
            </UiButton>
          </div>

          <UiButton
            v-else-if="step.action === 'template'"
            variant="tertiary"
            size="sm"
            data-action="onboarding-initialize-template"
            @click="openTemplateSheet"
          >
            Настроить базовый шаблон
          </UiButton>
          <UiButton
            v-else-if="step.action === 'assign'"
            variant="tertiary"
            size="sm"
            data-action="onboarding-assign-money"
            @click="offerOpeningAssignment"
          >
            Распределить деньги
          </UiButton>
          <UiButton v-else variant="tertiary" size="sm" :to="step.href">
            {{ step.linkLabel }}
          </UiButton>
        </li>
      </ul>

      <TemplatePreviewSheet
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

.onboarding-checklist__amount {
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.onboarding-checklist__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}

.onboarding-checklist__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.onboarding-checklist__error {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.onboarding-checklist__description {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}
</style>
