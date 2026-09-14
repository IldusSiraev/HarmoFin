<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { auditActionLabel, auditActorName, formatAuditMoment } from './audit-event.js';
import IncomeAllocationForm from './IncomeAllocationForm.vue';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiButton from '../ui/Button.vue';
import UiDrawer from '../ui/Drawer.vue';
import UiStatus from '../ui/Status.vue';
import {
  useBudgetReferenceData,
  type AuditEventDto,
  type IncomeAllocationDto,
  type TransactionDto,
} from '../../composables/useBudgetReferenceData.js';
import { useOperationMutations } from '../../composables/useOperationMutations.js';

defineOptions({ name: 'OperationDrawer' });

type Option = { value: string; label: string };

const props = defineProps<{
  transaction: TransactionDto | null;
  budgetId: string;
  accountName: string;
  categoryName: string;
  envelopeName: string | null;
  accounts: ReadonlyArray<Option>;
  envelopes: ReadonlyArray<Option>;
}>();

const emit = defineEmits<{
  close: [];
  changed: [transaction: TransactionDto];
  edit: [transaction: TransactionDto];
  'request-delete': [transaction: TransactionDto];
}>();

const api = useBudgetReferenceData();
const mutations = useOperationMutations();

const allocations = ref<IncomeAllocationDto[]>([]);
const auditEvents = ref<AuditEventDto[]>([]);
const detailsError = ref('');

const statusLabel = computed(() => {
  const status = props.transaction?.status;
  if (status === 'DRAFT') return 'Черновик';
  if (status === 'CANCELLED') return 'Отменена';
  if (status === 'DELETED') return 'Удалена';
  return 'Подтверждена';
});

const actions = computed(() =>
  props.transaction ? mutations.availableActions(props.transaction.status) : [],
);

const isIncome = computed(() => props.transaction?.transactionType === 'INCOME');

// Rejecting the server's proposal only hides it for this viewing — the rule
// that a proposal never creates an allocation by itself does not change.
const proposalRejected = ref(false);

const showAllocationForm = computed(
  () =>
    isIncome.value &&
    !proposalRejected.value &&
    props.transaction?.status === 'CONFIRMED' &&
    props.transaction.unallocatedMinor !== '0',
);

watch(
  () => props.transaction?.id,
  async (id) => {
    allocations.value = [];
    auditEvents.value = [];
    detailsError.value = '';
    proposalRejected.value = false;
    if (id === undefined) return;
    try {
      const [allocationList, auditList] = await Promise.all([
        api.listTransactionAllocations(props.budgetId, id),
        api.listTransactionAudit(props.budgetId, id),
      ]);
      allocations.value = allocationList;
      auditEvents.value = auditList;
    } catch {
      detailsError.value = 'Не удалось загрузить детали операции.';
    }
  },
  { immediate: true },
);

async function runAction(action: 'confirm' | 'cancel' | 'restore'): Promise<void> {
  const current = props.transaction;
  if (!current) return;
  const updated =
    action === 'confirm'
      ? await mutations.confirm(props.budgetId, current)
      : action === 'cancel'
        ? await mutations.cancel(props.budgetId, current)
        : await mutations.restore(props.budgetId, current);
  if (updated) emit('changed', updated);
}

async function saveAllocation(input: {
  amount: string;
  occurredOn: string;
  accountId: string;
  envelopeId: string;
}): Promise<void> {
  const current = props.transaction;
  if (!current) return;
  try {
    await api.createIncomeAllocation(props.budgetId, current.id, input, crypto.randomUUID());
    const refreshed = await api.getTransaction(props.budgetId, current.id);
    allocations.value = await api.listTransactionAllocations(props.budgetId, current.id);
    emit('changed', refreshed);
  } catch {
    detailsError.value = 'Не удалось сохранить распределение.';
  }
}
</script>

