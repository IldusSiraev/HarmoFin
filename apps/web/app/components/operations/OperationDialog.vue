<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { auditActionLabel, auditActorName, formatAuditMoment } from './audit-event.js';
import { authorLabel } from './author-label.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiButton from '../ui/Button.vue';
import UiModal from '../ui/Modal.vue';
import UiStatus from '../ui/Status.vue';
import {
  useBudgetReferenceData,
  type AuditEventDto,
} from '../../composables/useBudgetReferenceData.js';
import type { TransactionJournalV2Item } from '../../composables/useEnvelopePlanV2.js';
import { availableActions, canEditTransaction } from '../../composables/useOperationMutations.js';
import { usePermissions } from '../../composables/usePermissions.js';
import { formatPlainDate } from '../obligations/format-plain-date.js';

defineOptions({ name: 'OperationDialog' });

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
// Editing, deleting and restoring an operation need OWNER or EDITOR on the server.
const { canWrite } = usePermissions();

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
// A viewer has no footer action at all; an empty padded footer bar would be
// worse than no footer.
const hasFooterActions = computed(
  () => canWrite.value && (editable.value || actions.value.length > 0),
);

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
  <UiModal :open="transaction !== null" title="Операция" size="sm" @close="emit('close')">
    <div v-if="transaction" class="operation-dialog">
      <p class="operation-dialog__amount">
        <FinanceMoney
          :minor-units="transaction.amountMinor"
          :currency="transaction.currency"
          :scale="SCALE"
        />
      </p>
      <p class="operation-dialog__badges">
        <UiStatus :label="statusLabel" tone="neutral" />
        <UiStatus v-if="planPayment" label="По плану" tone="info" />
      </p>
      <p v-if="transaction.createdBy" class="operation-dialog__author">
        Автор: {{ authorLabel(transaction.createdBy) }}
      </p>

      <dl class="operation-dialog__rows">
        <div>
          <dt>Дата</dt>
          <dd>{{ formatPlainDate(transaction.occurredOn) }}</dd>
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

      <p v-if="detailsError" class="operation-dialog__error" role="alert">{{ detailsError }}</p>

      <section aria-labelledby="operation-dialog-audit">
        <h3 id="operation-dialog-audit">История изменений</h3>
        <ol v-if="auditEvents.length > 0" class="operation-dialog__history">
          <li
            v-for="event in auditEvents"
            :key="event.id"
            data-testid="operation-dialog-audit-event"
          >
            <span class="operation-dialog__history-action">{{
              auditActionLabel(event.action)
            }}</span>
            <span class="operation-dialog__history-meta">
              {{ formatAuditMoment(event.createdAt) }} · {{ auditActorName(event) }}
            </span>
          </li>
        </ol>
        <p v-else>История пуста.</p>
      </section>
    </div>

    <template v-if="transaction && hasFooterActions" #footer>
      <UiButton
        v-if="editable && canWrite"
        variant="secondary"
        data-testid="operation-dialog-edit"
        :disabled="busy"
        @click="emit('edit', transaction)"
      >
        Изменить
      </UiButton>
      <UiButton
        v-if="actions.includes('delete') && canWrite"
        variant="tertiary"
        data-testid="operation-dialog-delete"
        :disabled="busy"
        @click="emit('request-delete', transaction)"
      >
        Удалить
      </UiButton>
      <UiButton
        v-if="actions.includes('restore') && canWrite"
        variant="secondary"
        data-testid="operation-dialog-restore"
        :disabled="busy"
        @click="emit('request-restore', transaction)"
      >
        Восстановить
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.operation-dialog {
  display: grid;
  gap: var(--hf-space-4);
}

.operation-dialog__amount {
  margin: 0;
  font-size: var(--hf-font-size-h2);
  font-weight: var(--hf-font-weight-bold);
  line-height: var(--hf-line-height-h2);
}

.operation-dialog__rows {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
}

.operation-dialog__rows div {
  display: flex;
  gap: var(--hf-space-3);
  justify-content: space-between;
}

.operation-dialog__rows dt {
  color: var(--hf-color-text-muted);
}

.operation-dialog__rows dd {
  margin: 0;
  text-align: right;
}

.operation-dialog__badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  margin: 0;
}

.operation-dialog__notice {
  margin: 0;
  padding: var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
}

.operation-dialog__history {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.operation-dialog__history li {
  display: grid;
  gap: 0.125rem;
}

.operation-dialog__history-action {
  font-weight: var(--hf-font-weight-medium);
}

.operation-dialog__history-meta {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.operation-dialog__error {
  margin: 0;
  color: var(--hf-color-text-danger);
}

.operation-dialog__author {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
</style>
