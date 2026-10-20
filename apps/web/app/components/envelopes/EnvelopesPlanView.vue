<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import FinanceMoneyInput from '../finance/FinanceMoneyInput.vue';
import ReferencePageLayout from '../ui/ReferencePageLayout.vue';
import UiActionMenu from '../ui/ActionMenu.vue';
import UiButton from '../ui/Button.vue';
import UiConfirmDialog from '../ui/ConfirmDialog.vue';
import UiEmptyState from '../ui/EmptyState.vue';
import UiInput from '../ui/Input.vue';
import UiModal from '../ui/Modal.vue';
import UiSelect from '../ui/Select.vue';
import UiSkeleton from '../ui/Skeleton.vue';
import UiStatus from '../ui/Status.vue';
import {
  type CreateEnvelopePlanRequest,
  type EnvelopePlanDto,
  type EnvelopePlanKind,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';
import { useReferenceDataForm } from '../../composables/useReferenceDataForm.js';
import { useToast } from '../../composables/useToast.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import RuleSettingsSheet from '../funding/RuleSettingsSheet.vue';
import EnvelopeMovePanel, { type MovePanelResult } from './EnvelopeMovePanel.vue';
import EnvelopePlanDrawer from './EnvelopePlanDrawer.vue';
import EnvelopePlanRow from './EnvelopePlanRow.vue';
import {
  PLAN_GROUPS,
  PLAN_SCOPE_LABELS,
  balanceSign,
  formatMoneyText,
} from './envelope-plan-kind.js';

defineOptions({ name: 'EnvelopesPlanView' });

// Envelope Plan v2.2 view: envelopes are assignments of money. Reads only the
// v2 list; every amount shown is a server minor string, and every change goes
// through the v2 mutations with one Idempotency-Key per attempt.
const props = defineProps<{ budgetId: string; query: Record<string, string | undefined> }>();

const planV2 = useEnvelopePlanV2();
const { push } = useToast();
const formFields = ['name', 'envelopeType', 'periodSlot', 'targetAmountMinor', 'comment'] as const;
const formHelper = useReferenceDataForm(formFields);

const envelopes = ref<EnvelopePlanDto[]>([]);
const loading = ref(true);
const loadError = ref('');
const statusMessage = ref('');
const detailed = ref<EnvelopePlanDto | null>(null);
const pageHeading = ref<HTMLElement | null>(null);

// Focus returns to whatever opened a panel; if that row is gone, to the heading.
let focusOrigin: HTMLElement | null = null;
function rememberFocus(): void {
  focusOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
}
async function restoreFocus(): Promise<void> {
  await nextTick();
  if (focusOrigin?.isConnected) focusOrigin.focus();
  else pageHeading.value?.focus();
  focusOrigin = null;
}

const groups = computed(() =>
  PLAN_GROUPS.map((group) => ({
    title: group.title,
    items: envelopes.value.filter((item) => group.types.includes(item.envelopeType)),
  })).filter((group) => group.items.length > 0),
);

const activeEnvelopes = computed(() => envelopes.value.filter((item) => item.archivedAt === null));

// actionPath hints from the dashboard. They only explain or highlight; nothing
// is moved without an explicit action, and unknown parameters are ignored.
const actionNote = computed(() => {
  if (props.query.leftoverPeriod) {
    return 'Остаток прошлого периода не добавлен к текущему автоматически. Откройте конверт и нажмите «Переложить», чтобы выбрать, куда его направить.';
  }
  if (props.query.coverPeriod) {
    return 'В прошлом периоде есть перерасход. Откройте конверт и нажмите «Переложить», чтобы покрыть его из другого конверта или свободных денег.';
  }
  if (props.query.cover === 'mandatory') {
    return 'Не хватает на обязательные платежи. Отложите деньги в конверт обязательных платежей кнопкой «Переложить».';
  }
  return '';
});
const highlightLabel = 'Нужно пополнить';
function isHighlighted(envelope: EnvelopePlanDto): boolean {
  return props.query.cover === 'mandatory' && envelope.envelopeType === 'MANDATORY_EXPENSES';
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    // A reference record may have changed: drop the shared operation cache.
    useOperationReferenceData().invalidate();
    // The v2 list returns active envelopes only.
    const response = await planV2.listEnvelopes(props.budgetId);
    envelopes.value = response.items;
  } catch (error) {
    loadError.value = v2ErrorMessage(error, 'Не удалось загрузить конверты. Повторите попытку.');
  } finally {
    loading.value = false;
  }
}

