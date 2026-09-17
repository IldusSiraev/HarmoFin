<script setup lang="ts">
import { computed } from 'vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import { formatMinorUnits } from '../finance/money-format.js';
import type { DashboardSummaryDto } from '../../composables/useBudgetReferenceData.js';
import UiProgress from '../ui/Progress.vue';

defineOptions({ name: 'AvailableBudgetCard' });

const props = defineProps<{
  periodLimit: DashboardSummaryDto['periodLimit'];
  period: DashboardSummaryDto['period'];
}>();

type CardState = 'normal' | 'warning' | 'critical' | 'negative' | 'unavailable';

const details = computed(() =>
  props.periodLimit.state === 'available' ? props.periodLimit : null,
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

function formatDay(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${day}.${month}`;
}

const periodLabel = computed(
  () => `${formatDay(props.period.start)} – ${formatDay(props.period.end)}`,
);

const daysLabel = computed(() => {
  const days = details.value?.daysUntilBoundary ?? 0;
  const tail = days % 10;
  const teen = days % 100;
  if (tail === 1 && teen !== 11) return `Осталось ${days} день`;
  if (tail >= 2 && tail <= 4 && (teen < 12 || teen > 14)) return `Осталось ${days} дня`;
  return `Осталось ${days} дней`;
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
    <p class="available-budget__period">Период {{ periodLabel }}</p>
    <h2 id="available-budget-title" class="available-budget__label">Можно потратить</h2>

    <template v-if="details">
      <p class="available-budget__amount">
        <FinanceMoney :minor-units="details.remainingMinor" currency="RUB" :scale="2" />
      </p>

      <UiProgress :value="details.spentMinor" :max="details.limitMinor" :label="progressLabel" />

      <p class="available-budget__state">{{ stateLabel }}</p>

      <dl class="available-budget__rows">
        <div class="available-budget__row">
          <dt>Потрачено</dt>
          <dd><FinanceMoney :minor-units="details.spentMinor" currency="RUB" :scale="2" /></dd>
        </div>
        <div class="available-budget__row">
          <dt>Лимит</dt>
          <dd><FinanceMoney :minor-units="details.limitMinor" currency="RUB" :scale="2" /></dd>
        </div>
        <div class="available-budget__row">
          <dt>{{ daysLabel }}</dt>
          <dd>
            ≈
            <FinanceMoney
              :minor-units="details.averageRemainingDailyLimitMinor"
              currency="RUB"
              :scale="2"
            />
            / день
          </dd>
        </div>
      </dl>
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

.available-budget__period {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
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

.available-budget__rows {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
}

.available-budget__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: baseline;
  justify-content: space-between;
}

.available-budget__row dt {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}

.available-budget__row dd {
  display: flex;
  gap: 0.25rem;
  align-items: baseline;
  margin: 0;
  font-weight: var(--hf-font-weight-medium);
}

.available-budget__empty {
  margin: 0;
  color: var(--hf-color-text-muted);
}
</style>
