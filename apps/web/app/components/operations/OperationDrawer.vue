<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { auditActionLabel, auditActorName, formatAuditMoment } from './audit-event.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiButton from '../ui/Button.vue';
import UiDrawer from '../ui/Drawer.vue';
import UiStatus from '../ui/Status.vue';
import {
  useBudgetReferenceData,
  type AuditEventDto,
} from '../../composables/useBudgetReferenceData.js';
import type { TransactionJournalV2Item } from '../../composables/useEnvelopePlanV2.js';
import { availableActions, canEditTransaction } from '../../composables/useOperationMutations.js';

defineOptions({ name: 'OperationDrawer' });

const props = defineProps<{
  transaction: TransactionJournalV2Item | null;
  budgetId: string;
  accountName: string;
  categoryName: string;
  envelopeName: string | null;
  // The page runs the mutations; while one is in flight the actions stay off.
  busy: boolean;
}>();

const emit = defineEmits<{
  close: [];
  edit: [transaction: TransactionJournalV2Item];
  'request-delete': [transaction: TransactionJournalV2Item];
  'request-restore': [transaction: TransactionJournalV2Item];
}>();

// The audit route is not bound to the accounting model, so it still lives on the
// shared reference client; everything else here is the v2 journal row.
const api = useBudgetReferenceData();

// The journal money scale is fixed: the API serves RUB in minor units.
const SCALE = 2;

const auditEvents = ref<AuditEventDto[]>([]);
const detailsError = ref('');

const statusLabel = computed(() => {
  const status = props.transaction?.status;
  if (status === 'DRAFT') return 'Черновик';
  if (status === 'CANCELLED') return 'Отменена';
  if (status === 'DELETED') return 'Удалена';
  return 'Подтверждена';
});

const actions = computed(() => (props.transaction ? availableActions(props.transaction) : []));
const editable = computed(() =>
  props.transaction ? canEditTransaction(props.transaction) : false,
);
const planPayment = computed(() => (props.transaction?.planOccurrenceIds.length ?? 0) > 0);

watch(
  () => props.transaction?.id,
  async (id) => {
    auditEvents.value = [];
    detailsError.value = '';
    if (id === undefined) return;
    try {
      auditEvents.value = await api.listTransactionAudit(props.budgetId, id);
    } catch {
      if (props.transaction?.id === id)
        detailsError.value = 'Не удалось загрузить историю изменений.';
    }
  },
  { immediate: true },
);
</script>

<template>
  <UiDrawer :open="transaction !== null" title="Операция" @close="emit('close')">
    <div v-if="transaction" class="operation-drawer">
      <p class="operation-drawer__amount">
        <FinanceMoney
          :minor-units="transaction.amountMinor"
          :currency="transaction.currency"
          :scale="SCALE"
        />
      </p>
      <p class="operation-drawer__badges">
        <UiStatus :label="statusLabel" tone="neutral" />
        <UiStatus v-if="planPayment" label="По плану" tone="info" />
      </p>

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
      </dl>

      <p v-if="detailsError" class="operation-drawer__error" role="alert">{{ detailsError }}</p>

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
        v-if="editable"
        variant="secondary"
        data-testid="drawer-edit"
        :disabled="busy"
        @click="emit('edit', transaction)"
      >
        Изменить
      </UiButton>
      <UiButton
        v-if="actions.includes('delete')"
        variant="tertiary"
        data-testid="drawer-delete"
        :disabled="busy"
        @click="emit('request-delete', transaction)"
      >
        Удалить
      </UiButton>
      <UiButton
        v-if="actions.includes('restore')"
        variant="secondary"
        data-testid="drawer-restore"
        :disabled="busy"
        @click="emit('request-restore', transaction)"
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

.operation-drawer__badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  margin: 0;
}

.operation-drawer__notice {
  margin: 0;
  padding: var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
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
