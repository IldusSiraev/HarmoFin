<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronDown, ChevronUp, CircleAlert, TriangleAlert } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import UiButton from '../ui/Button.vue';
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';

defineOptions({ name: 'AvailableBudgetCard' });

// Every amount is shown as the server sent it.
const props = defineProps<{
  dashboard: DashboardV2Response;
}>();

// `assign`: the user wants to assign the free money; the page opens the panel.
const emit = defineEmits<{ assign: [] }>();

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
const hasFreeMoney = computed(() => {
  const free = props.dashboard.freeToAssignMinor;
  return free !== '0' && !free.startsWith('-');
});
const hasGap = computed(() => {
  const gap = props.dashboard.mandatoryGapMinor;
  return gap !== '0' && !gap.startsWith('-');
});
const horizonLabel = computed(() => formatUntil(props.dashboard.horizonEnd));
const stats = computed(() => props.dashboard.periodStats);

// Counts come from the server; this only picks the Russian word form.
function daysLeftLabel(days: number): string {
  const tail = days % 10;
  const teen = days % 100;
  if (tail === 1 && teen !== 11) return `осталось ${days} день`;
  if (tail >= 2 && tail <= 4 && (teen < 12 || teen > 14)) return `осталось ${days} дня`;
  return `осталось ${days} дней`;
}
const periodCaption = computed(() =>
  stats.value
    ? `${formatUntil(props.dashboard.period.end)} · ${daysLeftLabel(stats.value.daysLeft)}`
    : '',
);
const breakdownOpen = ref(false);
</script>

<template>
  <section class="available-budget" aria-labelledby="available-budget-title">
    <h2 id="available-budget-title" class="available-budget__label">Можно потратить</h2>

    <template v-if="needsSetup">
      <p class="available-budget__invite">Настройте лимит периода</p>
      <p class="available-budget__caption">
        Пока лимит не задан, безопасный остаток не показываем: это не ноль, а отсутствие плана.
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
      <p class="available-budget__caption">
        В конверте периода
        <FinanceMoney :minor-units="dashboard.currentBalanceMinor" currency="RUB" :scale="2" />
      </p>
      <p v-if="stats" class="available-budget__caption" data-testid="available-budget-period">
        {{ periodCaption }}
      </p>
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
      Деньги в конверте периода закончились или ещё не назначены, поэтому «Можно потратить» равно
      нулю.
      {{
        dashboard.onboarding.hasAccounts
          ? 'Назначьте деньги конверту периода.'
          : 'Добавьте счёт и назначьте деньги конверту периода.'
      }}
      <NuxtLink to="/app/accounts" class="available-budget__link">Перейти к счетам</NuxtLink>
    </p>

    <p v-if="hasFreeMoney" class="available-budget__free" data-testid="available-budget-free-row">
      <span>
        Свободно для назначения
        <FinanceMoney :minor-units="dashboard.freeToAssignMinor" currency="RUB" :scale="2" />
      </span>
      <UiButton
        variant="tertiary"
        size="sm"
        data-action="assign-free-money"
        @click="emit('assign')"
      >
        Назначить
      </UiButton>
    </p>

    <p v-if="overrun" class="available-budget__flag available-budget__flag--danger">
      <TriangleAlert :size="16" aria-hidden="true" />
      <span>
        Превышение периода
        <FinanceMoney :minor-units="overrunMinor" currency="RUB" :scale="2" />
      </span>
    </p>
    <p v-if="hasGap" class="available-budget__flag available-budget__flag--warning">
      <CircleAlert :size="16" aria-hidden="true" />
      <span>
        Не хватает на обязательные
        <FinanceMoney :minor-units="dashboard.mandatoryGapMinor" currency="RUB" :scale="2" />
      </span>
    </p>

    <p v-if="dashboard.dueMayBeIncomplete" class="available-budget__caption">
      К оплате может быть неполным: часть обязательств за горизонтом ещё не видна.
    </p>

    <button
      type="button"
      class="available-budget__toggle"
      data-action="toggle-breakdown"
      :aria-expanded="breakdownOpen"
      :aria-controls="breakdownOpen ? 'available-budget-breakdown' : undefined"
      @click="breakdownOpen = !breakdownOpen"
    >
      <component :is="breakdownOpen ? ChevronUp : ChevronDown" :size="16" aria-hidden="true" />
      Как посчитано
    </button>
    <div v-if="breakdownOpen" id="available-budget-breakdown" class="available-budget__breakdown">
      <dl class="available-budget__list">
        <div>
          <dt>На счетах</dt>
          <dd><FinanceMoney :minor-units="dashboard.cashMinor" currency="RUB" :scale="2" /></dd>
        </div>
        <div>
          <dt>Остаток текущего периода</dt>
          <dd>
            <FinanceMoney :minor-units="dashboard.currentBalanceMinor" currency="RUB" :scale="2" />
          </dd>
        </div>
        <div>
          <dt>К оплате по обязательствам {{ horizonLabel }}</dt>
          <dd>
            <FinanceMoney :minor-units="dashboard.mandatoryDueMinor" currency="RUB" :scale="2" />
          </dd>
        </div>
      </dl>
      <h3 class="available-budget__group">Защищено обязательствами и накоплениями</h3>
      <dl class="available-budget__list">
        <div>
          <dt>Назначено на обязательства</dt>
          <dd>
            <FinanceMoney
              :minor-units="dashboard.mandatoryBalanceMinor"
              currency="RUB"
              :scale="2"
            />
          </dd>
        </div>
        <div>
          <dt>Накопления и прочее</dt>
          <dd>
            <FinanceMoney :minor-units="dashboard.otherProtectedMinor" currency="RUB" :scale="2" />
          </dd>
        </div>
        <div>
          <dt>Свободно для назначения</dt>
          <dd>
            <FinanceMoney :minor-units="dashboard.freeToAssignMinor" currency="RUB" :scale="2" />
          </dd>
        </div>
      </dl>
    </div>
  </section>
</template>

<style scoped>
.available-budget {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

.available-budget__free {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: center;
  justify-content: space-between;
  margin: 0;
  font-variant-numeric: tabular-nums;
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

.available-budget__flag--warning {
  color: var(--hf-color-status-warning);
}

.available-budget__toggle {
  display: inline-flex;
  gap: var(--hf-space-1);
  align-items: center;
  justify-self: start;
  min-height: 2.75rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--hf-color-action-primary);
  font: inherit;
  font-weight: var(--hf-font-weight-medium);
  cursor: pointer;
}

.available-budget__breakdown {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding-top: var(--hf-space-3);
  border-top: 1px solid var(--hf-color-border);
}

.available-budget__list {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
}

.available-budget__list > div {
  display: flex;
  gap: var(--hf-space-3);
  justify-content: space-between;
}

.available-budget__breakdown dt {
  color: var(--hf-color-text-muted);
}

.available-budget__breakdown dd {
  margin: 0;
  font-weight: var(--hf-font-weight-medium);
}

.available-budget__group {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
}
</style>
