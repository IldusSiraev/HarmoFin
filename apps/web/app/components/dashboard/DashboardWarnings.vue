<script setup lang="ts">
import { computed } from 'vue';
import { Info, TriangleAlert } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import type { DashboardSummaryDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'DashboardWarnings' });

type DashboardWarning = DashboardSummaryDto['warnings'][number];
type DashboardBalance = DashboardSummaryDto['accounts'][number];

type WarningRow = {
  key: string;
  kind: 'balance' | 'income';
  text: string;
  amountMinor: string;
  href: string;
};

const props = defineProps<{
  warnings: ReadonlyArray<DashboardWarning>;
  accounts: ReadonlyArray<DashboardBalance>;
  envelopes: ReadonlyArray<DashboardBalance>;
  unallocatedIncomeMinor: string;
}>();

function warningText(warning: DashboardWarning): string {
  const kind = warning.subject === 'ACCOUNT' ? 'Счёт' : 'Конверт';
  const source = warning.subject === 'ACCOUNT' ? props.accounts : props.envelopes;
  const name = source.find((item) => item.id === warning.id)?.name;
  return name === undefined ? `${kind} в минусе` : `${kind} «${name}» в минусе`;
}

const rows = computed<WarningRow[]>(() => {
  const result: WarningRow[] = props.warnings.map((warning) => ({
    key: `${warning.subject}-${warning.id}`,
    kind: 'balance',
    text: warningText(warning),
    amountMinor: warning.balanceMinor,
    href: warning.subject === 'ACCOUNT' ? '/app/accounts' : '/app/envelopes',
  }));

  if (BigInt(props.unallocatedIncomeMinor) > 0n) {
    result.push({
      key: 'unallocated-income',
      kind: 'income',
      text: 'Доход не распределён по конвертам',
      amountMinor: props.unallocatedIncomeMinor,
      href: '/app/operations',
    });
  }

  return result;
});
</script>

<template>
  <section
    v-if="rows.length > 0"
    class="dashboard-warnings"
    data-testid="dashboard-warnings"
    aria-labelledby="dashboard-warnings-title"
  >
    <h2 id="dashboard-warnings-title" class="dashboard-warnings__title">Требует внимания</h2>

    <ul class="dashboard-warnings__list">
      <li v-for="row in rows" :key="row.key" class="dashboard-warnings__row">
        <TriangleAlert
          v-if="row.kind === 'balance'"
          class="dashboard-warnings__icon dashboard-warnings__icon--danger"
          :size="20"
          aria-hidden="true"
        />
        <Info v-else class="dashboard-warnings__icon" :size="20" aria-hidden="true" />

        <span class="dashboard-warnings__text">{{ row.text }}</span>
        <FinanceMoney
          class="dashboard-warnings__amount"
          :minor-units="row.amountMinor"
          currency="RUB"
          :scale="2"
        />
        <NuxtLink :to="row.href" class="dashboard-warnings__link">Посмотреть</NuxtLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.dashboard-warnings {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

.dashboard-warnings__title {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}

.dashboard-warnings__list {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.dashboard-warnings__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: center;
  min-height: 2.75rem;
}

.dashboard-warnings__icon {
  flex-shrink: 0;
  color: var(--hf-color-status-info);
}

.dashboard-warnings__icon--danger {
  color: var(--hf-color-status-danger);
}

.dashboard-warnings__text {
  flex: 1 1 12rem;
  min-width: 0;
}

.dashboard-warnings__amount {
  font-weight: var(--hf-font-weight-semibold);
}

.dashboard-warnings__link {
  color: var(--hf-color-action-primary);
  font-weight: var(--hf-font-weight-medium);
}
</style>
