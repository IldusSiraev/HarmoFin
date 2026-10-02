<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { ArrowLeft, Search, X } from '@lucide/vue';

import {
  selectableCategories,
  useBudgetReferenceData,
  type CategoryDto,
} from '../../composables/useBudgetReferenceData.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';
import type { EntryType } from '../../composables/useOperationDialogs.js';
import {
  createOperationForm,
  normalizeDecimal,
  toTransactionInput,
  type OneTimePayEntry,
  type OperationFormModel,
} from '../../composables/useOperationForm.js';
import {
  createTransferForm,
  syncSourceEnvelope,
  toCreateTransferInput,
  toDirectTransferInput,
  type TransferFormModel,
} from '../../composables/useTransferForm.js';
import OperationAmountField from '../operations/OperationAmountField.vue';
import UiButton from '../ui/Button.vue';
import UiDatePicker from '../ui/DatePicker.vue';
import UiInfoTooltip from '../ui/InfoTooltip.vue';
import UiInput from '../ui/Input.vue';
import UiModal from '../ui/Modal.vue';
import UiPillSelect from '../ui/PillSelect.vue';

defineOptions({ name: 'AppOperationEntryDialog' });

const props = withDefaults(
  defineProps<{
    open: boolean;
    initialType: EntryType;
    accounts: ReadonlyArray<{ value: string; label: string }>;
    categories: ReadonlyArray<CategoryDto>;
    envelopes: ReadonlyArray<{ value: string; label: string }>;
    /** Envelope Plan v2.2 budget: optional envelope, direct transfers, one-time mandatory payments. */
    modelV2?: boolean;
    mandatoryEnvelopeIds?: ReadonlyArray<string>;
    pending?: boolean;
    error?: string;
  }>(),
  { modelV2: false, mandatoryEnvelopeIds: () => [], pending: false, error: '' },
);

const emit = defineEmits<{
  close: [];
  back: [];
  submitOperation: [input: ReturnType<typeof toTransactionInput>];
  submitTransfer: [input: ReturnType<typeof toCreateTransferInput>];
  submitDirectTransfer: [input: ReturnType<typeof toDirectTransferInput>];
  submitOneTimePay: [input: OneTimePayEntry];
  splitTransfer: [model: TransferFormModel];
}>();

const tabs: ReadonlyArray<{ type: EntryType; label: string; modifier: string }> = [
  { type: 'EXPENSE', label: 'Расход', modifier: 'entry-dialog__tab--expense' },
  { type: 'INCOME', label: 'Доход', modifier: 'entry-dialog__tab--income' },
  { type: 'TRANSFER', label: 'Перевод', modifier: 'entry-dialog__tab--transfer' },
];

const activeType = ref<EntryType>('EXPENSE');
const operation = reactive<OperationFormModel>(createOperationForm());
const transfer = reactive<TransferFormModel>(createTransferForm());
const categorySearch = ref('');
const oneTimeStep = ref(false);
const oneTimeName = ref('');
const oneTimeNameError = ref('');
const popularCategories = ref<ReadonlyArray<{ value: string; label: string }>>([]);

const api = useBudgetReferenceData();
const { budgetId } = useOperationReferenceData();

// The full category list can run to several dozen entries per type, which is
// too many pills to scan at a glance — so by default the picker only shows
// the ones this budget actually uses, and search reaches the rest.
async function loadPopularCategories(type: EntryType): Promise<void> {
  if (type === 'TRANSFER' || !budgetId.value) {
    popularCategories.value = [];
    return;
  }
  try {
    const result = await api.listCategories(budgetId.value, type, 'active', {
      sort: 'popular',
      limit: 15,
    });
    popularCategories.value = selectableCategories(result, props.categories).map((category) => ({
      value: category.id,
      label: category.name,
    }));
  } catch {
    popularCategories.value = [];
  }
}

function selectType(type: EntryType): void {
  activeType.value = type;
  categorySearch.value = '';
  oneTimeStep.value = false;
  void loadPopularCategories(type);
}

// Each open is a fresh entry — the dialog is create-only, so there is no
// existing record to preserve when the type or the whole dialog resets.
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    activeType.value = props.initialType;
    categorySearch.value = '';
    oneTimeStep.value = false;
    Object.assign(operation, createOperationForm(), {
      transactionType: props.initialType === 'INCOME' ? 'INCOME' : 'EXPENSE',
    });
    Object.assign(transfer, createTransferForm());
    void loadPopularCategories(props.initialType);
  },
);

watch(oneTimeName, () => {
  oneTimeNameError.value = '';
});

