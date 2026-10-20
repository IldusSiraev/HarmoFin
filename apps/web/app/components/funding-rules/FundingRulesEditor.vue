<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { AlertTriangle, ArrowDown } from '@lucide/vue';

import UiButton from '../ui/Button.vue';
import UiEmptyState from '../ui/EmptyState.vue';
import UiInfoTooltip from '../ui/InfoTooltip.vue';
import UiSkeleton from '../ui/Skeleton.vue';
import { ApiRequestError } from '../../composables/useApiClient.js';
import { useBudgetReferenceData } from '../../composables/useBudgetReferenceData.js';
import {
  type EnvelopePlanDto,
  type FundingRuleType,
  type PutFundingRulesBatchRequest,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
import { useSortableList } from '../../composables/useSortableList.js';
import { useToast } from '../../composables/useToast.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import FundingRuleCard from './FundingRuleCard.vue';
import { OUTSIDE_HINT, QUEUE_HINT, SUGGESTION_HINT } from './funding-rule-text.js';
import {
  type CardErrors,
  type EditorState,
  type SuggestionErrors,
  buildRequest,
  buildState,
  mapServerErrors,
  move,
  setType,
  snapshotOf,
  updateCard,
} from './rules-editor-state.js';

defineOptions({ name: 'FundingRulesEditor' });

// The whole budget's funding rules on one screen. Reads envelopes, rules, the
// budget's income suggestion and income categories; saves everything with one
// batch request. The order of the queue is what the server uses to distribute
// income. Rules are settings: saving never moves money.

const props = defineProps<{ budgetId: string }>();
const emit = defineEmits<{ dirty: [value: boolean] }>();

const v2 = useEnvelopePlanV2();
const reference = useBudgetReferenceData();
const { push } = useToast();

const loading = ref(true);
const loadError = ref('');
const envelopes = ref<EnvelopePlanDto[]>([]);
const categories = ref<Array<{ id: string; name: string }>>([]);
const state = ref<EditorState | null>(null);
const initial = ref('');
const cardErrors = ref<CardErrors>({});
const suggestionErrors = ref<SuggestionErrors>({});
const formError = ref('');
const saving = ref(false);
const announcement = ref('');
const queueList = ref<HTMLElement | null>(null);

const dirty = computed(() => state.value !== null && snapshotOf(state.value) !== initial.value);
watch(dirty, (value) => emit('dirty', value));

const incomeLabel = computed(() => {
  const suggestion = state.value?.suggestion;
  if (!suggestion?.enabled || suggestion.targetEnvelopeId === '') return null;
  const category = categories.value.find((item) => item.id === suggestion.sourceCategoryId);
  return category
    ? { envelopeId: suggestion.targetEnvelopeId, text: `Доход: ${category.name}` }
    : null;
});
const labelFor = (envelopeId: string) =>
  incomeLabel.value?.envelopeId === envelopeId ? incomeLabel.value.text : null;
const allCards = computed(() =>
  state.value ? [...state.value.queue, ...state.value.outside] : [],
);

function apply(next: EditorState): void {
  state.value = next;
  initial.value = snapshotOf(next);
  cardErrors.value = {};
  suggestionErrors.value = {};
  formError.value = '';
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const [envelopeList, rules, budget, incomeCategories] = await Promise.all([
      v2.listEnvelopes(props.budgetId),
      v2.listFundingRules(props.budgetId),
      reference.getBudget(props.budgetId),
      reference.listCategories(props.budgetId, 'INCOME', 'active'),
    ]);
    envelopes.value = envelopeList.items;
    categories.value = incomeCategories.map((item) => ({ id: item.id, name: item.name }));
    apply(
      buildState(envelopeList.items, rules.items, {
        enabled: budget.incomeAllocationRuleEnabled,
        sourceCategoryId: budget.incomeAllocationSourceCategoryId,
        targetEnvelopeId: budget.incomeAllocationTargetEnvelopeId,
      }),
    );
  } catch (error) {
    loadError.value = v2ErrorMessage(error, 'Не удалось загрузить правила. Повторите попытку.');
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function reset(): void {
  if (!state.value || saving.value) return;
  apply(JSON.parse(initial.value) as EditorState);
}

// While a save is in flight the page is read-only: the answer replaces the state.
function onType(envelopeId: string, type: FundingRuleType | ''): void {
  if (!state.value || saving.value) return;
  state.value = setType(state.value, envelopeId, type);
  delete cardErrors.value[envelopeId];
}
function onFixed(envelopeId: string, fixed: string): void {
  if (state.value && !saving.value) state.value = updateCard(state.value, envelopeId, { fixed });
}
function onPercent(envelopeId: string, percent: string): void {
  if (state.value && !saving.value) state.value = updateCard(state.value, envelopeId, { percent });
}

function announce(index: number): void {
  const queue = state.value?.queue ?? [];
  const card = queue[index];
  if (card) announcement.value = `${card.name}: позиция ${index + 1} из ${queue.length}`;
}

function moveBy(index: number, delta: -1 | 1): void {
  if (!state.value || saving.value) return;
  const to = index + delta;
  const card = state.value.queue[index];
  const next = move(state.value, index, to);
  if (next === state.value || !card) return;
  state.value = next;
  announce(to);
  void nextTick(() => {
    const atEdge = to === 0 || to === next.queue.length - 1;
    const direction = atEdge ? (delta < 0 ? 'down' : 'up') : delta < 0 ? 'up' : 'down';
    document
      .querySelector<HTMLElement>(`[data-testid="rule-${direction}-${card.envelopeId}"]`)
      ?.focus();
  });
}

const sortable = useSortableList({
  container: queueList,
  itemSelector: '[data-queue-item]',
  onMove: (from, to) => {
    if (state.value && !saving.value) state.value = move(state.value, from, to);
  },
  onDrop: announce,
});

function startDrag(event: PointerEvent, index: number): void {
  if (!saving.value) sortable.startDrag(event, index);
}

function setSuggestion(patch: Partial<EditorState['suggestion']>): void {
  if (!state.value || saving.value) return;
  state.value = { ...state.value, suggestion: { ...state.value.suggestion, ...patch } };
  suggestionErrors.value = {};
}

// One Idempotency-Key per distinct attempt; the same body retried keeps it.
let attempt: { fingerprint: string; key: string } | null = null;
function attemptKey(body: PutFundingRulesBatchRequest): string {
  const fingerprint = JSON.stringify(body);
  if (attempt?.fingerprint !== fingerprint) attempt = { fingerprint, key: crypto.randomUUID() };
  return attempt.key;
}

function focusFirstInvalid(): void {
  void nextTick(() => {
    document.querySelector<HTMLElement>('.rules-editor [aria-invalid="true"]')?.focus();
  });
}

async function save(): Promise<void> {
  if (!state.value || saving.value || !dirty.value) return;
  formError.value = '';
  const result = buildRequest(state.value);
  cardErrors.value = result.cardErrors;
  suggestionErrors.value = result.suggestionErrors;
  if (!result.body) {
    focusFirstInvalid();
    return;
  }
  saving.value = true;
  try {
    const response = await v2.saveFundingRules(
      props.budgetId,
      result.body,
      attemptKey(result.body),
    );
    attempt = null;
    apply(buildState(envelopes.value, response.items, response.incomeSuggestion));
    push({
      tone: 'success',
      title: 'Правила сохранены',
      description: 'Распределения и остатки не изменились.',
    });
  } catch (error) {
    const mapped =
      error instanceof ApiRequestError
        ? mapServerErrors(result.body, error.problem.fieldErrors ?? [])
        : null;
    if (mapped?.matched) {
      cardErrors.value = mapped.cardErrors;
      suggestionErrors.value = mapped.suggestionErrors;
      focusFirstInvalid();
    } else {
      formError.value = v2ErrorMessage(
        error,
        'Не удалось сохранить правила. Повторите попытку: дубль не создастся.',
      );
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="rules-editor">
    <UiEmptyState v-if="loadError" title="Правила недоступны" :description="loadError">
      <template #action>
        <UiButton data-testid="rules-retry" @click="load">Повторить</UiButton>
      </template>
    </UiEmptyState>
    <div v-else-if="loading && !state" aria-busy="true">
      <UiSkeleton variant="row" :count="4" />
    </div>

    <template v-else-if="state">
      <section class="rules-editor__block" aria-labelledby="suggestion-title">
        <h2 id="suggestion-title" class="rules-editor__title">
          Предложение для дохода
          <UiInfoTooltip :text="SUGGESTION_HINT" label="Подсказка: предложение для дохода" />
        </h2>
        <label class="rules-editor__switch">
          <input
            type="checkbox"
            role="switch"
            data-testid="suggestion-enabled"
            :disabled="saving"
            :checked="state.suggestion.enabled"
            @change="setSuggestion({ enabled: ($event.target as HTMLInputElement).checked })"
          />
          Включено
        </label>
        <div class="rules-editor__suggestion">
          <label class="rules-editor__field">
            <span>Доход категории</span>
            <select
              class="rules-editor__input"
              data-testid="suggestion-category"
              :disabled="saving || !state.suggestion.enabled"
              :value="state.suggestion.sourceCategoryId"
              :aria-invalid="suggestionErrors.sourceCategoryId ? 'true' : undefined"
              :aria-describedby="
                suggestionErrors.sourceCategoryId ? 'suggestion-category-error' : undefined
              "
              @change="
                setSuggestion({ sourceCategoryId: ($event.target as HTMLSelectElement).value })
              "
            >
              <option value="">Не выбрана</option>
              <option v-for="item in categories" :key="item.id" :value="item.id">
                {{ item.name }}
              </option>
            </select>
          </label>
          <label class="rules-editor__field">
            <span>предлагать в конверт</span>
            <select
              class="rules-editor__input"
              data-testid="suggestion-envelope"
              :disabled="saving || !state.suggestion.enabled"
              :value="state.suggestion.targetEnvelopeId"
              :aria-invalid="suggestionErrors.targetEnvelopeId ? 'true' : undefined"
              :aria-describedby="
                suggestionErrors.targetEnvelopeId ? 'suggestion-envelope-error' : undefined
              "
              @change="
                setSuggestion({ targetEnvelopeId: ($event.target as HTMLSelectElement).value })
              "
            >
              <option value="">Не выбран</option>
              <option v-for="card in allCards" :key="card.envelopeId" :value="card.envelopeId">
                {{ card.name }}
              </option>
            </select>
          </label>
        </div>
        <p
          v-if="suggestionErrors.sourceCategoryId"
          id="suggestion-category-error"
          class="rules-editor__error"
        >
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ suggestionErrors.sourceCategoryId }}
        </p>
        <p
          v-if="suggestionErrors.targetEnvelopeId"
          id="suggestion-envelope-error"
          class="rules-editor__error"
        >
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ suggestionErrors.targetEnvelopeId }}
        </p>
      </section>

      <section class="rules-editor__block" aria-labelledby="queue-title">
        <h2 id="queue-title" class="rules-editor__title">
          Очередь распределения
          <UiInfoTooltip :text="QUEUE_HINT" label="Подсказка: очередь распределения" />
        </h2>
        <p v-if="state.queue.length === 0" class="rules-editor__muted">
          В очереди пока нет конвертов: выберите тип правила у конверта ниже.
        </p>
        <ol ref="queueList" class="rules-editor__queue" data-testid="rules-queue">
          <li
            v-for="(card, index) in state.queue"
            :key="card.envelopeId"
            class="rules-editor__item"
            data-queue-item
            :data-envelope-id="card.envelopeId"
          >
            <FundingRuleCard
              :card="card"
              :position="index + 1"
              :income-label="labelFor(card.envelopeId)"
              :errors="cardErrors[card.envelopeId] ?? {}"
              :can-move-up="index > 0"
              :can-move-down="index < state.queue.length - 1"
              :dragging="sortable.draggingIndex.value === index"
              :disabled="saving"
              @type="onType(card.envelopeId, $event)"
              @fixed="onFixed(card.envelopeId, $event)"
              @percent="onPercent(card.envelopeId, $event)"
              @up="moveBy(index, -1)"
              @down="moveBy(index, 1)"
              @grab="startDrag($event, index)"
            />
            <ArrowDown
              v-if="index < state.queue.length - 1"
              class="rules-editor__arrow"
              :size="20"
              aria-hidden="true"
            />
          </li>
        </ol>
        <p class="rules-editor__live" role="status" aria-live="polite" data-testid="rules-announce">
          {{ announcement }}
        </p>
      </section>

      <section class="rules-editor__block" aria-labelledby="outside-title">
        <h2 id="outside-title" class="rules-editor__title">
          Вне очереди
          <UiInfoTooltip :text="OUTSIDE_HINT" label="Подсказка: вне очереди" />
        </h2>
        <ul class="rules-editor__outside" data-testid="rules-outside">
          <li v-for="card in state.outside" :key="card.envelopeId">
            <FundingRuleCard
              :card="card"
              :position="null"
              :income-label="labelFor(card.envelopeId)"
              :errors="cardErrors[card.envelopeId] ?? {}"
              :can-move-up="false"
              :can-move-down="false"
              :dragging="false"
              :disabled="saving"
              @type="onType(card.envelopeId, $event)"
              @fixed="onFixed(card.envelopeId, $event)"
              @percent="onPercent(card.envelopeId, $event)"
            />
          </li>
        </ul>
      </section>

      <div class="rules-editor__bar">
        <p v-if="formError" class="rules-editor__error" role="alert" data-testid="rules-error">
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ formError }}
        </p>
        <div class="rules-editor__actions">
          <UiButton
            variant="tertiary"
            :disabled="!dirty || saving"
            data-testid="rules-reset"
            @click="reset"
          >
            Отменить изменения
          </UiButton>
          <UiButton :loading="saving" :disabled="!dirty" data-testid="rules-save" @click="save">
            Сохранить
          </UiButton>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rules-editor {
  display: grid;
  gap: var(--hf-space-5);
  min-width: 0;
}

