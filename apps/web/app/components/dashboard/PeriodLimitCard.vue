<script setup lang="ts">
import type { DashboardSummaryDto } from '../../composables/useBudgetReferenceData.js';
import FinanceMoney from '../finance/FinanceMoney.vue';

defineProps<{ periodLimit: DashboardSummaryDto['periodLimit'] }>();
</script>

<template>
  <section class="period-limit-card" aria-labelledby="period-limit-title">
    <h2 id="period-limit-title">Текущий период</h2>
    <template v-if="periodLimit.state === 'available'">
      <dl>
        <div>
          <dt>Лимит:</dt>
          <dd><FinanceMoney :minor-units="periodLimit.limitMinor" currency="RUB" :scale="2" /></dd>
        </div>
        <div>
          <dt>Потрачено:</dt>
          <dd><FinanceMoney :minor-units="periodLimit.spentMinor" currency="RUB" :scale="2" /></dd>
        </div>
        <div>
          <dt>Остаток:</dt>
          <dd>
            <FinanceMoney :minor-units="periodLimit.remainingMinor" currency="RUB" :scale="2" />
          </dd>
        </div>
        <div>
          <dt>До следующей границы:</dt>
          <dd>{{ periodLimit.daysUntilBoundary }} дней</dd>
        </div>
        <div>
          <dt>В среднем на день</dt>
          <dd>
            <FinanceMoney
              :minor-units="periodLimit.averageRemainingDailyLimitMinor"
              currency="RUB"
              :scale="2"
            />
          </dd>
        </div>
      </dl>
    </template>
    <p v-else class="period-limit-card__unavailable">Конверт текущего периода не настроен.</p>
  </section>
</template>

<style scoped>
.period-limit-card {
  padding: var(--hf-card-padding);
  border-left: 5px solid var(--hf-color-action-primary);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.period-limit-card h2,
.period-limit-card p,
.period-limit-card dl,
.period-limit-card dd {
  margin: 0;
}
.period-limit-card dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--hf-space-4);
  margin-top: var(--hf-space-5);
}
.period-limit-card dt {
  color: var(--hf-color-text-muted);
  font-size: 0.8rem;
}
.period-limit-card dd {
  margin-top: var(--hf-space-1);
  font-weight: var(--hf-font-weight-bold);
}
.period-limit-card__unavailable {
  margin-top: var(--hf-space-4);
  color: var(--hf-color-text-muted);
}
@media (max-width: 47.9375rem) {
  .period-limit-card dl {
    grid-template-columns: 1fr;
  }
}
</style>