watch(activeType, (type) => {
  if (type === 'EXPENSE' || type === 'INCOME') operation.transactionType = type;
});

const accent = computed<'danger' | 'success' | 'info'>(() => {
  if (activeType.value === 'EXPENSE') return 'danger';
  if (activeType.value === 'INCOME') return 'success';
  return 'info';
});

const categoryOptions = computed(() =>
  selectableCategories(props.categories)
    .filter(
      (category) => category.categoryType === operation.transactionType && !category.archivedAt,
    )
    .map((category) => ({ value: category.id, label: category.name })),
);

// A budget with only a handful of confirmed operations has just as few
// "popular" categories, which read as a near-empty picker — so below this
// count the rest of the list fills in behind the popular ones instead of
// leaving the picker looking broken.
const CATEGORY_PICKER_TARGET_COUNT = 15;

// No query: popular categories first, padded out with the regular list up to
// the target count, plus whatever is already selected so picking a rarer
// category and closing the search doesn't make its pill disappear. A query
// searches the full list instead.
const visibleCategoryOptions = computed(() => {
  const query = categorySearch.value.trim().toLowerCase();
  if (query) {
    return categoryOptions.value.filter((option) => option.label.toLowerCase().includes(query));
  }

  const seen = new Set<string>();
  const combined: Array<{ value: string; label: string }> = [];
  for (const option of popularCategories.value) {
    if (seen.has(option.value)) continue;
    seen.add(option.value);
    combined.push(option);
  }
  for (const option of categoryOptions.value) {
    if (combined.length >= CATEGORY_PICKER_TARGET_COUNT) break;
    if (seen.has(option.value)) continue;
    seen.add(option.value);
    combined.push(option);
  }
  if (operation.categoryId && !seen.has(operation.categoryId)) {
    const selected = categoryOptions.value.find((option) => option.value === operation.categoryId);
    if (selected) combined.push(selected);
  }
  return combined;
});

const transferSourceOptions = computed(() =>
  props.accounts.filter((account) => account.value !== transfer.destinationAccountId),
);
const transferDestinationOptions = computed(() =>
  props.accounts.filter((account) => account.value !== transfer.sourceAccountId),
);

// v2: an expense does not need an envelope; "" is the explicit "no assignment".
const envelopeOptions = computed(() =>
  props.modelV2 ? [{ value: '', label: 'Без назначения' }, ...props.envelopes] : props.envelopes,
);
const mandatorySelected = computed(
  () =>
    props.modelV2 &&
    activeType.value === 'EXPENSE' &&
    props.mandatoryEnvelopeIds.includes(operation.envelopeId),
);

const canSubmit = computed(() => {
  if (activeType.value === 'TRANSFER') {
    return Boolean(
      transfer.total &&
      transfer.sourceAccountId &&
      transfer.destinationAccountId &&
      (props.modelV2 || transfer.parts[0]?.sourceEnvelopeId),
    );
  }
  if (!operation.amount || !operation.accountId || !operation.categoryId) return false;
  return activeType.value === 'INCOME' || props.modelV2 || Boolean(operation.envelopeId);
});

function submit(): void {
  if (!canSubmit.value || props.pending) return;
  if (activeType.value === 'TRANSFER') {
    if (props.modelV2) emit('submitDirectTransfer', toDirectTransferInput(transfer));
    else emit('submitTransfer', toCreateTransferInput(transfer, 'CONFIRMED'));
    return;
  }
  if (mandatorySelected.value) {
    // A mandatory envelope is only paid against a plan: switch to the short
    // one-time-payment confirmation instead of a plain expense request.
    oneTimeName.value =
      operation.merchantName.trim() ||
      props.categories.find((category) => category.id === operation.categoryId)?.name ||
      '';
    oneTimeNameError.value = '';
    oneTimeStep.value = true;
    void nextTick(() => document.querySelector<HTMLElement>('input[name="oneTimeName"]')?.focus());
    return;
  }
  emit('submitOperation', toTransactionInput(operation, 'CONFIRMED'));
}

function leaveOneTimeStep(): void {
  oneTimeStep.value = false;
  void nextTick(() => document.querySelector<HTMLElement>('[data-testid="entry-submit"]')?.focus());
}

function goBack(): void {
  if (oneTimeStep.value) leaveOneTimeStep();
  else emit('back');
}

function submitOneTime(): void {
  const name = oneTimeName.value.trim();
  if (props.pending) return;
  if (!name) {
    oneTimeNameError.value = 'Укажите название платежа';
    return;
  }
  oneTimeNameError.value = '';
  const comment = operation.merchantName.trim();
  emit('submitOneTimePay', {
    name,
    amount: normalizeDecimal(operation.amount),
    occurredOn: operation.occurredOn,
    accountId: operation.accountId,
    categoryId: operation.categoryId,
    ...(comment ? { comment } : {}),
  });
}