// One Idempotency-Key per user attempt for form and archive actions.
let attempt: { fingerprint: string; key: string } | null = null;
function attemptKey(kind: string, payload: unknown): string {
  const fingerprint = `${kind}:${JSON.stringify(payload)}`;
  if (attempt?.fingerprint !== fingerprint) {
    attempt = { fingerprint, key: crypto.randomUUID() };
  }
  return attempt.key;
}

// Create / edit form

const formVisible = ref(false);
const editing = ref<EnvelopePlanDto | null>(null);
const saving = ref(false);
const fieldErrors = ref<Partial<Record<(typeof formFields)[number], string>>>({});
const formError = ref('');
const form = reactive({
  name: '',
  envelopeType: 'CURRENT_EXPENSES' as EnvelopePlanKind,
  periodSlot: '' as '' | 'FIRST' | 'SECOND',
  targetAmountMinor: '',
  comment: '',
});

const scopeOptions = (
  ['CURRENT_EXPENSES', 'SAVINGS_GOAL', 'RESERVE', 'MANDATORY_EXPENSES', 'CUSTOM'] as const
).map((value) => ({ value, label: PLAN_SCOPE_LABELS[value] ?? value }));

const showsSlot = computed(() => form.envelopeType === 'CURRENT_EXPENSES');
const showsTarget = computed(
  () => !editing.value && (form.envelopeType === 'SAVINGS_GOAL' || form.envelopeType === 'RESERVE'),
);

function fieldError(field: (typeof formFields)[number]): string | undefined {
  return fieldErrors.value[field];
}

function startCreate(): void {
  rememberFocus();
  editing.value = null;
  form.name = '';
  form.envelopeType = 'CURRENT_EXPENSES';
  form.periodSlot = '';
  form.targetAmountMinor = '';
  form.comment = '';
  fieldErrors.value = {};
  formError.value = '';
  statusMessage.value = '';
  formVisible.value = true;
}

function startEdit(envelope: EnvelopePlanDto): void {
  rememberFocus();
  editing.value = envelope;
  form.name = envelope.name;
  form.envelopeType = envelope.envelopeType as EnvelopePlanKind;
  form.periodSlot =
    envelope.periodSlot === 'FIRST' || envelope.periodSlot === 'SECOND' ? envelope.periodSlot : '';
  form.targetAmountMinor = '';
  form.comment = envelope.comment ?? '';
  fieldErrors.value = {};
  formError.value = '';
  statusMessage.value = '';
  detailed.value = null;
  formVisible.value = true;
}

function cancelForm(): void {
  if (saving.value) return;
  formVisible.value = false;
  editing.value = null;
  void restoreFocus();
}

