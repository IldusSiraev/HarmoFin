<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import { formatMinorUnits } from '../finance/money-format.js';
import UiStatus from '../ui/Status.vue';
import type { AccountDto } from '../../composables/useBudgetReferenceData.js';
import { ACCOUNT_TYPE_ICONS, accountSubtitle } from './account-type.js';

defineOptions({ name: 'AccountRow' });

const props = defineProps<{ account: AccountDto }>();

defineEmits<{ select: [] }>();

const icon = computed(() => ACCOUNT_TYPE_ICONS[props.account.accountType]);
const subtitle = computed(() => accountSubtitle(props.account));

// The sign comes from the server value; the client never computes the balance.
const isNegative = computed(() => props.account.currentBalanceMinor.startsWith('-'));

// role=button on the whole card hides all its visible content from assistive
// tech, so the balance and status shown visually must also be folded into
// the accessible name here, or that information never reaches screen readers.
const formattedBalance = computed(() =>
  formatMinorUnits(props.account.currentBalanceMinor, props.account.currency, props.account.scale),
);

const cardLabel = computed(() => {
  const parts = [`Открыть счёт «${props.account.name}»`, `баланс ${formattedBalance.value}`];
  if (isNegative.value) parts.push('ниже нуля');
  if (props.account.archivedAt) parts.push('в архиве');
  return parts.join(', ');
});
</script>

<template>
  <button
    type="button"
    class="account-card"
    data-testid="account-card-select"
    :aria-label="cardLabel"
    @click="$emit('select')"
  >
    <span class="account-card__top">
      <span class="account-card__icon"><component :is="icon" :size="20" aria-hidden="true" /></span>
      <span class="account-card__identity">
        <span class="account-card__name">{{ account.name }}</span>
        <span class="account-card__subtitle">{{ subtitle }}</span>
      </span>
      <FinanceMoney
        class="account-card__amount"
        :minor-units="account.currentBalanceMinor"
        :currency="account.currency"
        :scale="account.scale"
      />
    </span>

    <span class="account-card__bottom">
      <span class="account-card__status">
        <UiStatus
          v-if="isNegative"
          data-testid="account-row-negative"
          label="Ниже нуля"
          tone="danger"
        />
        <UiStatus
          v-if="account.archivedAt"
          data-testid="account-row-archived"
          label="В архиве"
          tone="neutral"
        />
        <UiStatus v-if="!isNegative && !account.archivedAt" label="Активен" tone="success" />
      </span>
      <span class="account-card__more">Подробнее<ArrowRight :size="14" aria-hidden="true" /></span>
    </span>
  </button>
</template>

<style scoped>
.account-card {
  /* A <button> doesn't stretch to fill its grid cell just from display:grid
     the way a <div> would — form controls size to their content by default
     in some browsers regardless of display, so this needs to be explicit or
     two cards with different text lengths render at different widths. */
  width: 100%;
  display: grid;
  gap: var(--hf-space-4);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.account-card:hover {
  border-color: var(--hf-color-border-strong);
}

.account-card:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.account-card__top {
  display: flex;
  gap: var(--hf-space-3);
  align-items: flex-start;
}

.account-card__icon {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text-muted);
}

.account-card__identity {
  display: grid;
  flex: 1;
  gap: 0.125rem;
  min-width: 0;
}

.account-card__name {
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-card__subtitle {
  overflow: hidden;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-card__amount {
  flex-shrink: 0;
  font-size: var(--hf-font-size-h3);
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.account-card__bottom {
  display: flex;
  gap: var(--hf-space-3);
  align-items: center;
  justify-content: space-between;
}

.account-card__status {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-1);
  align-items: center;
}

.account-card__more {
  display: inline-flex;
  flex-shrink: 0;
  gap: var(--hf-space-1);
  align-items: center;
  color: var(--hf-color-action-primary-hover);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
}
</style>
