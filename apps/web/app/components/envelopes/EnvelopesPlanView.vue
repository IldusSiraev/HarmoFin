<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { Archive, ArrowLeftRight, List, Pencil, Plus, Search, Settings2 } from '@lucide/vue';
import { navigateTo } from '#imports';

import PeriodDecisionCard from '../dashboard/PeriodDecisionCard.vue';
import FinanceMoney from '../finance/FinanceMoney.vue';
import FinanceMoneyInput from '../finance/FinanceMoneyInput.vue';
import ReferencePageLayout from '../ui/ReferencePageLayout.vue';
import UiActionMenu from '../ui/ActionMenu.vue';
import UiAttentionRow from '../ui/AttentionRow.vue';
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
  type DashboardV2Response,
  type EnvelopePlanDto,
  type EnvelopePlanKind,
  type FundingRuleResponse,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
import { useFundingEntry } from '../../composables/useFundingEntry.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';
import { usePermissions } from '../../composables/usePermissions.js';
import { useReferenceDataForm } from '../../composables/useReferenceDataForm.js';
import { useToast } from '../../composables/useToast.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import { describeRule } from '../funding-rules/funding-rule-text.js';
import EnvelopeCoverPanel, {
  type CoverPanelResult,
  type CoverTarget,
} from './EnvelopeCoverPanel.vue';
import EnvelopeMovePanel, { type MovePanelResult } from './EnvelopeMovePanel.vue';
import EnvelopePlanDialog from './EnvelopePlanDialog.vue';
import EnvelopePlanRow from './EnvelopePlanRow.vue';
import OwnerFilter from '../app/OwnerFilter.vue';
import { ownerLabel } from '../app/owner-label.js';
import { useOwnerFilter } from '../../composables/useOwnerFilter.js';
import EnvelopesShortfallDialog from './EnvelopesShortfallDialog.vue';
import EnvelopesSummary from './EnvelopesSummary.vue';
import PeriodTargetDialog from './PeriodTargetDialog.vue';
import {
  PLAN_GROUPS,
  PLAN_SCOPE_LABELS,
  balanceSign,
  formatMoneyText,
  periodRangeText,
  planBadge,
  planProgress,
  pluralRu,
} from './envelope-plan-kind.js';

defineOptions({ name: 'EnvelopesPlanView' });

// Envelope Plan v2.2 view: envelopes are assignments of money. Reads only the
// v2 list; every amount shown is a server minor string, and every change goes
// through the v2 mutations with one Idempotency-Key per attempt.
const props = defineProps<{ budgetId: string; query: Record<string, string | undefined> }>();

const planV2 = useEnvelopePlanV2();
const { push } = useToast();
// Envelope management, reassignment, funding rules and assignment are
// OWNER-only on the server (editing/archiving envelopes, moving money between
// them, setting a period target, and the free/opening distribution flow).
const { userId, canCreate } = usePermissions();
const { mode: ownerMode, ownerUserId, options: ownerOptions, kind: ownerKind } = useOwnerFilter();
const formFields = ['name', 'envelopeType', 'periodSlot', 'targetAmountMinor', 'comment'] as const;
const formHelper = useReferenceDataForm(formFields);

const envelopes = ref<EnvelopePlanDto[]>([]);
const loading = ref(true);
const loadError = ref('');
const statusMessage = ref('');
const detailed = ref<EnvelopePlanDto | null>(null);
const pageHeading = ref<HTMLElement | null>(null);

// Saved funding rules, for the read-only summary in the details dialog. A failed
// read only hides that line; the page keeps working. Rules of archived envelopes
// are not in the queue the rules page shows, so they do not count in the number.
const rules = ref<FundingRuleResponse[] | null>(null);
const activeRules = computed(() => {
  if (rules.value === null) return null;
  const active = new Set(
    envelopes.value.filter((item) => item.archivedAt === null).map((item) => item.id),
  );
  return rules.value.filter((rule) => active.has(rule.envelopeId));
});
const detailedRule = computed(() =>
  detailed.value ? describeRule(detailed.value.id, activeRules.value) : null,
);

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