async function saveEnvelope(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  fieldErrors.value = {};
  formError.value = '';
  try {
    const target = editing.value;
    if (target) {
      const input: { name: string; periodSlot?: 'FIRST' | 'SECOND' } = { name: form.name };
      if (target.envelopeType === 'CURRENT_EXPENSES' && form.periodSlot !== '') {
        input.periodSlot = form.periodSlot;
      }
      await planV2.updateEnvelope(
        props.budgetId,
        target.id,
        input,
        attemptKey(`update-${target.id}`, input),
      );
      statusMessage.value = 'Конверт обновлён.';
      push({ tone: 'success', title: 'Конверт обновлён' });
    } else {
      const input: CreateEnvelopePlanRequest = {
        name: form.name,
        envelopeType: form.envelopeType,
      };
      if (showsSlot.value && form.periodSlot !== '') input.periodSlot = form.periodSlot;
      if (showsTarget.value && form.targetAmountMinor.trim() !== '') {
        input.targetAmountMinor = formHelper.normalizeDecimal(form.targetAmountMinor);
      }
      if (form.comment.trim() !== '') input.comment = form.comment.trim();
      await planV2.createEnvelope(props.budgetId, input, attemptKey('create', input));
      statusMessage.value = 'Конверт создан.';
      push({ tone: 'success', title: 'Конверт создан' });
    }
    attempt = null;
    formVisible.value = false;
    editing.value = null;
    await load();
    void restoreFocus();
  } catch (error) {
    const mapped = formHelper.errorMessage(error);
    fieldErrors.value = mapped.fields;
    formError.value =
      Object.keys(mapped.fields).length > 0
        ? mapped.summary
        : v2ErrorMessage(error, 'Не удалось сохранить конверт. Повторите попытку.');
  } finally {
    saving.value = false;
  }
}

// Reassign panel

const moveSource = ref<EnvelopePlanDto | null>(null);
const moveMode = ref<'reassign' | 'archive'>('reassign');

function startReassign(envelope: EnvelopePlanDto): void {
  rememberFocus();
  detailed.value = null;
  moveMode.value = 'reassign';
  moveSource.value = envelope;
}

function closeMove(): void {
  moveSource.value = null;
  void restoreFocus();
}

function describeResult(result: MovePanelResult): string {
  if (result.kind === 'assign') {
    return `Распределено. Остаток конверта по данным сервера: ${formatMoneyText(result.response.balanceMinor)}.`;
  }
  const { sourceBalanceMinor, destinationBalanceMinor } = result.response;
  const destination =
    destinationBalanceMinor === null
      ? ' Деньги вернулись в свободные.'
      : ` Остаток получателя: ${formatMoneyText(destinationBalanceMinor)}.`;
  return `Перенесено. Остаток источника: ${formatMoneyText(sourceBalanceMinor)}.${destination}`;
}

async function onMoveDone(result: MovePanelResult): Promise<void> {
  const source = moveSource.value;
  const archiving = moveMode.value === 'archive';
  moveSource.value = null;
  if (archiving && source) {
    await runArchive(source, describeResult(result));
    return;
  }
  statusMessage.value = describeResult(result);
  await load();
  void restoreFocus();
}

// Funding rule panel. The envelope DTO carries neither the rule nor the period,
// so the current period is taken from the dashboard only when it demonstrably
// belongs to this envelope (an assignment of the envelope in that period).

const ruleEnvelope = ref<EnvelopePlanDto | null>(null);
const rulePeriodStart = ref<string | null>(null);
let ruleSeq = 0;

async function startRules(envelope: EnvelopePlanDto): Promise<void> {
  rememberFocus();
  detailed.value = null;
  rulePeriodStart.value = null;
  const seq = ++ruleSeq;
  ruleEnvelope.value = envelope;
  try {
    const dashboard = await planV2.getDashboard(props.budgetId);
    if (seq !== ruleSeq) return;
    const periodId = dashboard.period.periodId;
    const belongs =
      periodId !== null &&
      dashboard.protectedAssignments.some(
        (item) => item.envelopeId === envelope.id && item.periodId === periodId,
      );
    rulePeriodStart.value = belongs ? dashboard.period.start : null;
  } catch {
    if (seq === ruleSeq) rulePeriodStart.value = null;
  }
}

function closeRules(): void {
  ruleSeq++;
  ruleEnvelope.value = null;
  void restoreFocus();
}

async function onRuleChanged(message: string): Promise<void> {
  statusMessage.value = message;
  await load();
}

// Archive: an empty envelope needs a confirmation, a positive one needs a
// destination for the remainder first, an overspent one must be covered first.

