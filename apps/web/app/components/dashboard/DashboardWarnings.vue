<script setup lang="ts">
import { computed } from 'vue';
import { Info, TriangleAlert } from '@lucide/vue';

import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';

defineOptions({ name: 'DashboardWarnings' });

type WarningRow = {
  key: string;
  kind: 'balance' | 'income';
  /** MANDATORY_GAP only: ALERT needs money now, INFO only for the next period; absent otherwise. */
  level: 'ALERT' | 'INFO' | null;
  text: string;
  href: string;
  actionLabel: string;
};

type V2Warning = DashboardV2Response['warnings'][number];

// Server text + actionPath for each warning.
const props = defineProps<{
  v2Warnings: ReadonlyArray<V2Warning>;
}>();

const V2_ACTION_LABELS: Record<V2Warning['code'], string> = {
  MANDATORY_GAP: 'Покрыть обязательные',
  CASH_SHORTFALL: 'Проверить счета',
  PERIOD_DEFICIT: 'Покрыть превышение',
  PERIOD_LEFTOVER: 'Решить, куда направить',
};

const rows = computed<WarningRow[]>(() =>
  props.v2Warnings.map((warning, index) => ({
    key: `${warning.code}-${warning.periodId ?? warning.envelopeId ?? index}`,
    kind: warning.code === 'PERIOD_LEFTOVER' ? 'income' : 'balance',
    // A missing level means the current period is affected: render it as ALERT.
    level: warning.code === 'MANDATORY_GAP' ? (warning.level ?? 'ALERT') : null,
    text: warning.message,
    href: warning.actionPath,
    actionLabel: V2_ACTION_LABELS[warning.code],
  })),
);
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
          v-if="row.kind === 'balance' && row.level !== 'INFO'"
          class="dashboard-warnings__icon dashboard-warnings__icon--danger"
          :size="20"
          aria-hidden="true"
        />
        <Info
          v-else
          class="dashboard-warnings__icon"
          :class="{ 'dashboard-warnings__icon--info': row.level === 'INFO' }"
          :size="20"
          aria-hidden="true"
        />

        <span class="dashboard-warnings__text">{{ row.text }}</span>
        <NuxtLink :to="row.href" class="dashboard-warnings__link">{{ row.actionLabel }}</NuxtLink>
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

/* Not color-only: INFO also swaps the alert triangle for the info icon. */
.dashboard-warnings__icon--info {
  color: var(--hf-color-status-info);
}

.dashboard-warnings__text {
  flex: 1 1 12rem;
  min-width: 0;
}

.dashboard-warnings__link {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  /* Text-grade teal: brand action-primary falls short of 4.5:1 as a 16px link. */
  color: var(--hf-color-action-primary-text);
  font-weight: var(--hf-font-weight-medium);
}
</style>
