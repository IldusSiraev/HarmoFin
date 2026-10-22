<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronDown, ChevronUp } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';

defineOptions({ name: 'DashboardOverviewPanel' });

// Every amount is shown as the server sent it; the rows are not an equation.
const props = defineProps<{ dashboard: DashboardV2Response }>();

const monthFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
function formatUntil(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return `до ${monthFormatter.format(new Date(year, month - 1, day))}`;
}

const ready = computed(() => props.dashboard.spendable.state === 'READY');
const horizonLabel = computed(() => formatUntil(props.dashboard.horizonEnd));
const breakdownOpen = ref(false);
</script>

<template>
  <section class="overview" aria-labelledby="dashboard-overview-title">
    <h2 id="dashboard-overview-title" class="overview__title">Общая картина</h2>
    <dl class="overview__rows">
      <div>
        <dt>На счетах</dt>
        <dd><FinanceMoney :minor-units="dashboard.cashMinor" currency="RUB" :scale="2" /></dd>
      </div>
      <div>
        <dt>Отложено на платежи и накопления</dt>
        <dd><FinanceMoney :minor-units="dashboard.protectedMinor" currency="RUB" :scale="2" /></dd>
      </div>
      <div class="overview__row--accent">
        <dt>Свободно для текущих трат</dt>
        <dd>
          <FinanceMoney
            v-if="ready"
            :minor-units="dashboard.spendable.amountMinor ?? '0'"
            currency="RUB"
            :scale="2"
          />
          <span v-else>Лимит не настроен</span>
        </dd>
      </div>
    </dl>

    <button
      type="button"
      class="overview__toggle"
      data-action="toggle-breakdown"
      :aria-expanded="breakdownOpen"
      :aria-controls="breakdownOpen ? 'dashboard-overview-breakdown' : undefined"
      @click="breakdownOpen = !breakdownOpen"
    >
      Как рассчитано
      <component :is="breakdownOpen ? ChevronUp : ChevronDown" :size="16" aria-hidden="true" />
    </button>
    <div v-if="breakdownOpen" id="dashboard-overview-breakdown" class="overview__breakdown">
      <dl class="overview__list">
        <div>
          <dt>Остаток текущего периода</dt>
          <dd>
            <FinanceMoney :minor-units="dashboard.currentBalanceMinor" currency="RUB" :scale="2" />
          </dd>
        </div>
        <div>
          <dt>К оплате {{ horizonLabel }}</dt>
          <dd>
            <FinanceMoney :minor-units="dashboard.mandatoryDueMinor" currency="RUB" :scale="2" />
          </dd>
        </div>
      </dl>
      <h3 class="overview__group">Уже отложено на платежи и накопления</h3>
      <dl class="overview__list">
        <div>
          <dt>Отложено на обязательные платежи</dt>
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
          <dt>Не распределено</dt>
          <dd>
            <FinanceMoney :minor-units="dashboard.freeToAssignMinor" currency="RUB" :scale="2" />
          </dd>
        </div>
      </dl>
      <p class="overview__note">
        Деньги находятся на счетах. Конверты только показывают их назначение.
      </p>
    </div>
  </section>
</template>

<style scoped>
.overview {
  display: grid;
  align-content: start;
  gap: var(--hf-space-4);
  padding: var(--hf-card-padding);
  background: var(--hf-color-surface-subtle);
}

.overview__title,
.overview__group {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.overview__group {
  letter-spacing: normal;
  text-transform: none;
}

.overview__rows,
.overview__list {
  display: grid;
  margin: 0;
}

.overview__rows > div {
  display: flex;
  gap: var(--hf-space-3);
  justify-content: space-between;
  padding-block: var(--hf-space-3);
  border-bottom: 1px solid var(--hf-color-border);
}

.overview__list {
  gap: var(--hf-space-2);
}

.overview__list > div {
  display: flex;
  gap: var(--hf-space-3);
  justify-content: space-between;
  font-size: var(--hf-font-size-small);
}

.overview dt {
  color: var(--hf-color-text-muted);
}

.overview dd {
  margin: 0;
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.overview__row--accent dt,
.overview__row--accent dd {
  color: var(--hf-color-action-primary-text);
}

.overview__toggle {
  display: inline-flex;
  gap: var(--hf-space-1);
  align-items: center;
  justify-self: start;
  min-height: 2.75rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--hf-color-action-primary-text);
  font: inherit;
  font-weight: var(--hf-font-weight-medium);
  cursor: pointer;
}

.overview__toggle:focus-visible {
  outline: 2px solid var(--hf-color-focus-ring);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}

.overview__breakdown {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface);
}

.overview__note {
  margin: 0;
  padding-top: var(--hf-space-2);
  border-top: 1px solid var(--hf-color-border);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}
</style>