const confirmTarget = ref<EnvelopePlanDto | null>(null);
const archiving = ref(false);
const blockedTarget = ref<EnvelopePlanDto | null>(null);

function requestArchive(envelope: EnvelopePlanDto): void {
  rememberFocus();
  detailed.value = null;
  statusMessage.value = '';
  const sign = balanceSign(envelope.balanceMinor);
  if (sign === 'negative') {
    blockedTarget.value = envelope;
  } else if (sign === 'positive') {
    moveMode.value = 'archive';
    moveSource.value = envelope;
  } else {
    confirmTarget.value = envelope;
  }
}

function cancelArchive(): void {
  if (archiving.value) return;
  confirmTarget.value = null;
  void restoreFocus();
}

function dismissBlocked(): void {
  blockedTarget.value = null;
  void restoreFocus();
}

async function runArchive(envelope: EnvelopePlanDto, prefix = ''): Promise<void> {
  if (archiving.value) return;
  archiving.value = true;
  try {
    await planV2.archiveEnvelope(props.budgetId, envelope.id, attemptKey('archive', envelope.id));
    attempt = null;
    confirmTarget.value = null;
    statusMessage.value = `${prefix ? `${prefix} ` : ''}Конверт перемещён в архив.`;
    push({ tone: 'success', title: 'Конверт перемещён в архив' });
    await load();
    void restoreFocus();
  } catch (error) {
    confirmTarget.value = null;
    statusMessage.value = `${prefix ? `${prefix} ` : ''}${v2ErrorMessage(error, 'Не удалось архивировать конверт. Повторите попытку.')}`;
    await load().catch(() => undefined);
    void restoreFocus();
  } finally {
    archiving.value = false;
  }
}

function confirmArchive(): void {
  if (confirmTarget.value) void runArchive(confirmTarget.value);
}

onMounted(() => {
  void load();
});
</script>