// Name search is a client-side view filter only; amounts are untouched.
const search = ref('');
const searchQuery = computed(() => search.value.trim().toLocaleLowerCase('ru'));
const visibleGroups = computed(() => {
  const query = searchQuery.value;
  if (!query) return groups.value;
  return groups.value
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.name.toLocaleLowerCase('ru').includes(query)),
    }))
    .filter((group) => group.items.length > 0);
});
const visibleCount = computed(() =>
  visibleGroups.value.reduce((count, group) => count + group.items.length, 0),
);
function foundText(n: number): string {
  const verb = pluralRu(n, 'Найден', 'Найдено', 'Найдено');
  return `${verb} ${n} ${pluralRu(n, 'конверт', 'конверта', 'конвертов')}`;
}
const activeCountText = computed(() => {
  const n = activeEnvelopes.value.length;
  return `${n} ${pluralRu(n, 'активный', 'активных', 'активных')}`;
});
const searchStatus = computed(() => (searchQuery.value ? foundText(visibleCount.value) : ''));

const SLOT_HALVES: Record<string, string> = { FIRST: 'Первая', SECOND: 'Вторая' };
const GROUP_NOTES: Record<string, string> = {
  CURRENT_EXPENSES: 'Лимит на каждую половину периода',
  MANDATORY_EXPENSES: 'Сумма считается по ближайшим плановым платежам',
  SAVINGS_GOAL: 'Деньги на цели и на непредвиденные расходы',
  RESERVE: 'Деньги на цели и на непредвиденные расходы',
  CUSTOM: 'Конверты для своих целей',
};
// The half the current period belongs to: the slot of the current-expense
// envelope whose server-marked bucket is current. Null when undetermined.
const currentHalfSlot = computed(() => {
  const owner = envelopes.value.find(
    (item) =>
      item.envelopeType === 'CURRENT_EXPENSES' &&
      item.periodSlot !== null &&
      (item.periods ?? []).some((period) => period.current),
  );
  return owner?.periodSlot ?? null;
});
function groupNote(group: { items: EnvelopePlanDto[] }): string {
  const first = group.items[0];
  if (!first) return '';
  if (first.envelopeType === 'CURRENT_EXPENSES') {
    const slots = new Set(group.items.map((item) => item.periodSlot));
    const [slot] = [...slots];
    const half = slots.size === 1 && slot ? SLOT_HALVES[slot] : undefined;
    if (half) {
      // Dashboard dates describe the current period; show them only for its half.
      if (dashboard.value && slot === currentHalfSlot.value) {
        const range = periodRangeText(dashboard.value.period.start, dashboard.value.period.end);
        return `${half} половина периода · ${range}`;
      }
      return `${half} половина периода`;
    }
  }
  // Group notes describe the group, not repeat each card's own caption.
  return GROUP_NOTES[first.envelopeType] ?? '';
}

// Inputs for the card progress and badge, straight from the server dashboard.
const mandatoryProgress = computed(() =>
  dashboard.value
    ? {
        balanceMinor: dashboard.value.mandatoryBalanceMinor,
        dueMinor: dashboard.value.mandatoryDueMinor,
      }
    : null,
);
const mandatoryGap = computed(() => dashboard.value?.mandatoryGapMinor ?? null);

// actionPath hints from the dashboard. A leftover only gets an explanation (the
// period card holds its decision); cover and shortfall links open their panel
// (see applyActionQuery). Nothing is moved without an explicit confirmation, and
// unknown parameters are ignored.
const actionNote = computed(() => {
  if (props.query.leftoverPeriod) {
    return 'Остаток прошлого периода не добавлен к текущему автоматически. Откройте конверт и нажмите «Переложить», чтобы выбрать, куда его направить.';
  }
  return '';
});

