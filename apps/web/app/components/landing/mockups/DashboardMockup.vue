<script setup lang="ts">
import { computed } from 'vue';

import { formatLandingMoney } from '../format-money.js';
import { heroBudget, heroEnvelopes } from '../../../data/landing.js';

defineOptions({ name: 'DashboardMockup' });

const spentPercent = computed(() => {
  const spent = Number(BigInt(heroBudget.spentMinor));
  const limit = Number(BigInt(heroBudget.periodLimitMinor));
  return limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
});

const rows = computed(() => [
  { label: 'Лимит на период', value: formatLandingMoney(heroBudget.periodLimitMinor) },
  { label: 'Потрачено', value: formatLandingMoney(heroBudget.spentMinor) },
  { label: 'Средний лимит', value: `${formatLandingMoney(heroBudget.dailyAverageMinor)} / день` },
]);

const envelopes = computed(() =>
  heroEnvelopes.map((envelope) => ({
    ...envelope,
    formatted: formatLandingMoney(envelope.amountMinor),
  })),
);

const available = computed(() => formatLandingMoney(heroBudget.availableMinor));
</script>

<template>
  <div class="dashboard-mockup" aria-hidden="true">
    <div class="dashboard-mockup__chrome">
      <span class="dashboard-mockup__wordmark">HarmoFin</span>
    </div>

    <div class="dashboard-mockup__meta">
      <span>{{ heroBudget.dateLabel }}</span>
      <span>{{ heroBudget.periodLabel }}</span>
      <span>Осталось {{ heroBudget.daysLeft }} дней</span>
    </div>

    <p class="dashboard-mockup__label">Можно потратить</p>
    <p class="dashboard-mockup__value">{{ available }}</p>

    <div class="dashboard-mockup__track">
      <div class="dashboard-mockup__fill" :style="{ width: `${spentPercent}%` }" />
    </div>

    <dl class="dashboard-mockup__rows">
      <div v-for="row in rows" :key="row.label" class="dashboard-mockup__row">
        <dt>{{ row.label }}</dt>
        <dd>{{ row.value }}</dd>
      </div>
    </dl>

    <ul class="dashboard-mockup__envelopes">
      <li
        v-for="envelope in envelopes"
        :key="envelope.name"
        class="dashboard-mockup__envelope"
        :class="`dashboard-mockup__envelope--${envelope.tone}`"
      >
        <span>{{ envelope.name }}</span>
        <strong>{{ envelope.formatted }}</strong>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.dashboard-mockup {
  display: grid;
  gap: var(--hf-space-4);
  padding: var(--hf-space-5);
  background: var(--hf-color-surface);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-xl);
  box-shadow: var(--hf-shadow-lg);
}

.dashboard-mockup__chrome {
  display: flex;
  align-items: center;
}

.dashboard-mockup__wordmark {
  font-weight: var(--hf-font-weight-semibold);
  color: var(--hf-color-text);
}

.dashboard-mockup__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2) var(--hf-space-4);
  font-size: var(--hf-font-size-caption);
  color: var(--hf-color-text-muted);
}

.dashboard-mockup__label {
  margin: 0;
  font-size: var(--hf-font-size-small);
  color: var(--hf-color-text-muted);
}

.dashboard-mockup__value {
  margin: 0;
  font-size: var(--hf-font-size-display);
  font-variant-numeric: tabular-nums;
  font-weight: var(--hf-font-weight-bold);
  color: var(--hf-color-brand);
}

.dashboard-mockup__track {
  height: 0.625rem;
  overflow: hidden;
  background: var(--hf-color-slate-200);
  border-radius: var(--hf-radius-sm);
}

.dashboard-mockup__fill {
  height: 100%;
  background: var(--hf-color-brand-bright);
  border-radius: var(--hf-radius-sm);
}

.dashboard-mockup__rows {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  font-size: var(--hf-font-size-caption);
  color: var(--hf-color-text-muted);
}

.dashboard-mockup__row {
  display: flex;
  justify-content: space-between;
  margin: 0;
}

.dashboard-mockup__row dt,
.dashboard-mockup__row dd {
  margin: 0;
}

.dashboard-mockup__envelopes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--hf-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.dashboard-mockup__envelope {
  display: flex;
  flex-direction: column;
  gap: var(--hf-space-1);
  padding: var(--hf-space-3);
  border-radius: var(--hf-radius-md);
}

.dashboard-mockup__envelope--brand {
  background: var(--hf-color-brand-soft);
}

.dashboard-mockup__envelope--primary {
  background: var(--hf-color-primary-soft);
}

.dashboard-mockup__envelope--warning {
  background: var(--hf-color-warning-soft);
}

.dashboard-mockup__envelope--neutral {
  background: var(--hf-color-page-background);
}

@media (max-width: 480px) {
  .dashboard-mockup__meta {
    flex-direction: column;
  }

  .dashboard-mockup__rows {
    grid-template-columns: 1fr;
  }
}
</style>