.rules-editor__block {
  display: grid;
  gap: var(--hf-space-3);
}

.rules-editor__title {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-2);
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}

.rules-editor__switch {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-2);
  min-height: 44px;
}

.rules-editor__suggestion {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: var(--hf-space-3);
}

.rules-editor__field {
  display: grid;
  gap: var(--hf-space-1);
  font-size: var(--hf-font-size-small);
}

.rules-editor__input {
  min-width: 0;
  min-height: 44px;
  padding: 0 var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
}

.rules-editor__input:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.rules-editor__input[aria-invalid='true'] {
  border-color: var(--hf-color-border-danger);
}

.rules-editor__queue,
.rules-editor__outside {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.rules-editor__item {
  display: grid;
  justify-items: center;
  gap: var(--hf-space-2);
}

.rules-editor__item > * {
  justify-self: stretch;
}

.rules-editor__arrow {
  justify-self: center !important;
  color: var(--hf-color-text-subtle);
}

.rules-editor__live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.rules-editor__muted {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.rules-editor__error {
  display: flex;
  align-items: center;
  gap: var(--hf-space-1);
  margin: 0;
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-small);
}

.rules-editor__bar {
  position: sticky;
  bottom: 0;
  display: grid;
  gap: var(--hf-space-2);
  padding: var(--hf-space-3) 0;
  border-top: 1px solid var(--hf-color-border);
  background: var(--hf-color-surface);
}

.rules-editor__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--hf-space-2);
}
</style>
