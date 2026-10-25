<script setup lang="ts">
import { computed } from 'vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import UiButton from '../ui/Button.vue';
import UiModal from '../ui/Modal.vue';
import UiStatus from '../ui/Status.vue';
import type { AccountDto } from '../../composables/useBudgetReferenceData.js';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
import { usePermissions } from '../../composables/usePermissions.js';
import { formatPlainDate } from '../obligations/format-plain-date.js';

defineOptions({ name: 'AccountDialog' });

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

const { openTransfer } = useOperationDialogs();
// Editing/archiving an account is OWNER-only on the server; a transfer needs
// OWNER or EDITOR. A viewer sees only the read-only "Операции счёта" link.
const { canManage, canWrite } = usePermissions();

function transferFromAccount(): void {
  if (!props.account) return;
  emit('close');
  openTransfer(props.account.id);
}
</script>

<template>
  <UiModal :open="account !== null" title="Счёт" size="sm" @close="emit('close')">
    <div v-if="account" class="account-dialog">
      <p class="account-dialog__amount">
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

      <dl class="account-dialog__rows">
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
          <dd>{{ formatPlainDate(account.accountingStartDate) }}</dd>
        </div>
        <div v-if="account.comment">
          <dt>Комментарий</dt>
          <dd>{{ account.comment }}</dd>
        </div>
      </dl>
    </div>

    <template v-if="account" #footer>
      <UiButton v-if="canManage" data-testid="account-dialog-edit" @click="emit('edit', account)">
        Изменить
      </UiButton>
      <UiButton variant="secondary" data-testid="account-dialog-operations" :to="operationsLink">
        Операции счёта
      </UiButton>
      <UiButton
        v-if="!account.archivedAt && canWrite"
        variant="secondary"
        data-testid="account-dialog-transfer"
        @click="transferFromAccount"
      >
        Перевести со счёта
      </UiButton>
      <UiButton
        v-if="!account.archivedAt && canManage"
        variant="tertiary"
        data-testid="account-dialog-archive"
        @click="emit('archive', account)"
      >
        Переместить в архив
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.account-dialog {
  display: grid;
  gap: var(--hf-space-4);
}

.account-dialog__amount {
  margin: 0;
  font-size: var(--hf-font-size-h2);
  font-weight: var(--hf-font-weight-bold);
  line-height: var(--hf-line-height-h2);
}

.account-dialog__rows {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
}

.account-dialog__rows div {
  display: flex;
  gap: var(--hf-space-3);
  justify-content: space-between;
}

.account-dialog__rows dt {
  color: var(--hf-color-text-muted);
}

.account-dialog__rows dd {
  margin: 0;
  text-align: right;
}
</style>
