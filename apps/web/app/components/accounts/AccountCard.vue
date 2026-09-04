<script setup lang="ts">
import UiCard from '../ui/Card.vue';
import UiStatus from '../ui/Status.vue';
import FinanceMoney from '../finance/FinanceMoney.vue';
import type { AccountDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'AccountCard' });

defineProps<{
  account: AccountDto;
}>();

function getAccountTypeLabel(accountType: AccountDto['accountType']) {
  return {
    BANK_ACCOUNT: 'Банковский счёт',
    BANK_CARD: 'Банковская карта',
    CASH: 'Наличные',
  }[accountType];
}
</script>

<template>
  <UiCard as="article" class="account-card">
    <template #header>
      <div class="account-card__header">
        <div>
          <h2 class="account-card__title">{{ account.name }}</h2>
          <p class="account-card__type">{{ getAccountTypeLabel(account.accountType) }}</p>
        </div>
        <UiStatus
          :label="account.archivedAt ? 'В архиве' : 'Активен'"
          :tone="account.archivedAt ? 'neutral' : 'success'"
        />
      </div>
    </template>

    <dl class="account-card__details">
      <div>
        <dt>Текущий баланс</dt>
        <dd>
          <FinanceMoney
            :minor-units="account.currentBalanceMinor"
            :currency="account.currency"
            :scale="account.scale"
          />
        </dd>
      </div>
      <div>
        <dt>Начальный баланс</dt>
        <dd>
          <FinanceMoney
            :minor-units="account.startingBalanceMinor"
            :currency="account.currency"
            :scale="account.scale"
          />
        </dd>
      </div>
      <div v-if="account.bankName">
        <dt>Банк</dt>
        <dd>{{ account.bankName }}</dd>
      </div>
      <div v-if="account.lastFourDigits">
        <dt>Карта</dt>
        <dd>•••• {{ account.lastFourDigits }}</dd>
      </div>
      <div>
        <dt>Дата начала учёта</dt>
        <dd>{{ account.accountingStartDate }}</dd>
      </div>
    </dl>

    <p v-if="account.comment" class="account-card__comment">{{ account.comment }}</p>

    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </UiCard>
</template>

<style scoped>
.account-card__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--hf-space-4);
}

.account-card__title,
.account-card__type,
.account-card__comment {
  margin: 0;
}

.account-card__title {
  font-size: 1.125rem;
  font-weight: var(--hf-font-weight-semibold);
}

.account-card__type,
.account-card__comment,
.account-card__details dt {
  color: var(--hf-color-text-muted);
}

.account-card__type {
  margin-top: var(--hf-space-1);
}

.account-card__details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--hf-space-4);
  margin: 0;
}

.account-card__details div {
  display: grid;
  gap: var(--hf-space-1);
}

.account-card__details dt {
  font-size: 0.875rem;
}

.account-card__details dd {
  margin: 0;
  font-weight: var(--hf-font-weight-medium);
}

.account-card__comment {
  margin-top: var(--hf-space-4);
}

@media (max-width: 47.9375rem) {
  .account-card__details {
    grid-template-columns: 1fr;
  }
}
</style>