<template>
  <UiDrawer :open="transaction !== null" title="Операция" @close="emit('close')">
    <div v-if="transaction" class="operation-drawer">
      <p class="operation-drawer__amount">
        <FinanceMoney
          :minor-units="transaction.amountMinor"
          :currency="transaction.currency"
          :scale="transaction.scale"
        />
      </p>
      <UiStatus :label="statusLabel" tone="neutral" />

      <dl class="operation-drawer__rows">
        <div>
          <dt>Дата</dt>
          <dd>{{ transaction.occurredOn }}</dd>
        </div>
        <div>
          <dt>Категория</dt>
          <dd>{{ categoryName }}</dd>
        </div>
        <div>
          <dt>Счёт</dt>
          <dd>{{ accountName }}</dd>
        </div>
        <div v-if="envelopeName">
          <dt>Конверт</dt>
          <dd>{{ envelopeName }}</dd>
        </div>
        <div v-if="transaction.merchantName">
          <dt>Получатель</dt>
          <dd>{{ transaction.merchantName }}</dd>
        </div>
        <div v-if="transaction.sourceDescription">
          <dt>Источник</dt>
          <dd>{{ transaction.sourceDescription }}</dd>
        </div>
        <div v-if="transaction.comment">
          <dt>Комментарий</dt>
          <dd>{{ transaction.comment }}</dd>
        </div>
        <div v-if="transaction.isPlanned">
          <dt>План</dt>
          <dd>Запланирована</dd>
        </div>
      </dl>

      <p v-if="detailsError" class="operation-drawer__error" role="alert">{{ detailsError }}</p>

      <section v-if="isIncome" aria-labelledby="operation-drawer-allocations">
        <h3 id="operation-drawer-allocations">Распределения дохода</h3>
        <ul v-if="allocations.length > 0" class="operation-drawer__list">
          <li v-for="allocation in allocations" :key="allocation.id">
            <FinanceMoney
              :minor-units="allocation.amountMinor"
              :currency="allocation.currency"
              :scale="allocation.scale"
            />
          </li>
        </ul>
        <p v-else>Распределений пока нет.</p>

        <IncomeAllocationForm
          v-if="showAllocationForm"
          :proposal="transaction.allocationProposal"
          :remaining-minor="transaction.unallocatedMinor"
          :accounts="accounts"
          :envelopes="envelopes"
          :pending="mutations.pending.value"
          @submit="saveAllocation"
          @reject="proposalRejected = true"
        />
      </section>

      <section aria-labelledby="operation-drawer-audit">
        <h3 id="operation-drawer-audit">История изменений</h3>
        <ol v-if="auditEvents.length > 0" class="operation-drawer__history">
          <li v-for="event in auditEvents" :key="event.id" data-testid="drawer-audit-event">
            <span class="operation-drawer__history-action">{{
              auditActionLabel(event.action)
            }}</span>
            <span class="operation-drawer__history-meta">
              {{ formatAuditMoment(event.createdAt) }} · {{ auditActorName(event) }}
            </span>
          </li>
        </ol>
        <p v-else>История пуста.</p>
      </section>
    </div>

    <template v-if="transaction" #footer>
      <UiButton
        v-if="actions.includes('confirm')"
        data-testid="drawer-confirm"
        :disabled="mutations.pending.value"
        @click="runAction('confirm')"
      >
        Подтвердить
      </UiButton>
      <UiButton
        v-if="transaction.status !== 'DELETED'"
        variant="secondary"
        data-testid="drawer-edit"
        @click="emit('edit', transaction)"
      >
        Изменить
      </UiButton>
      <UiButton
        v-if="actions.includes('cancel')"
        variant="tertiary"
        data-testid="drawer-cancel"
        :disabled="mutations.pending.value"
        @click="runAction('cancel')"
      >
        Отменить
      </UiButton>
      <UiButton
        v-if="actions.includes('delete')"
        variant="tertiary"
        data-testid="drawer-delete"
        @click="emit('request-delete', transaction)"
      >
        Удалить
      </UiButton>
      <UiButton
        v-if="actions.includes('restore')"
        variant="secondary"
        data-testid="drawer-restore"
        :disabled="mutations.pending.value"
        @click="runAction('restore')"
      >
        Восстановить
      </UiButton>
    </template>
  </UiDrawer>
</template>

<style scoped>
.operation-drawer {
  display: grid;
  gap: var(--hf-space-4);
}

.operation-drawer__amount {
  margin: 0;
  font-size: var(--hf-font-size-h2);
  font-weight: var(--hf-font-weight-bold);
  line-height: var(--hf-line-height-h2);
}

.operation-drawer__rows {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
}

.operation-drawer__rows div {
  display: flex;
  gap: var(--hf-space-3);
  justify-content: space-between;
}

.operation-drawer__rows dt {
  color: var(--hf-color-text-muted);
}

.operation-drawer__rows dd {
  margin: 0;
  text-align: right;
}

.operation-drawer__list {
  display: grid;
  gap: var(--hf-space-1);
  margin: 0;
  padding-left: var(--hf-space-5);
}

.operation-drawer__history {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.operation-drawer__history li {
  display: grid;
  gap: 0.125rem;
}

.operation-drawer__history-action {
  font-weight: var(--hf-font-weight-medium);
}

.operation-drawer__history-meta {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.operation-drawer__error {
  margin: 0;
  color: var(--hf-color-text-danger);
}
</style>
