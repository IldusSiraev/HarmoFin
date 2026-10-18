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
  toDirectTransferInput,
  type TransferFormModel,
} from '../../composables/useTransferForm.js';
import OperationAmountField from '../operations/OperationAmountField.vue';
import UiButton from '../ui/Button.vue';
import UiDatePicker from '../ui/DatePicker.vue';
import UiInfoTooltip from '../ui/InfoTooltip.vue';
import UiInput from '../ui/Input.vue';
import UiModal from '../ui/Modal.vue';
import UiPillSelect, { type PillOption } from '../ui/PillSelect.vue';
import { categoryIcon } from '../operations/category-icon.js';

defineOptions({ name: 'AppOperationEntryDialog' });

const props = withDefaults(
  defineProps<{
    open: boolean;
    initialType: EntryType;
    accounts: ReadonlyArray<PillOption>;
    categories: ReadonlyArray<CategoryDto>;
    envelopes: ReadonlyArray<{ value: string; label: string }>;
    mandatoryEnvelopeIds?: ReadonlyArray<string>;
    /** Envelopes whose period is running today, per the server. */
    currentPeriodEnvelopeIds?: ReadonlyArray<string>;
    pending?: boolean;
    error?: string;
  }>(),
  {
    mandatoryEnvelopeIds: () => [],
    currentPeriodEnvelopeIds: () => [],
    pending: false,
    error: '',
  },
);

const emit = defineEmits<{
  close: [];
  back: [];
  submitOperation: [input: ReturnType<typeof toTransactionInput>, addAnother: boolean];
  submitDirectTransfer: [input: ReturnType<typeof toDirectTransferInput>];
  submitOneTimePay: [input: OneTimePayEntry];
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
const popularCategories = ref<ReadonlyArray<PillOption>>([]);

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
    popularCategories.value = selectableCategories(result, props.categories).map(toCategoryOption);
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

function toCategoryOption(category: CategoryDto): PillOption {
  return {
    value: category.id,
    label: category.name,
    icon: categoryIcon(category.icon, category.categoryType),
  };
}

// The envelope of the period running today is the usual target of an expense,
// so it is preselected — but only when exactly one envelope qualifies.
const defaultEnvelopeId = computed(() =>
  props.currentPeriodEnvelopeIds.length === 1 ? props.currentPeriodEnvelopeIds[0]! : '',
);

// The modal moves focus to itself on the next tick; the amount field takes it
// one tick later so the user can type the sum straight away.
async function focusAmount(): Promise<void> {
  await nextTick();
  await nextTick();
  document.querySelector<HTMLElement>('input[name="amount"]')?.focus();
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
      envelopeId: defaultEnvelopeId.value,
    });
    Object.assign(transfer, createTransferForm());
    void loadPopularCategories(props.initialType);
    if (props.initialType !== 'TRANSFER') void focusAmount();
  },
);

// Reference data may arrive after the dialog opened; fill the default in then
// unless an envelope is already chosen.
watch(defaultEnvelopeId, (id) => {
  if (props.open && operation.envelopeId === '') operation.envelopeId = id;
});

// After "save and add another": the same account, date and envelope usually
// repeat in a batch of receipts, so only the per-receipt fields are cleared.
function startNext(): void {
  operation.amount = '';
  operation.categoryId = '';
  operation.merchantName = '';
  operation.sourceDescription = '';
  categorySearch.value = '';
  void focusAmount();
}

defineExpose({ startNext });

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
    .map(toCategoryOption),
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
  const combined: PillOption[] = [];
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

// An expense does not need an envelope; "" is the explicit "no assignment".
const envelopeOptions = computed<PillOption[]>(() => [
  { value: '', label: 'Без конверта' },
  ...props.envelopes.map((envelope) => ({
    ...envelope,
    marker: props.currentPeriodEnvelopeIds.includes(envelope.value) ? 'текущий период' : undefined,
  })),
]);
const mandatorySelected = computed(
  () => activeType.value === 'EXPENSE' && props.mandatoryEnvelopeIds.includes(operation.envelopeId),
);

const canSubmit = computed(() => {
  if (activeType.value === 'TRANSFER') {
    return Boolean(transfer.total && transfer.sourceAccountId && transfer.destinationAccountId);
  }
  return Boolean(operation.amount && operation.accountId && operation.categoryId);
});

// Only a plain expense offers "save and add another": an income opens the
// funding offer afterwards, and a mandatory envelope goes through its own step.
const canAddAnother = computed(() => activeType.value === 'EXPENSE' && !mandatorySelected.value);

// Which button started the save, so only that one shows the spinner.
const addingAnother = ref(false);

function submit(addAnother = false): void {
  if (!canSubmit.value || props.pending) return;
  addingAnother.value = addAnother && canAddAnother.value;
  if (activeType.value === 'TRANSFER') {
    emit('submitDirectTransfer', toDirectTransferInput(transfer));
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
  emit('submitOperation', toTransactionInput(operation, 'CONFIRMED'), addingAnother.value);
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
        <div class="entry-dialog__row">
          <UiDatePicker
            v-model="transfer.occurredOn"
            name="transferOccurredOn"
            label="Дата"
            required
            quick-dates
          />
        </div>
      </template>
    </div>

    <div
      v-if="!oneTimeStep"
      class="entry-dialog__actions"
      :class="{ 'entry-dialog__actions--pair': canAddAnother }"
    >
      <UiButton
        v-if="canAddAnother"
        class="entry-dialog__submit-next"
        variant="secondary"
        full-width
        data-testid="entry-submit-next"
        :disabled="!canSubmit || pending"
        :loading="pending && addingAnother"
        @click="submit(true)"
      >
        Сохранить и добавить ещё
      </UiButton>
      <UiButton
        class="entry-dialog__submit"
        full-width
        data-testid="entry-submit"
        :disabled="!canSubmit || pending"
        :loading="pending && !addingAnother"
        @click="submit()"
      >
        {{ mandatorySelected ? 'Добавить разовый платёж и оплатить' : 'Сохранить операцию' }}
      </UiButton>
    </div>
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

.entry-dialog__step-button {
  min-width: 2.75rem;
  min-height: 2.75rem;
}

.entry-dialog__actions {
  display: grid;
  gap: var(--hf-space-3);
}

/* Side by side, the primary save on the right; stacked on a phone, the
   primary save comes first. */
.entry-dialog__actions--pair {
  grid-template-columns: 1fr 1fr;
}

@media (max-width: 30rem) {
  .entry-dialog__actions--pair {
    grid-template-columns: 1fr;
  }

  .entry-dialog__submit {
    order: -1;
  }
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
