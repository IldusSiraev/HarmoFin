<script setup lang="ts">
import { computed } from 'vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import { formatMinorUnits } from '../finance/money-format.js';
import UiListRow from '../ui/ListRow.vue';
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

// UiListRow renders this as the button's explicit aria-label, which per ARIA
// semantics replaces name-from-content entirely — so the balance and status
// badges rendered inside the row (visually) must also be folded in here, or
// assistive tech never receives them at all.
const formattedBalance = computed(() =>
  formatMinorUnits(props.account.currentBalanceMinor, props.account.currency, props.account.scale),
);

const rowLabel = computed(() => {
  const parts = [`Открыть счёт «${props.account.name}»`, `баланс ${formattedBalance.value}`];
  if (isNegative.value) parts.push('ниже нуля');
  if (props.account.archivedAt) parts.push('в архиве');
  return parts.join(', ');
});
</script>

<template>
  <UiListRow :label="rowLabel" @select="$emit('select')">
    <template #leading><component :is="icon" :size="20" aria-hidden="true" /></template>

    <span class="account-row__title">{{ account.name }}</span>
    <span class="account-row__subtitle">{{ subtitle }}</span>
    <span v-if="isNegative || account.archivedAt" class="account-row__meta">
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
    </span>

    <template #trailing>
      <FinanceMoney
        class="account-row__amount"
        :minor-units="account.currentBalanceMinor"
        :currency="account.currency"
        :scale="account.scale"
      />
    </template>

    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </UiListRow>
</template>

<style scoped>
.account-row__title {
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-row__subtitle {
  overflow: hidden;
  max-width: 100%;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-1);
  align-items: center;
}

.account-row__amount {
  font-weight: var(--hf-font-weight-semibold);
  white-space: nowrap;
}
</style>
