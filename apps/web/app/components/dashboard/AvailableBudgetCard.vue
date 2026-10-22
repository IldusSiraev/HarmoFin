<script setup lang="ts">
import { computed } from 'vue';
import { TriangleAlert } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import FinancialMonthTimeline from './FinancialMonthTimeline.vue';
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';

defineOptions({ name: 'AvailableBudgetCard' });

// Every amount is shown as the server sent it.
const props = withDefaults(
  defineProps<{
    dashboard: DashboardV2Response;
    // Demo/landing narration still describes unassigned money; the dashboard page covers it in
    // DashboardWarnings, so this read-only line stays off by default there.
    showFreeMoney?: boolean;
  }>(),
  { showFreeMoney: false },
);

const monthFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

function formatUntil(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return `до ${monthFormatter.format(new Date(year, month - 1, day))}`;
}

// Only string/flag checks on server values, never arithmetic.
const needsSetup = computed(() => props.dashboard.spendable.state === 'NEEDS_PERIOD_SETUP');
const overrun = computed(() => props.dashboard.currentBalanceMinor.startsWith('-'));
const overrunMinor = computed(() => props.dashboard.currentBalanceMinor.replace('-', ''));
// A confirmed but unfunded period reads as a bare zero: say why and what next.
const emptyPeriod = computed(
  () => !needsSetup.value && props.dashboard.currentBalanceMinor === '0',
);
const stats = computed(() => props.dashboard.periodStats);
// Same string check as DashboardWarnings: not '0' and not negative.
const freeMinor = computed(() => props.dashboard.freeToAssignMinor);
const hasFreeMoney = computed(() => freeMinor.value !== '0' && !freeMinor.value.startsWith('-'));
const deadlineLabel = computed(() => formatUntil(props.dashboard.period.end).replace(/^до/, 'До'));
</script>

<template>
  <section class="available-budget" aria-labelledby="available-budget-title">
    <h2 id="available-budget-title" class="available-budget__label">Можно потратить</h2>

    <template v-if="needsSetup">
      <p class="available-budget__invite">Настройте лимит на период</p>
      <p class="available-budget__caption">
        Пока лимит не задан, сумму «Можно потратить» не показываем: это не ноль, а отсутствие
        лимита.
      </p>
      <NuxtLink to="/app/envelopes" class="available-budget__link">Настроить лимит</NuxtLink>
    </template>
    <template v-else>
      <p class="available-budget__amount">
        <FinanceMoney
          :minor-units="dashboard.spendable.amountMinor ?? '0'"
          currency="RUB"
          :scale="2"
        />
      </p>
      <p class="available-budget__caption">{{ deadlineLabel }} · доступно в текущем конверте</p>
      <FinancialMonthTimeline
        class="available-budget__timeline"
        embedded
        :cycle="dashboard.cycle"
        :period="dashboard.period"
        :as-of="dashboard.asOf"
      />
      <dl v-if="stats" class="available-budget__stats" data-testid="available-budget-stats">
        <div>
          <dt>Потрачено</dt>
          <dd><FinanceMoney :minor-units="stats.spentMinor" currency="RUB" :scale="2" /></dd>
        </div>
        <div>
          <dt>Было доступно</dt>
          <dd><FinanceMoney :minor-units="stats.availableMinor" currency="RUB" :scale="2" /></dd>
        </div>
        <div>
          <dt>В среднем в день</dt>
          <dd>
            <FinanceMoney :minor-units="stats.averagePerDayMinor" currency="RUB" :scale="2" />
          </dd>
        </div>
      </dl>
    </template>

    <p
      v-if="emptyPeriod"
      class="available-budget__caption"
      data-testid="available-budget-empty-hint"
    >
      Деньги в конверте периода закончились или ещё не распределены, поэтому «Можно потратить» равно
      нулю.
      {{
        dashboard.onboarding.hasAccounts
          ? 'Распределите деньги в конверт периода.'
          : 'Добавьте счёт и распределите деньги в конверт периода.'
      }}
      <NuxtLink to="/app/accounts" class="available-budget__link">Перейти к счетам</NuxtLink>
    </p>

    <p v-if="overrun" class="available-budget__flag available-budget__flag--danger">
      <TriangleAlert :size="16" aria-hidden="true" />
      <span>
        Превышение периода
        <FinanceMoney :minor-units="overrunMinor" currency="RUB" :scale="2" />
      </span>
    </p>

    <p v-if="dashboard.dueMayBeIncomplete" class="available-budget__caption">
      Сумма может быть неполной: более поздние платежи пока не учтены.
    </p>

    <p
      v-if="showFreeMoney && hasFreeMoney"
      class="available-budget__free"
      data-testid="available-budget-free-row"
    >
      Не распределено <FinanceMoney :minor-units="freeMinor" currency="RUB" :scale="2" />
    </p>
  </section>
</template>

<style scoped>
.available-budget {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
}

.available-budget__timeline {
  margin-block: var(--hf-space-2);
}

.available-budget__label {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
  line-height: var(--hf-line-height-small);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.available-budget__amount {
  margin: 0;
  font-size: var(--hf-font-size-display);
  font-weight: var(--hf-font-weight-bold);
  line-height: var(--hf-line-height-display);
  font-variant-numeric: tabular-nums;
}

.available-budget__caption {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}

.available-budget__invite {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  font-weight: var(--hf-font-weight-semibold);
  line-height: var(--hf-line-height-h3);
}

.available-budget__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: var(--hf-space-3);
  margin: 0;
  padding-top: var(--hf-space-3);
  border-top: 1px solid var(--hf-color-border);
  font-variant-numeric: tabular-nums;
}

.available-budget__stats dt {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.available-budget__stats dd {
  margin: 0;
  font-weight: var(--hf-font-weight-semibold);
}

.available-budget__link {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  color: var(--hf-color-action-primary);
  font-weight: var(--hf-font-weight-medium);
}

.available-budget__flag {
  display: flex;
  gap: var(--hf-space-2);
  align-items: center;
  margin: 0;
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
}

.available-budget__flag--danger {
  color: var(--hf-color-status-danger);
}

.available-budget__free {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
  font-variant-numeric: tabular-nums;
}
</style>