function requestSplit(): void {
  emit('splitTransfer', { ...transfer, parts: transfer.parts.map((part) => ({ ...part })) });
}
</script>

<template>
  <UiModal :open="open" title="Новая операция" @close="emit('close')">
    <template #header>
      <button
        type="button"
        class="entry-dialog__back"
        :aria-label="oneTimeStep ? 'Назад к форме' : 'Назад к выбору типа'"
        @click="goBack"
      >
        <ArrowLeft :size="20" aria-hidden="true" />
      </button>
      <div class="entry-dialog__tabs" role="tablist" aria-label="Тип операции">
        <button
          v-for="tab in tabs"
          :key="tab.type"
          type="button"
          role="tab"
          class="entry-dialog__tab"
          :class="[tab.modifier, { 'entry-dialog__tab--active': activeType === tab.type }]"
          :aria-selected="activeType === tab.type"
          :disabled="oneTimeStep"
          :data-testid="`entry-tab-${tab.type}`"
          @click="selectType(tab.type)"
        >
          {{ tab.label }}
        </button>
      </div>
      <button type="button" class="entry-dialog__close" aria-label="Закрыть" @click="emit('close')">
        <X :size="20" aria-hidden="true" />
      </button>
    </template>

    <p v-if="error" class="entry-dialog__error" role="alert">{{ error }}</p>

    <div v-if="oneTimeStep" class="entry-dialog__body" data-testid="entry-onetime">
      <p class="entry-dialog__hint">
        Обязательные расходы оплачиваются по плану. Добавим разовый платёж на эту сумму и сразу
        оплатим его.
      </p>
      <UiInput
        v-model="oneTimeName"
        name="oneTimeName"
        label="Название платежа"
        autocomplete="off"
        :error="oneTimeNameError"
      />
      <UiButton
        class="entry-dialog__step-button"
        full-width
        data-testid="entry-onetime-confirm"
        :disabled="pending"
        :loading="pending"
        @click="submitOneTime"
      >
        Добавить и оплатить
      </UiButton>
      <UiButton
        class="entry-dialog__step-button"
        variant="tertiary"
        full-width
        data-testid="entry-onetime-back"
        @click="leaveOneTimeStep"
      >
        Изменить
      </UiButton>
    </div>

    <div v-else class="entry-dialog__body">
      <template v-if="activeType !== 'TRANSFER'">
        <OperationAmountField v-model="operation.amount" :accent="accent" />

        <UiPillSelect
          v-model="operation.accountId"
          name="account"
          label="Счёт"
          :options="accounts"
          :accent="accent"
          required
        />
        <div class="entry-dialog__category">
          <UiInput
            v-model="categorySearch"
            name="categorySearch"
            label="Поиск категории"
            hide-label
            placeholder="Поиск категории"
            autocomplete="off"
          >
            <template #icon><Search :size="16" aria-hidden="true" /></template>
          </UiInput>
          <UiPillSelect
            v-model="operation.categoryId"
            name="category"
            label="Категория"
            :options="visibleCategoryOptions"
            :accent="accent"
            required
          />
        </div>
        <UiPillSelect
          v-if="activeType === 'EXPENSE'"
          v-model="operation.envelopeId"
          name="envelope"
          label="Конверт"
          :options="envelopeOptions"
          :accent="accent"
          :required="!modelV2"
        />
        <p v-if="mandatorySelected" class="entry-dialog__hint" data-testid="entry-mandatory-hint">
          Обязательные оплачиваются по плану, а не обычным расходом. Нажмите «Добавить разовый
          платёж и оплатить».
        </p>

        <div class="entry-dialog__row">
          <UiDatePicker
            v-model="operation.occurredOn"
            name="occurredOn"
            label="Дата"
            required
            quick-dates
          />
          <UiInput
            :model-value="
              activeType === 'EXPENSE' ? operation.merchantName : operation.sourceDescription
            "
            name="note"
            label="Заметка"
            placeholder="Необязательно"
            @update:model-value="
              activeType === 'EXPENSE'
                ? (operation.merchantName = $event)
                : (operation.sourceDescription = $event)
            "
          />
        </div>

        <label v-if="activeType === 'INCOME'" class="entry-dialog__check">
          <input v-model="operation.isPlanned" type="checkbox" /> Запланированная операция
          <UiInfoTooltip
            text="Отметьте, если это поступление уже запланированного дохода — например, обычной зарплаты. Нужно только для сравнения плана и факта в отчётах, на баланс и остатки не влияет."
            @click.stop
          />
        </label>
      </template>

      <template v-else>
        <OperationAmountField v-model="transfer.total" accent="info" />

        <UiPillSelect
          v-model="transfer.sourceAccountId"
          name="transferSource"
          label="Откуда"
          :options="transferSourceOptions"
          accent="info"
          required
        />
        <UiPillSelect
          v-model="transfer.destinationAccountId"
          name="transferDestination"
          label="Куда"
          :options="transferDestinationOptions"
          accent="info"
          required
        />
        <UiPillSelect
          v-if="!modelV2"
          name="transferEnvelope"
          label="Конверт"
          :options="envelopes"
          :model-value="transfer.parts[0]?.sourceEnvelopeId ?? ''"
          accent="info"
          required
          @update:model-value="transfer.parts[0] && syncSourceEnvelope(transfer.parts[0], $event)"
        />

        <div class="entry-dialog__row">
          <UiDatePicker
            v-model="transfer.occurredOn"
            name="transferOccurredOn"
            label="Дата"
            required
            quick-dates
          />
          <UiInput
            v-if="!modelV2"
            v-model="transfer.comment"
            name="transferComment"
            label="Заметка"
            placeholder="Необязательно"
          />
        </div>

        <div v-if="!modelV2" class="entry-dialog__split-row">
          <button
            type="button"
            class="entry-dialog__split"
            data-testid="entry-split-transfer"
            @click="requestSplit"
          >
            Разбить перевод на несколько конвертов
          </button>
          <UiInfoTooltip
            text="Нужно только если этим переводом вы одновременно двигаете деньги нескольких разных конвертов — например, часть на «Автомобиль», часть на «Отпуск». Для обычного перевода это не требуется."
          />
        </div>
      </template>
    </div>

    <UiButton
      v-if="!oneTimeStep"
      class="entry-dialog__submit"
      full-width
      data-testid="entry-submit"
      :disabled="!canSubmit || pending"
      :loading="pending"
      @click="submit"
    >
      {{ mandatorySelected ? 'Добавить разовый платёж и оплатить' : 'Сохранить операцию' }}
    </UiButton>
  </UiModal>