// Money summary from the server dashboard. It loads next to the list; a failed
// read hides the summary only, the list keeps working.
const funding = useFundingEntry();
const dashboard = ref<DashboardV2Response | null>(null);
const summaryError = ref(false);
let dashboardSeq = 0;

const kicker = computed(() =>
  dashboard.value
    ? `Конверты · ${periodRangeText(dashboard.value.period.start, dashboard.value.period.end)}`
    : 'Справочники',
);

async function loadDashboard(): Promise<void> {
  const seq = ++dashboardSeq;
  try {
    const response = await planV2.getDashboard(props.budgetId);
    if (seq !== dashboardSeq) return;
    dashboard.value = response;
    summaryError.value = false;
  } catch {
    if (seq !== dashboardSeq) return;
    dashboard.value = null;
    summaryError.value = true;
  }
}

function distributeFree(): void {
  funding.offer({ sourceKind: 'FREE' });
}

// Cover panel: a past-period overspend or the mandatory gap, with a fixed
// recipient. The shortage is the server warning amount.

type Warning = DashboardV2Response['warnings'][number];
const coverTarget = ref<CoverTarget | null>(null);
const shortfallOpen = ref(false);

const deficitWarnings = computed(() =>
  (dashboard.value?.warnings ?? []).filter(
    (item) => item.code === 'PERIOD_DEFICIT' && item.envelopeId !== null && item.periodId !== null,
  ),
);
const shortfallDeficits = computed(() =>
  deficitWarnings.value.map((warning) => ({
    warning,
    name: envelopes.value.find((item) => item.id === warning.envelopeId)?.name ?? 'Конверт',
  })),
);
const shortfallMinor = computed(
  () =>
    dashboard.value?.warnings.find((item) => item.code === 'CASH_SHORTFALL')?.amountMinor ?? '0',
);

function coverDeficit(warning: Warning): boolean {
  const envelope = envelopes.value.find((item) => item.id === warning.envelopeId);
  if (!envelope || warning.periodId === null) return false;
  // From the shortfall dialog focus returns to what opened the dialog.
  if (!shortfallOpen.value) rememberFocus();
  shortfallOpen.value = false;
  coverTarget.value = {
    reason: 'deficit',
    envelope,
    periodId: warning.periodId,
    shortageMinor: warning.amountMinor,
  };
  return true;
}

function coverMandatory(): boolean {
  const gap = dashboard.value?.warnings.find((item) => item.code === 'MANDATORY_GAP');
  const envelope = activeEnvelopes.value.find((item) => item.envelopeType === 'MANDATORY_EXPENSES');
  if (!gap || !envelope) return false;
  rememberFocus();
  coverTarget.value = {
    reason: 'mandatory',
    envelope,
    periodId: null,
    shortageMinor: gap.amountMinor,
  };
  return true;
}

function openShortfall(): void {
  rememberFocus();
  shortfallOpen.value = true;
}

function closeShortfall(): void {
  shortfallOpen.value = false;
  void restoreFocus();
}

function closeCover(): void {
  coverTarget.value = null;
  void restoreFocus();
}

async function onCoverDone(result: CoverPanelResult): Promise<void> {
  coverTarget.value = null;
  statusMessage.value = describeResult(result);
  push({ tone: 'success', title: 'Покрыто' });
  await load();
  void restoreFocus();
}