<template>
  <ReferencePageLayout>
    <template #kicker>Справочники</template>
    <template #title>
      <span ref="pageHeading" tabindex="-1" class="plan-view__heading">Конверты</span>
    </template>
    <template #description>
      Конверт показывает, для чего отложены деньги, а не где они физически лежат. Деньги на счетах
      общие: конверты делят их по назначению.
    </template>
    <template #actions>
      <UiButton data-action="create-envelope" @click="startCreate">Создать конверт</UiButton>
    </template>
    <template #content>
      <div role="status" aria-live="polite" data-testid="envelopes-status-region">
        <UiStatus v-if="statusMessage" :label="statusMessage" tone="info" />
      </div>
      <p v-if="actionNote" class="plan-view__note" data-testid="envelopes-action-note" role="note">
        {{ actionNote }}
      </p>
      <div
        v-if="blockedTarget"
        class="plan-view__note plan-view__note--danger"
        role="alert"
        data-testid="archive-blocked"
      >
        <p>
          Сначала покройте перерасход конверта «{{ blockedTarget.name }}»: сейчас в нём
          <FinanceMoney :minor-units="blockedTarget.balanceMinor" currency="RUB" :scale="2" />.
          Архивировать можно, когда остаток станет нулевым или положительным.
        </p>
        <UiButton
          variant="secondary"
          size="sm"
          data-testid="archive-blocked-close"
          @click="dismissBlocked"
        >
          Понятно
        </UiButton>
      </div>

      <div v-if="loadError">
        <UiEmptyState title="Конверты недоступны" :description="loadError">
          <template #action><UiButton @click="load">Повторить</UiButton></template>
        </UiEmptyState>
      </div>
      <div
        v-else-if="loading && envelopes.length === 0"
        data-testid="envelopes-loading"
        aria-busy="true"
      >
        <UiSkeleton variant="row" :count="4" />
      </div>
      <template v-else>
        <UiEmptyState
          v-if="envelopes.length === 0"
          title="Конвертов пока нет"
          description="Создайте конверт, чтобы распределять в него деньги."
        >
          <template #action><UiButton @click="startCreate">Создать конверт</UiButton></template>
        </UiEmptyState>

        <div v-if="groups.length > 0" class="plan-view__panel">
          <section v-for="group in groups" :key="group.title" class="plan-view__group">
            <h2 class="plan-view__group-label">{{ group.title }}</h2>
            <ul class="plan-view__list" :aria-label="`Конверты: ${group.title}`">
              <li v-for="envelope in group.items" :key="envelope.id" class="plan-view__item">
                <EnvelopePlanRow
                  :envelope="envelope"
                  :data-testid="`envelope-row-${envelope.id}`"
                  :data-highlighted="isHighlighted(envelope) ? 'true' : undefined"
                  :highlight="isHighlighted(envelope) ? highlightLabel : undefined"
                  :class="{ 'plan-view__row--highlight': isHighlighted(envelope) }"
                  @select="
                    rememberFocus();
                    detailed = envelope;
                  "
                >
                  <template #actions>
                    <UiActionMenu
                      :label="`Действия: ${envelope.name}`"
                      :trigger-test-id="`row-actions-${envelope.id}`"
                    >
                      <button
                        v-if="!envelope.archivedAt"
                        type="button"
                        role="menuitem"
                        data-testid="row-reassign"
                        data-action="reassign-envelope"
                        @click="startReassign(envelope)"
                      >
                        Переложить
                      </button>
                      <button
                        v-if="!envelope.archivedAt"
                        type="button"
                        role="menuitem"
                        data-testid="row-rules"
                        data-action="rules-envelope"
                        @click="startRules(envelope)"
                      >
                        Правило пополнения
                      </button>
                      <button
                        v-if="!envelope.archivedAt"
                        type="button"
                        role="menuitem"
                        data-testid="row-edit"
                        data-action="edit-envelope"
                        @click="startEdit(envelope)"
                      >
                        Изменить
                      </button>
                      <NuxtLink
                        role="menuitem"
                        data-testid="row-operations"
                        :to="`/app/operations?envelopeId=${encodeURIComponent(envelope.id)}`"
                      >
                        Операции конверта
                      </NuxtLink>
                      <button
                        v-if="!envelope.archivedAt"
                        type="button"
                        role="menuitem"
                        data-testid="row-archive"
                        data-action="archive-envelope"
                        @click="requestArchive(envelope)"
                      >
                        Переместить в архив
                      </button>
                    </UiActionMenu>
                  </template>
                </EnvelopePlanRow>
              </li>
            </ul>
          </section>
        </div>
      </template>
    </template>
  </ReferencePageLayout>

  <EnvelopePlanDrawer
    :budget-id="budgetId"
    :envelope="detailed"
    @close="
      detailed = null;
      restoreFocus();
    "
    @edit="startEdit"
    @reassign="startReassign"
    @rules="startRules"
    @archive="requestArchive"
  />

  <RuleSettingsSheet
    :open="ruleEnvelope !== null"
    :budget-id="budgetId"
    :envelope="ruleEnvelope"
    :period-start="rulePeriodStart"
    @close="closeRules"
    @changed="onRuleChanged"
  />

  <EnvelopeMovePanel
    :budget-id="budgetId"
    :source="moveSource"
    :envelopes="activeEnvelopes"
    :mode="moveMode"
    @close="closeMove"
    @done="onMoveDone"
  />

  <UiModal
    :open="formVisible"
    :title="editing ? 'Изменить конверт' : 'Новый конверт'"
    @close="cancelForm"
  >
    <form data-envelope-form @submit.prevent="saveEnvelope">
      <UiInput
        v-model="form.name"
        name="name"
        label="Название конверта"
        :error="fieldError('name')"
        required
      />
      <UiSelect
        v-if="!editing"
        v-model="form.envelopeType"
        name="envelopeType"
        label="Область действия"
        tooltip="На текущие траты — деньги на половину периода; накопления — остаток не сбрасывается; обязательные платежи — аренда, кредиты и другие регулярные платежи (один активный конверт на бюджет); свой конверт — любая другая цель."
        :options="scopeOptions"
        :error="fieldError('envelopeType')"
        required
        @update:model-value="
          (value: string) => {
            form.envelopeType = value as EnvelopePlanKind;
            if (value !== 'CURRENT_EXPENSES') form.periodSlot = '';
          }
        "
      />
      <UiSelect
        v-if="showsSlot"
        v-model="form.periodSlot"
        name="periodSlot"
        label="Половина периода"
        :options="[
          { value: '', label: 'Не указана' },
          { value: 'FIRST', label: 'Первая половина' },
          { value: 'SECOND', label: 'Вторая половина' },
        ]"
        :error="fieldError('periodSlot')"
      />
      <FinanceMoneyInput
        v-if="showsTarget"
        v-model="form.targetAmountMinor"
        name="targetAmountMinor"
        label="Цель накопления"
        hint="Необязательно. Это ориентир, а не обязательный взнос."
        :error="fieldError('targetAmountMinor')"
      />
      <label v-if="!editing" class="plan-form__field">
        <span>Комментарий</span>
        <textarea
          v-model="form.comment"
          autocomplete="off"
          name="comment"
          :aria-invalid="fieldError('comment') ? 'true' : undefined"
        />
        <small v-if="fieldError('comment')">{{ fieldError('comment') }}</small>
      </label>
      <p v-if="formError" class="plan-form__error" role="alert" data-testid="envelope-form-error">
        {{ formError }}
      </p>
      <div class="plan-form__actions">
        <UiButton type="submit" :loading="saving">Сохранить конверт</UiButton>
        <UiButton type="button" variant="tertiary" :disabled="saving" @click="cancelForm">
          Отмена
        </UiButton>
      </div>
    </form>
  </UiModal>

  <UiConfirmDialog
    :open="confirmTarget !== null"
    title="Архивировать конверт?"
    description="Конверт останется в истории, но будет недоступен для новых распределений."
    confirm-label="Архивировать конверт"
    cancel-label="Отмена"
    variant="danger"
    :loading="archiving"
    @confirm="confirmArchive"
    @cancel="cancelArchive"
  />
