<script setup lang="ts">
import { computed } from 'vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import UiButton from '../ui/Button.vue';
import UiDrawer from '../ui/Drawer.vue';
import UiStatus from '../ui/Status.vue';
import type { AccountDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'AccountDrawer' });

const props = defineProps<{ account: AccountDto | null }>();

const emit = defineEmits<{
  close: [];
  edit: [account: AccountDto];
  archive: [account: AccountDto];
}>();

const TYPE_LABELS = {
  BANK_ACCOUNT: 'Банковский счёт',
  BANK_CARD: 'Банковская карта',
  CASH: 'Наличные',
} as const;

const typeLabel = computed(() => (props.account ? TYPE_LABELS[props.account.accountType] : ''));

const operationsLink = computed(() =>
  props.account ? `/app/operations?accountId=${encodeURIComponent(props.account.id)}` : '',
);

const transferLink = computed(() =>
  props.account ? `/app/transfers?sourceAccountId=${encodeURIComponent(props.account.id)}` : '',
);
</script>

<template>
  <UiDrawer :open="account !== null" title="Счёт" @close="emit('close')">
    <div v-if="account" class="account-drawer">
      <p class="account-drawer__amount">
        <FinanceMoney
          :minor-units="account.currentBalanceMinor"
          :currency="account.currency"
          :scale="account.scale"
        />
      </p>
      <UiStatus
        :label="account.archivedAt ? 'В архиве' : 'Активен'"
        :tone="account.archivedAt ? 'neutral' : 'success'"
      />

      <dl class="account-drawer__rows">
        <div>
          <dt>Название</dt>
          <dd>{{ account.name }}</dd>
        </div>
        <div>
          <dt>Тип</dt>
          <dd>{{ typeLabel }}</dd>
        </div>
        <div v-if="account.bankName">
          <dt>Банк</dt>
          <dd>{{ account.bankName }}</dd>
        </div>
        <div v-if="account.lastFourDigits">
          <dt>Последние цифры</dt>
          <dd>{{ account.lastFourDigits }}</dd>
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
        <div>
          <dt>Дата начала учёта</dt>
          <dd>{{ account.accountingStartDate }}</dd>
        </div>
        <div v-if="account.comment">
          <dt>Комментарий</dt>
          <dd>{{ account.comment }}</dd>
        </div>
      </dl>
    </div>

    <template v-if="account" #footer>
      <UiButton data-testid="account-drawer-edit" @click="emit('edit', account)">
        Изменить
      </UiButton>
      <UiButton variant="secondary" data-testid="account-drawer-operations" :to="operationsLink">
        Операции счёта
      </UiButton>
      <UiButton
        v-if="!account.archivedAt"
        variant="secondary"
        data-testid="account-drawer-transfer"
        :to="transferLink"
      >
        Перевести со счёта
      </UiButton>
      <UiButton
        v-if="!account.archivedAt"
        variant="tertiary"
        data-testid="account-drawer-archive"
        @click="emit('archive', account)"
      >
        Переместить в архив
      </UiButton>
    </template>
  </UiDrawer>
</template>

<style scoped>
.account-drawer {
  display: grid;
  gap: var(--hf-space-4);
}

.account-drawer__amount {
  margin: 0;
  font-size: var(--hf-font-size-h2);
  font-weight: var(--hf-font-weight-bold);
  line-height: var(--hf-line-height-h2);
}

.account-drawer__rows {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
}

.account-drawer__rows div {
  display: flex;
  gap: var(--hf-space-3);
  justify-content: space-between;
}

.account-drawer__rows dt {
  color: var(--hf-color-text-muted);
}

.account-drawer__rows dd {
  margin: 0;
  text-align: right;
}
</style>