</template>

<style scoped>
.entry-dialog__back,
.entry-dialog__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  flex-shrink: 0;
  border: none;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text-muted);
  cursor: pointer;
}

.entry-dialog__back:hover,
.entry-dialog__close:hover {
  background: var(--hf-color-action-secondary-hover);
  color: var(--hf-color-text);
}

.entry-dialog__tabs {
  display: flex;
  flex: 1;
  justify-content: center;
  gap: var(--hf-space-1);
}

.entry-dialog__tab {
  min-height: 2.25rem;
  padding: 0 var(--hf-space-3);
  border: none;
  border-radius: var(--hf-radius-xl);
  background: transparent;
  color: var(--hf-color-text-muted);
  font: inherit;
  font-weight: var(--hf-font-weight-medium);
  cursor: pointer;
}

.entry-dialog__tab:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.entry-dialog__tab--expense.entry-dialog__tab--active {
  background: var(--hf-color-status-danger-background);
  color: var(--hf-color-status-danger);
}

.entry-dialog__tab--income.entry-dialog__tab--active {
  background: var(--hf-color-status-success-background);
  color: var(--hf-color-status-success);
}

.entry-dialog__tab--transfer.entry-dialog__tab--active {
  background: var(--hf-color-status-info-background);
  color: var(--hf-color-status-info);
}

.entry-dialog__body {
  display: grid;
  gap: var(--hf-space-5);
  margin-bottom: var(--hf-space-5);
}

.entry-dialog__category {
  display: grid;
  gap: var(--hf-space-3);
}

.entry-dialog__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: start;
  gap: var(--hf-space-3);
}

@media (max-width: 30rem) {
  .entry-dialog__row {
    grid-template-columns: 1fr;
  }
}

.entry-dialog__check {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.entry-dialog__split-row {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  justify-self: start;
}

.entry-dialog__split {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--hf-color-action-primary);
  font: inherit;
  font-weight: var(--hf-font-weight-medium);
  text-decoration: underline;
  cursor: pointer;
}

.entry-dialog__step-button {
  min-width: 2.75rem;
  min-height: 2.75rem;
}

.entry-dialog__hint {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.entry-dialog__error {
  margin: 0 0 var(--hf-space-4);
  color: var(--hf-color-text-danger);
}
</style>