</template>

<style scoped>
form[data-envelope-form] {
  display: grid;
  gap: var(--hf-space-5);
}

.plan-view__heading:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.plan-view__note {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: center;
  margin: 0;
  padding: var(--hf-space-3) var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text);
}

.plan-view__note--danger {
  border-color: var(--hf-color-border-danger);
}

.plan-view__note p {
  margin: 0;
}

.plan-view__panel {
  padding: var(--hf-space-2) var(--hf-card-padding);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}

.plan-view__group {
  display: grid;
  gap: var(--hf-space-3);
  padding-top: var(--hf-space-6);
}

.plan-view__group:first-of-type {
  padding-top: var(--hf-space-4);
}

.plan-view__group-label {
  margin: 0;
  padding-bottom: var(--hf-space-2);
  border-bottom: 1px solid var(--hf-color-border);
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
}

.plan-view__list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.plan-view__item {
  min-width: 0;
}

.plan-view__item + .plan-view__item {
  border-top: 1px solid var(--hf-color-border);
}

.plan-view__row--highlight {
  border-left: 4px solid var(--hf-color-status-info);
  background: var(--hf-color-status-info-background);
}

.plan-form__field {
  display: grid;
  gap: var(--hf-space-2);
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
}

.plan-form__field textarea {
  min-height: 6rem;
  padding: var(--hf-space-3);
  resize: vertical;
  color: var(--hf-color-text);
  border: 1px solid var(--hf-color-border-strong);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  font: inherit;
}

.plan-form__field small,
.plan-form__error {
  margin: 0;
  color: var(--hf-color-text-danger);
  font-weight: var(--hf-font-weight-regular);
}

.plan-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
}
</style>
