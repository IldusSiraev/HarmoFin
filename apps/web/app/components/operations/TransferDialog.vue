<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import DirectTransferForm from '../transfers/DirectTransferForm.vue';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiButton from '../ui/Button.vue';
import UiConfirmDialog from '../ui/ConfirmDialog.vue';
import UiModal from '../ui/Modal.vue';
import UiStatus from '../ui/Status.vue';
import { ApiRequestError } from '../../composables/useApiClient.js';
import type {
  CreateDirectTransferRequest,
  TransferJournalItem,
} from '../../composables/useEnvelopePlanV2.js';
import {
  toTransferPatch,
  transferFormFrom,
  type TransferFormModel,
} from '../../composables/useTransferForm.js';
import { useTransferMutations } from '../../composables/useTransferMutations.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import { formatPlainDate } from '../obligations/format-plain-date.js';

defineOptions({ name: 'TransferDialog' });

// The row menu opens the dialog straight on its action: the edit form or the
// confirmation, without the detail card in between.
export type TransferDialogIntent = 'view' | 'edit' | 'delete' | 'restore';

const props = withDefaults(
  defineProps<{
    transfer: TransferJournalItem | null;
    budgetId: string;
    accounts: ReadonlyArray<{ value: string; label: string }>;
    accountNames: ReadonlyMap<string, string>;
    canRestore: boolean;
    intent?: TransferDialogIntent;
  }>(),
  { intent: 'view' },
);

const emit = defineEmits<{ close: []; changed: [] }>();

const SCALE = 2;
const mutations = useTransferMutations();
const editing = ref(false);
const form = ref<TransferFormModel | null>(null);
const formErrors = ref<Partial<Record<string, string>>>({});
const formError = ref('');
const confirming = ref<null | 'delete' | 'restore'>(null);
// True when the row menu skipped the detail card: leaving the form or the
// confirmation then closes everything instead of revealing the card.
const direct = ref(false);

watch(
  () => [props.transfer?.id, props.intent] as const,
  () => {
    editing.value = false;
    confirming.value = null;
    // Restore stays owner-only here too, whatever the caller asked for.
    const intent = props.intent === 'restore' && !props.canRestore ? 'view' : props.intent;
    direct.value = props.transfer !== null && intent !== 'view';
    if (!props.transfer) return;
    if (intent === 'edit') startEdit();
    else if (intent === 'delete' || intent === 'restore') confirming.value = intent;
  },
  { immediate: true },
);

function closeEdit(): void {
  editing.value = false;
  if (direct.value) emit('close');
}

function cancelConfirm(): void {
  confirming.value = null;
  if (direct.value) emit('close');
}

const deleted = computed(() => props.transfer?.status === 'DELETED');

function name(accountId: string): string {
  return props.accountNames.get(accountId) ?? 'Счёт';
}

const confirmCopy = computed(() =>
  confirming.value === 'restore'
    ? {
        title: 'Восстановить перевод?',
        description: 'Перевод снова начнёт влиять на балансы счетов.',
      }
    : {
        title: 'Удалить перевод?',
        description: 'Перевод останется в истории, но перестанет влиять на балансы счетов.',
      },
);

function startEdit(): void {
  if (!props.transfer) return;
  form.value = transferFormFrom(props.transfer);
  formErrors.value = {};
  formError.value = '';
  editing.value = true;
}

async function save(input: CreateDirectTransferRequest): Promise<void> {
  const current = props.transfer;
  if (!current) return;
  const patch = toTransferPatch(current, {
    total: input.amount,
    occurredOn: input.occurredOn,
    sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,
    comment: input.comment ?? '',
  });
  if (Object.keys(patch).length === 0) {
    closeEdit();
    return;
  }
  try {
    await mutations.update(props.budgetId, current.id, patch);
    editing.value = false;
    emit('changed');
  } catch (exception) {
    formErrors.value =
      exception instanceof ApiRequestError
        ? Object.fromEntries((exception.problem.fieldErrors ?? []).map((f) => [f.field, f.message]))
        : {};
    formError.value = v2ErrorMessage(
      exception,
      'Не удалось сохранить перевод. Повторите попытку.',
      {
        INSUFFICIENT_BALANCE: 'На счёте недостаточно средств для этого изменения.',
      },
    );
  }
}

