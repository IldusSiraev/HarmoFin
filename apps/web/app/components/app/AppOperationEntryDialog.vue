<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
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
  toTransactionInput,
  type OperationFormModel,
} from '../../composables/useOperationForm.js';
import {
  createTransferForm,
  syncSourceEnvelope,
  toCreateTransferInput,
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
    pending?: boolean;
    error?: string;
  }>(),
  { pending: false, error: '' },
);

const emit = defineEmits<{
  close: [];
  back: [];
  submitOperation: [input: ReturnType<typeof toTransactionInput>];
  submitTransfer: [input: ReturnType<typeof toCreateTransferInput>];
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
    Object.assign(operation, createOperationForm(), {
      transactionType: props.initialType === 'INCOME' ? 'INCOME' : 'EXPENSE',
    });
    Object.assign(transfer, createTransferForm());
    void loadPopularCategories(props.initialType);
  },
);

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

const canSubmit = computed(() => {
  if (activeType.value === 'TRANSFER') {
    return Boolean(
      transfer.total &&
      transfer.sourceAccountId &&
      transfer.destinationAccountId &&
      transfer.parts[0]?.sourceEnvelopeId,
    );
  }
  if (!operation.amount || !operation.accountId || !operation.categoryId) return false;
  return activeType.value === 'INCOME' || Boolean(operation.envelopeId);
});

function submit(): void {
  if (!canSubmit.value) return;
  if (activeType.value === 'TRANSFER') {
    emit('submitTransfer', toCreateTransferInput(transfer, 'CONFIRMED'));
    return;
  }
  emit('submitOperation', toTransactionInput(operation, 'CONFIRMED'));
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
        aria-label="Назад к выбору типа"
        @click="emit('back')"
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

    <div class="entry-dialog__body">
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
          :options="envelopes"
          :accent="accent"
          required
        />

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
            v-model="transfer.comment"
            name="transferComment"
            label="Заметка"
            placeholder="Необязательно"
          />
        </div>

        <div class="entry-dialog__split-row">
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
      class="entry-dialog__submit"
      full-width
      data-testid="entry-submit"
      :disabled="!canSubmit || pending"
      :loading="pending"
      @click="submit"
    >
      Сохранить операцию
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

.entry-dialog__error {
  margin: 0 0 var(--hf-space-4);
  color: var(--hf-color-text-danger);
}
</style>