// Dashboard and period-card links (?coverPeriod=, ?cover=mandatory, ?shortfall=1)
// open their panel once the data is loaded; the parameter is then dropped from
// the address so the same link opens the panel again.
const ACTION_KEYS = ['coverPeriod', 'cover', 'shortfall'] as const;
// The link already handled: a reload of the data must not open its panel again.
let appliedAction = '';
function applyActionQuery(): void {
  const query = props.query;
  const action = ACTION_KEYS.map((key) => query[key] ?? '').join('|');
  if (!ACTION_KEYS.some((key) => query[key])) {
    appliedAction = '';
    return;
  }
  if (action === appliedAction || loading.value || !dashboard.value) return;
  appliedAction = action;
  const covers = Boolean(query.coverPeriod) || query.cover === 'mandatory';
  if (covers && !canCreate.value) {
    statusMessage.value =
      'Распределять деньги между конвертами может только владелец или редактор бюджета.';
  } else if (query.coverPeriod) {
    const warning = deficitWarnings.value.find((item) => item.periodId === query.coverPeriod);
    if (!warning || !coverDeficit(warning)) {
      statusMessage.value = 'Перерасхода за этот период уже нет.';
    }
  } else if (query.cover === 'mandatory') {
    coverMandatory();
  }
  if (query.shortfall) openShortfall();
  const rest = Object.fromEntries(
    Object.entries(query).filter(
      ([key, value]) => value !== undefined && !(ACTION_KEYS as readonly string[]).includes(key),
    ),
  );
  void navigateTo({ path: '/app/envelopes', query: rest }, { replace: true });
}
watch([() => props.query, loading, dashboard], applyActionQuery);

// A confirmed assignment changes envelope balances and what is free.
watch(
  () => funding.confirmedCount.value,
  () => void load(),
);