async function confirm(): Promise<void> {
  const current = props.transfer;
  const action = confirming.value;
  confirming.value = null;
  if (!current || !action) return;
  const result =
    action === 'delete'
      ? await mutations.remove(props.budgetId, current)
      : await mutations.restore(props.budgetId, current);
  if (result) emit('changed');
  // A failure is already explained by a toast; from the menu there is no card to return to.
  else if (direct.value) emit('close');
}
</script>

<template>
  <UiModal
    :open="transfer !== null && !editing && !direct"
    title="Перевод"
    size="sm"
    @close="emit('close')"
  >
    <div v-if="transfer" class="transfer-dialog">
      <p class="transfer-dialog__amount">
        <FinanceMoney
          :minor-units="transfer.amountMinor"
          :currency="transfer.currency"
          :scale="SCALE"
        />
      </p>
      <p v-if="deleted"><UiStatus label="Удалён" tone="danger" /></p>
      <dl class="transfer-dialog__rows">
        <div>
          <dt>Дата</dt>
          <dd>{{ formatPlainDate(transfer.occurredOn) }}</dd>
        </div>
        <div>
          <dt>Со счёта</dt>
          <dd>{{ name(transfer.sourceAccountId) }}</dd>
        </div>
        <div>
          <dt>На счёт</dt>
          <dd>{{ name(transfer.destinationAccountId) }}</dd>
        </div>
        <div v-if="transfer.comment">
          <dt>Комментарий</dt>
          <dd>{{ transfer.comment }}</dd>
        </div>
      </dl>
    </div>

    <template v-if="transfer" #footer>
      <UiButton
        v-if="!deleted"
        variant="secondary"
        data-testid="transfer-dialog-edit"
        :disabled="mutations.pending.value"
        @click="startEdit"
      >
        Изменить
      </UiButton>
      <UiButton
        v-if="!deleted"
        variant="tertiary"
        data-testid="transfer-dialog-delete"
        :disabled="mutations.pending.value"
        @click="confirming = 'delete'"
      >
        Удалить
      </UiButton>
      <UiButton
        v-if="deleted && canRestore"
        variant="secondary"
        data-testid="transfer-dialog-restore"
        :disabled="mutations.pending.value"
        @click="confirming = 'restore'"
      >
        Восстановить
      </UiButton>
    </template>
  </UiModal>

  <UiModal :open="editing" title="Изменить перевод" @close="closeEdit">
    <p v-if="formError" class="transfer-dialog__error" role="alert">{{ formError }}</p>
    <DirectTransferForm
      v-if="form"
      :model="form"
      :accounts="accounts"
      :errors="formErrors"
      :pending="mutations.pending.value"
      submit-label="Сохранить изменения"
      @submit="save"
    />
  </UiModal>

  <UiConfirmDialog
    :open="confirming !== null"
    :title="confirmCopy.title"
    :description="confirmCopy.description"
    confirm-label="Подтвердить"
    cancel-label="Отмена"
    :variant="confirming === 'delete' ? 'danger' : 'primary'"
    :loading="mutations.pending.value"
    @confirm="confirm"
    @cancel="cancelConfirm"
  />
</template>

<style scoped>
.transfer-dialog {
  display: grid;
  gap: var(--hf-space-4);
}

.transfer-dialog__amount {
  margin: 0;
  font-size: var(--hf-font-size-h2);
  font-weight: var(--hf-font-weight-bold);
  line-height: var(--hf-line-height-h2);
}

.transfer-dialog__rows {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
}

.transfer-dialog__rows > div {
  display: flex;
  justify-content: space-between;
  gap: var(--hf-space-3);
}

.transfer-dialog__rows dt {
  color: var(--hf-color-text-muted);
}

.transfer-dialog__rows dd {
  margin: 0;
  text-align: right;
}

.transfer-dialog__error {
  margin: 0 0 var(--hf-space-4);
  color: var(--hf-color-text-danger);
}
</style>
