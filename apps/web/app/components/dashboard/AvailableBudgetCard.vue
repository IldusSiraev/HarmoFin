<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronDown, ChevronUp, CircleAlert, TriangleAlert } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import { formatMinorUnits } from '../finance/money-format.js';
import type { DashboardSummaryDto } from '../../composables/useBudgetReferenceData.js';
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';
import UiProgress from '../ui/Progress.vue';

defineOptions({ name: 'AvailableBudgetCard' });

// Plan model 2 passes only `dashboard`: every amount is shown as the server sent
// it. Plan model 1 keeps `periodLimit` + `period` until cutover.
const props = defineProps<{
  periodLimit?: DashboardSummaryDto['periodLimit'];
  period?: DashboardSummaryDto['period'];
  dashboard?: DashboardV2Response;
}>();

type CardState = 'normal' | 'warning' | 'critical' | 'negative' | 'unavailable';

const details = computed(() =>
  props.periodLimit?.state === 'available' ? props.periodLimit : null,
);

const state = computed<CardState>(() => {
  const limit = details.value;
  if (!limit) return 'unavailable';

  const remaining = Number(BigInt(limit.remainingMinor));
  const daily = Number(BigInt(limit.averageRemainingDailyLimitMinor));
  const total = Number(BigInt(limit.limitMinor));
  const spent = Number(BigInt(limit.spentMinor));

  if (remaining < 0) return 'negative';
  if (remaining <= daily) return 'critical';
  if (total > 0 && spent / total >= 0.8) return 'warning';
  return 'normal';
});

const stateLabel = computed(() => {
  if (state.value === 'negative') return 'Лимит периода превышен';
  if (state.value === 'critical') return 'Остатка хватит меньше чем на день';
  if (state.value === 'warning') return 'Лимит периода почти исчерпан';
  return 'В пределах лимита';
});

const monthFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

function formatUntil(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return `до ${monthFormatter.format(new Date(year, month - 1, day))}`;
}

const untilLabel = computed(() => (props.period ? formatUntil(props.period.end) : ''));

// v2: only string/flag checks on server values, never arithmetic.
const needsSetup = computed(() => props.dashboard?.spendable.state === 'NEEDS_PERIOD_SETUP');
const overrun = computed(() => props.dashboard?.currentBalanceMinor.startsWith('-') ?? false);
const overrunMinor = computed(() => props.dashboard?.currentBalanceMinor.replace('-', '') ?? '0');
const hasGap = computed(() => {
  const gap = props.dashboard?.mandatoryGapMinor ?? '0';
  return gap !== '0' && !gap.startsWith('-');
});
const horizonLabel = computed(() =>
  props.dashboard ? formatUntil(props.dashboard.horizonEnd) : '',
);
const breakdownOpen = ref(false);

const daysLabel = computed(() => {
  const days = details.value?.daysUntilBoundary ?? 0;
  const tail = days % 10;
  const teen = days % 100;
  if (tail === 1 && teen !== 11) return `осталось ${days} день`;
  if (tail >= 2 && tail <= 4 && (teen < 12 || teen > 14)) return `осталось ${days} дня`;
  return `осталось ${days} дней`;
});

const progressLabel = computed(() => {
  const limit = details.value;
  if (!limit) return '';
  const spent = formatMinorUnits(limit.spentMinor, 'RUB', 2);
  const total = formatMinorUnits(limit.limitMinor, 'RUB', 2);
  return `Потрачено ${spent} из лимита ${total}`;
});
</script>

<template>
  <section
    class="available-budget"
    :class="`available-budget--${state}`"
    aria-labelledby="available-budget-title"
  >
    <h2 id="available-budget-title" class="available-budget__label">Можно потратить</h2>

    <template v-if="dashboard">
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
      </template>

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

      <p class="available-budget__caption">
        Обязательства {{ horizonLabel }} ·
        <NuxtLink to="/app/plans" class="available-budget__link"
          >Предстоящие обязательства</NuxtLink
        >
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
              <FinanceMoney
                :minor-units="dashboard.currentBalanceMinor"
                currency="RUB"
                :scale="2"
              />
            </dd>
          </div>
          <div>
            <dt>К оплате по обязательствам</dt>
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
              <FinanceMoney
                :minor-units="dashboard.otherProtectedMinor"
                currency="RUB"
                :scale="2"
              />
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
    </template>

    <template v-else-if="details">
      <p class="available-budget__amount">
        <FinanceMoney :minor-units="details.remainingMinor" currency="RUB" :scale="2" />
      </p>

      <p class="available-budget__caption">{{ untilLabel }} · {{ daysLabel }}</p>

      <UiProgress :value="details.spentMinor" :max="details.limitMinor" :label="progressLabel" />

      <p class="available-budget__state">{{ stateLabel }}</p>

      <div class="available-budget__footer">
        <div class="available-budget__stat">
          <span class="available-budget__stat-label">Потрачено</span>
          <FinanceMoney :minor-units="details.spentMinor" currency="RUB" :scale="2" />
        </div>
        <div class="available-budget__stat">
          <span class="available-budget__stat-label">Было доступно</span>
          <FinanceMoney :minor-units="details.limitMinor" currency="RUB" :scale="2" />
        </div>
        <div class="available-budget__stat available-budget__stat--end">
          <span class="available-budget__stat-label">В среднем в день</span>
          <span
            >≈
            <FinanceMoney
              :minor-units="details.averageRemainingDailyLimitMinor"
              currency="RUB"
              :scale="2"
          /></span>
        </div>
      </div>
    </template>

    <p v-else class="available-budget__empty">
      Конверт текущего периода не настроен. Создайте его в разделе «Конверты», чтобы видеть
      доступный остаток.
    </p>
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

.available-budget--negative .available-budget__amount {
  color: var(--hf-color-status-danger);
}

.available-budget__caption {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}

.available-budget__state {
  margin: 0;
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
  line-height: var(--hf-line-height-small);
}

.available-budget--warning .available-budget__state,
.available-budget--critical .available-budget__state {
  color: var(--hf-color-status-warning);
}

.available-budget--negative .available-budget__state {
  color: var(--hf-color-status-danger);
}

.available-budget__footer {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  gap: var(--hf-space-4);
  padding-top: var(--hf-space-3);
  border-top: 1px solid var(--hf-color-border);
}

.available-budget__stat {
  display: grid;
  gap: var(--hf-space-1);
  font-weight: var(--hf-font-weight-medium);
}

.available-budget__stat--end {
  text-align: right;
}

.available-budget__stat-label {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-regular);
}

.available-budget__invite {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  font-weight: var(--hf-font-weight-semibold);
  line-height: var(--hf-line-height-h3);
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

.available-budget__empty {
  margin: 0;
  color: var(--hf-color-text-muted);
}
</style>