// After a period decision the card may be gone: keep focus on a stable element.
async function onPeriodDecided(): Promise<void> {
  await load();
  await nextTick();
  (document.getElementById('period-decision-title') ?? pageHeading.value)?.focus();
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  const summary = loadDashboard();
  try {
    // A reference record may have changed: drop the shared operation cache.
    useOperationReferenceData().invalidate();
    // The v2 list returns active envelopes only; the owner filter narrows it
    // server-side, with no second argument at all for "all owners".
    const response = ownerUserId.value
      ? await planV2.listEnvelopes(props.budgetId, ownerUserId.value)
      : await planV2.listEnvelopes(props.budgetId);
    envelopes.value = response.items;
    try {
      rules.value = (await planV2.listFundingRules(props.budgetId)).items;
    } catch {
      rules.value = null;
    }
  } catch (error) {
    loadError.value = v2ErrorMessage(error, 'Не удалось загрузить конверты. Повторите попытку.');
  } finally {
    loading.value = false;
  }
  await summary;
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

// Period target dialog. The envelope DTO does not carry the current period, so
// it is taken from the dashboard only when it demonstrably belongs to this
// envelope (an assignment of the envelope in that period).
// The dialog resets only when it opens, so the period is resolved first and the
// dialog opens afterwards with its final periodStart.

const targetEnvelope = ref<EnvelopePlanDto | null>(null);
const targetPeriodStart = ref<string | null>(null);
let targetSeq = 0;

async function startTarget(envelope: EnvelopePlanDto): Promise<void> {
  rememberFocus();
  detailed.value = null;
  targetEnvelope.value = null;
  const seq = ++targetSeq;
  let periodStart: string | null = null;
  try {
    const dashboard = await planV2.getDashboard(props.budgetId);
    if (seq !== targetSeq) return;
    const periodId = dashboard.period.periodId;
    const belongs =
      periodId !== null &&
      dashboard.protectedAssignments.some(
        (item) => item.envelopeId === envelope.id && item.periodId === periodId,
      );
    periodStart = belongs ? dashboard.period.start : null;
  } catch {
    if (seq !== targetSeq) return;
    periodStart = null;
  }
  targetPeriodStart.value = periodStart;
  targetEnvelope.value = envelope;
}

function closeTarget(): void {
  targetSeq++;
  targetEnvelope.value = null;
  void restoreFocus();
}

async function onTargetChanged(message: string): Promise<void> {
  statusMessage.value = message;
  closeTarget();
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

watch(ownerUserId, () => {
  void load();
});

// Owner-gated row edits use the server flag; a missing flag (older cached
// payloads) falls back to showing the actions, and the server still refuses.
function canEditEnvelopeFor(envelope: EnvelopePlanDto): boolean {
  return canCreate.value && envelope.canEdit !== false;
}

function rowOwnerCaption(envelope: EnvelopePlanDto): string | null {
  if (ownerKind.value === 'none' || !envelope.owner) return null;
  return ownerLabel(envelope.owner, userId.value);
}
</script>

<template>
  <ReferencePageLayout>
    <template #kicker>{{ kicker }}</template>
    <template #title>
      <span ref="pageHeading" tabindex="-1" class="plan-view__heading">Конверты</span>
    </template>
    <template #description>
      Распределяйте деньги по целям, не перемещая их между счетами.
    </template>
    <template #actions>
      <UiButton
        v-if="canCreate"
        variant="secondary"
        to="/app/envelopes/rules"
        data-action="envelope-rules"
      >
        <Settings2 :size="18" aria-hidden="true" />
        Задать правила
      </UiButton>
      <UiButton v-if="canCreate" data-action="create-envelope" @click="startCreate">
        <Plus :size="18" aria-hidden="true" />
        Создать конверт
      </UiButton>
    </template>
    <template #content>
      <EnvelopesSummary
        v-if="dashboard"
        :dashboard="dashboard"
        :can-allocate="canCreate"
        @distribute="distributeFree"
        @cover-mandatory="coverMandatory"
        @shortfall="openShortfall"
      />
      <UiAttentionRow
        v-else-if="summaryError"
        data-testid="summary-retry"
        tone="info"
        title="Сводка недоступна"
        action-label="Повторить"
        @action="loadDashboard"
      />
      <PeriodDecisionCard
        v-if="dashboard"
        :budget-id="budgetId"
        :warnings="dashboard.warnings"
        :suggested-target="dashboard.suggestedTarget"
        :hide-target="true"
        :period-id="dashboard.period.periodId"
        :protected-assignments="dashboard.protectedAssignments"
        @changed="onPeriodDecided"
        @focus-fallback="pageHeading?.focus()"
      />
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
          <template v-if="canCreate" #action>
            <UiButton @click="startCreate">Создать конверт</UiButton>
          </template>
        </UiEmptyState>

        <section
          v-if="groups.length > 0"
          class="plan-view__list-section"
          aria-labelledby="envelopes-all-title"
        >
          <div class="plan-view__list-head">
            <div class="plan-view__list-title">
              <h2 id="envelopes-all-title" class="plan-view__title">Все конверты</h2>
              <span class="plan-view__count">{{ activeCountText }}</span>
            </div>
            <OwnerFilter
              v-if="ownerKind !== 'none'"
              v-model="ownerMode"
              :kind="ownerKind"
              :options="ownerOptions"
            />
            <UiInput
              v-model="search"
              class="plan-view__search"
              name="envelope-search"
              label="Найти конверт"
              hide-label
              placeholder="Найти конверт"
            >
              <template #icon><Search :size="18" /></template>
            </UiInput>
          </div>
          <div class="plan-view__sr-only" aria-live="polite" data-testid="envelope-search-status">
            {{ searchStatus }}
          </div>
          <UiEmptyState
            v-if="visibleGroups.length === 0"
            title="Ничего не найдено"
            description="Проверьте название конверта."
          />
          <section v-for="group in visibleGroups" :key="group.title" class="plan-view__group">
            <div class="plan-view__group-head">
              <h3 class="plan-view__group-label">{{ group.title }}</h3>
              <p class="plan-view__group-note">{{ groupNote(group) }}</p>
            </div>
            <ul class="plan-view__list" :aria-label="`Конверты: ${group.title}`">
              <li v-for="envelope in group.items" :key="envelope.id" class="plan-view__item">
                <EnvelopePlanRow
                  :envelope="envelope"
                  :progress="planProgress(envelope, mandatoryProgress)"
                  :badge="planBadge(envelope, mandatoryGap)"
                  :owner-caption="rowOwnerCaption(envelope)"
                  :data-testid="`envelope-row-${envelope.id}`"
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
                        v-if="!envelope.archivedAt && canEditEnvelopeFor(envelope)"
                        type="button"
                        role="menuitem"
                        data-testid="row-reassign"
                        data-action="reassign-envelope"
                        @click="startReassign(envelope)"
                      >
                        <ArrowLeftRight :size="18" aria-hidden="true" />
                        Переложить
                      </button>
                      <button
                        v-if="!envelope.archivedAt && canEditEnvelopeFor(envelope)"
                        type="button"
                        role="menuitem"
                        data-testid="row-edit"
                        data-action="edit-envelope"
                        @click="startEdit(envelope)"
                      >
                        <Pencil :size="18" aria-hidden="true" />
                        Изменить
                      </button>
                      <NuxtLink
                        role="menuitem"
                        data-testid="row-operations"
                        :to="`/app/operations?envelopeId=${encodeURIComponent(envelope.id)}`"
                      >
                        <List :size="18" aria-hidden="true" />
                        Операции конверта
                      </NuxtLink>
                      <button
                        v-if="!envelope.archivedAt && canEditEnvelopeFor(envelope)"
                        type="button"
                        role="menuitem"
                        data-testid="row-archive"
                        data-action="archive-envelope"
                        @click="requestArchive(envelope)"
                      >
                        <Archive :size="18" aria-hidden="true" />
                        Переместить в архив
                      </button>
                    </UiActionMenu>
                  </template>
                </EnvelopePlanRow>
              </li>
            </ul>
          </section>
        </section>
      </template>
    </template>
  </ReferencePageLayout>

  <EnvelopePlanDialog
    :budget-id="budgetId"
    :envelope="detailed"
    :rule-summary="detailedRule"
    :badge="detailed ? planBadge(detailed, dashboard?.mandatoryGapMinor ?? null) : null"
    @close="
      detailed = null;
      restoreFocus();
    "
    @edit="startEdit"
    @reassign="startReassign"
    @target="startTarget"
    @archive="requestArchive"
  />

  <PeriodTargetDialog
    :open="targetEnvelope !== null"
    :budget-id="budgetId"
    :envelope="targetEnvelope"
    :period-start="targetPeriodStart"
    @close="closeTarget"
    @changed="onTargetChanged"
  />

  <EnvelopeCoverPanel
    :budget-id="budgetId"
    :target="coverTarget"
    :envelopes="activeEnvelopes"
    :free-minor="dashboard?.freeToAssignMinor ?? '0'"
    @close="closeCover"
    @done="onCoverDone"
  />

  <EnvelopesShortfallDialog
    :open="shortfallOpen"
    :amount-minor="shortfallMinor"
    :deficits="shortfallDeficits"
    :can-allocate="canCreate"
    @close="closeShortfall"
    @cover="coverDeficit"
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

.plan-view__list-section {
  display: grid;
  gap: var(--hf-space-4);
  min-width: 0;
}

.plan-view__list-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
  align-items: center;
  justify-content: space-between;
}

.plan-view__list-title {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: baseline;
}

.plan-view__title {
  margin: 0;
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-h3);
  font-weight: var(--hf-font-weight-semibold);
}

.plan-view__count {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.plan-view__search {
  flex: 0 1 20rem;
  min-width: min(100%, 14rem);
}

.plan-view__sr-only {
  position: absolute;
  overflow: hidden;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.plan-view__group {
  display: grid;
  gap: var(--hf-space-3);
  min-width: 0;
}

.plan-view__group-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.125rem var(--hf-space-2);
  align-items: baseline;
}

.plan-view__group-label {
  margin: 0;
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
}

.plan-view__group-note {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.plan-view__list {
  display: grid;
  gap: var(--hf-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.plan-view__item {
  min-width: 0;
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
