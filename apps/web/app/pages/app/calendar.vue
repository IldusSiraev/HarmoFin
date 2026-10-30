<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { format } from 'date-fns';
import { definePageMeta, navigateTo, useRoute } from '#imports';

import CalendarAgenda from '../../components/calendar/CalendarAgenda.vue';
import CalendarDayDialog from '../../components/calendar/CalendarDayDialog.vue';
import CalendarEventDialog from '../../components/calendar/CalendarEventDialog.vue';
import CalendarEventForm from '../../components/calendar/CalendarEventForm.vue';
import CalendarHeader from '../../components/calendar/CalendarHeader.vue';
import CalendarMonthGrid from '../../components/calendar/CalendarMonthGrid.vue';
import CalendarPlanDialog from '../../components/calendar/CalendarPlanDialog.vue';
import {
  addIsoDays,
  agendaRange,
  agendaTitle,
  groupByDay,
  monthRange,
  monthTitle,
  shiftMonth,
} from '../../components/calendar/calendar-dates.js';
import {
  emptyForm,
  type EventFormState,
  fieldErrorsFromProblem,
  fromEvent,
} from '../../components/calendar/event-form-state.js';
import UiButton from '../../components/ui/Button.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiSkeleton from '../../components/ui/Skeleton.vue';
import { useActiveWorkspace } from '../../composables/useActiveWorkspace.js';
import { ApiRequestError } from '../../composables/useApiClient.js';
import type { PersonRef } from '../../composables/useEnvelopePlanV2.js';
import { useFamily } from '../../composables/useFamily.js';
import {
  type CalendarEventDto,
  type CalendarEventInput,
  type CalendarFeedEventItem,
  type CalendarFeedItem,
  type CalendarFeedPlanItem,
  useFamilyCalendar,
} from '../../composables/useFamilyCalendar.js';
import { usePermissions } from '../../composables/usePermissions.js';
import { useToast } from '../../composables/useToast.js';

defineOptions({ name: 'CalendarPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

type View = 'month' | 'agenda';

const route = useRoute();
const { budget, workspace } = useActiveWorkspace();
// UI hints only: the server checks the role and authorship of every mutation again.
const { canCreate, userId } = usePermissions();
const { members, load: loadMembers } = useFamily(computed(() => workspace.value?.id));
const calendar = useFamilyCalendar();
const { push } = useToast();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAVE_FAILED = 'Не удалось сохранить событие. Повторите попытку.';
const DELETE_FAILED = 'Не удалось удалить событие. Повторите попытку.';
const OPEN_FAILED = 'Не удалось открыть событие. Повторите попытку.';
const UNAVAILABLE = 'Событие удалено или недоступно';

// The browser date only highlights a day and anchors navigation; the server resolves every
// occurrence in the budget time zone and no money is computed here.
function todayLocal(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const hydrated = ref(false);
const today = ref(todayLocal());
const view = ref<View>('month');
const anchor = ref(today.value); // month for «Месяц», first day for «Повестка»
const ownerFilter = ref<'all' | 'mine'>('all');
const showPlans = ref(true);
const items = ref<CalendarFeedItem[]>([]);
// True while the main feed request for the current period is in flight.
const loading = ref(false);
const loadError = ref(false);
const loadingMore = ref(false);
let agendaTo = '';
let request = 0;

const activeMemberIds = computed(() => new Set(members.value.map((member) => member.userId)));
const month = computed(() => anchor.value.slice(0, 7));
const range = computed(() =>
  view.value === 'month' ? monthRange(month.value) : agendaRange(anchor.value),
);
const title = computed(() =>
  view.value === 'month' ? monthTitle(month.value) : agendaTitle(range.value),
);

function feedQuery(span: { from: string; to: string }) {
  return {
    ...span,
    participantUserId: ownerFilter.value === 'mine' ? (userId.value ?? undefined) : undefined,
    includePlans: showPlans.value,
  };
}

async function load(): Promise<void> {
  if (!budget.value) return;
  const mine = request + 1;
  request = mine;
  loading.value = true;
  loadError.value = false;
  // Nothing may be appended to the old period while the new one loads.
  agendaTo = '';
  const span = range.value;
  try {
    const response = await calendar.feed(budget.value.id, feedQuery(span));
    if (mine !== request) return;
    items.value = response.items;
    agendaTo = span.to;
  } catch {
    if (mine === request) loadError.value = true;
  } finally {
    if (mine === request) loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  if (!budget.value || loading.value || loadingMore.value || !agendaTo) return;
  const mine = request;
  const base = agendaTo;
  const span = { from: addIsoDays(agendaTo, 1), to: addIsoDays(agendaTo, 14) };
  loadingMore.value = true;
  try {
    const response = await calendar.feed(budget.value.id, feedQuery(span));
    // Appended only onto the same period it was asked for.
    if (mine !== request || agendaTo !== base) return;
    items.value = [...items.value, ...response.items];
    agendaTo = span.to;
  } catch {
    if (mine === request) {
      push({ tone: 'error', title: 'Не удалось загрузить события. Повторите попытку.' });
    }
  } finally {
    loadingMore.value = false;
  }
}

const pageEl = ref<HTMLElement | null>(null);

// A reload after a mutation re-renders the list, so the row (or dialog trigger) that had focus
// may be gone; focus then moves to the period heading instead of falling to the page body.
async function reloadKeepingFocus(): Promise<void> {
  await load();
  await nextTick();
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  pageEl.value?.querySelector<HTMLElement>('[data-testid="calendar-period"]')?.focus();
}

onMounted(() => {
  const queryView = route.query.view;
  view.value =
    queryView === 'month' || queryView === 'agenda'
      ? queryView
      : window.innerWidth >= 1024
        ? 'month'
        : 'agenda';
  anchor.value = isIsoDate(route.query.date) ? route.query.date : today.value;
  // Registered after the initial values so the first load runs once.
  watch([view, anchor, ownerFilter, showPlans], () => void load());
  watch([view, anchor], ([nextView, date]) => {
    void navigateTo({ query: { view: nextView, date } }, { replace: true });
  });
  void loadMembers();
  void load();
  hydrated.value = true;
});

function previous(): void {
  anchor.value =
    view.value === 'month' ? `${shiftMonth(month.value, -1)}-01` : addIsoDays(anchor.value, -14);
}

function next(): void {
  anchor.value =
    view.value === 'month' ? `${shiftMonth(month.value, 1)}-01` : addIsoDays(anchor.value, 14);
}

function goToday(): void {
  today.value = todayLocal();
  anchor.value = today.value;
}

// Day panel
const dayDate = ref<string | null>(null);
const dayItems = computed(() =>
  dayDate.value ? (groupByDay(items.value).get(dayDate.value) ?? []) : [],
);

function openDay(date: string): void {
  dayDate.value = date;
}

// Event card. Only one dialog is open at a time: the next one replaces the current.
const selectedEvent = ref<CalendarEventDto | null>(null);
const eventOpen = ref(false);
let eventRequest = 0;

function problemDetail(error: ApiRequestError, fallback: string): string {
  return error.problem.detail || fallback;
}

async function openEvent(item: CalendarFeedEventItem): Promise<void> {
  if (!budget.value) return;
  dayDate.value = null;
  const mine = eventRequest + 1;
  eventRequest = mine;
  try {
    const event = await calendar.getEvent(budget.value.id, item.eventId);
    if (mine !== eventRequest) return;
    selectedEvent.value = event;
    eventOpen.value = true;
  } catch (error) {
    if (mine !== eventRequest) return;
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
      push({ tone: 'error', title: UNAVAILABLE });
      void reloadKeepingFocus();
    } else {
      push({ tone: 'error', title: OPEN_FAILED });
    }
  }
}

function closeEvent(): void {
  if (deleting.value) return;
  eventOpen.value = false;
}

// Payment card
const selectedPlan = ref<CalendarFeedPlanItem | null>(null);
const planOpen = ref(false);

function openPlan(item: CalendarFeedPlanItem): void {
  dayDate.value = null;
  selectedPlan.value = item;
  planOpen.value = true;
}

// Event form
const formOpen = ref(false);
const formMode = ref<'create' | 'edit'>('create');
const formInitial = ref<EventFormState>(emptyForm(today.value));
const formerParticipants = ref<readonly PersonRef[]>([]);
const editingId = ref<string | null>(null);
const pending = ref(false);
const serverErrors = ref<Record<string, string>>({});
// One key per attempt: a retry after a network error resends the same key so the server
// cannot create the event twice; a new opening of the form starts a new attempt.
let idempotencyKey = '';

function openForm(mode: 'create' | 'edit', initial: EventFormState): void {
  formMode.value = mode;
  formInitial.value = initial;
  serverErrors.value = {};
  idempotencyKey = crypto.randomUUID();
  formOpen.value = true;
}

function openCreate(date?: string): void {
  dayDate.value = null;
  editingId.value = null;
  formerParticipants.value = [];
  openForm('create', emptyForm(date ?? (view.value === 'agenda' ? anchor.value : today.value)));
}

function openEdit(): void {
  const event = selectedEvent.value;
  if (!event) return;
  eventOpen.value = false;
  editingId.value = event.id;
  formerParticipants.value = event.participants;
  openForm('edit', fromEvent(event));
}

function closeForm(): void {
  if (pending.value) return;
  formOpen.value = false;
}

async function submit(input: CalendarEventInput): Promise<void> {
  if (!budget.value || pending.value) return;
  pending.value = true;
  serverErrors.value = {};
  try {
    if (formMode.value === 'edit' && editingId.value) {
      await calendar.updateEvent(budget.value.id, editingId.value, input, idempotencyKey);
    } else {
      await calendar.createEvent(budget.value.id, input, idempotencyKey);
    }
    formOpen.value = false;
    eventOpen.value = false;
    push({ tone: 'success', title: 'Событие сохранено' });
    void reloadKeepingFocus();
  } catch (error) {
    handleSaveError(error);
  } finally {
    pending.value = false;
  }
}

function handleSaveError(error: unknown): void {
  if (!(error instanceof ApiRequestError) || error.status >= 500) {
    // The request may have reached the server: keep the form and the same key for a retry.
    push({ tone: 'error', title: SAVE_FAILED });
    return;
  }
  // The server answered and stored nothing: a corrected attempt gets a fresh key.
  idempotencyKey = crypto.randomUUID();
  if (error.status === 403 || error.status === 404) {
    // Not the author any more, or the event or membership is gone: the list is out of date.
    push({ tone: 'error', title: problemDetail(error, UNAVAILABLE) });
    formOpen.value = false;
    eventOpen.value = false;
    void reloadKeepingFocus();
    return;
  }
  if (error.status === 422 && error.problem.code === 'PARTICIPANT_NOT_MEMBER') {
    serverErrors.value = { participantUserIds: error.problem.detail };
    return;
  }
  const fields = fieldErrorsFromProblem(error.problem);
  if (Object.keys(fields).length > 0) {
    serverErrors.value = fields;
    return;
  }
  push({ tone: 'error', title: problemDetail(error, SAVE_FAILED) });
}

// Delete
const deleting = ref(false);
let deleteAttempt: { eventId: string; key: string } | null = null;

async function deleteSelected(): Promise<void> {
  const event = selectedEvent.value;
  if (!budget.value || !event || deleting.value) return;
  // Same key only when retrying the same delete after a failed round trip.
  if (deleteAttempt?.eventId !== event.id) {
    deleteAttempt = { eventId: event.id, key: crypto.randomUUID() };
  }
  deleting.value = true;
  try {
    await calendar.deleteEvent(budget.value.id, event.id, deleteAttempt.key);
    deleteAttempt = null;
    deleting.value = false;
    eventOpen.value = false;
    push({ tone: 'success', title: 'Событие удалено' });
    void reloadKeepingFocus();
  } catch (error) {
    deleting.value = false;
    if (!(error instanceof ApiRequestError) || error.status >= 500) {
      push({ tone: 'error', title: DELETE_FAILED });
      return;
    }
    deleteAttempt = null;
    push({ tone: 'error', title: problemDetail(error, UNAVAILABLE) });
    if (error.status === 403 || error.status === 404) {
      eventOpen.value = false;
      void reloadKeepingFocus();
    }
  }
}
</script>

<template>
  <div v-if="hydrated" ref="pageEl" class="calendar-page" data-hydrated="true">
    <CalendarHeader
      :view="view"
      :title="title"
      :owner-filter="ownerFilter"
      :show-owner-filter="members.length > 1"
      :show-plans="showPlans"
      :can-create="canCreate"
      @update:view="view = $event"
      @update:owner-filter="ownerFilter = $event"
      @update:show-plans="showPlans = $event"
      @previous="previous"
      @next="next"
      @today="goToday"
      @create="openCreate()"
    />

    <UiEmptyState
      v-if="loadError"
      title="Календарь недоступен"
      description="Не удалось загрузить события. Проверьте соединение и повторите."
    >
      <template #action>
        <UiButton data-testid="calendar-retry" @click="reloadKeepingFocus">Повторить</UiButton>
      </template>
    </UiEmptyState>
    <div
      v-else-if="loading"
      class="calendar-page__loading"
      data-testid="calendar-loading"
      aria-busy="true"
    >
      <span class="calendar-page__sr-only" role="status">Загружаем события…</span>
      <UiSkeleton :variant="view === 'month' ? 'card' : 'row'" :count="view === 'month' ? 1 : 4" />
    </div>
    <CalendarMonthGrid
      v-else-if="view === 'month'"
      :month="month"
      :today="today"
      :items="items"
      @open-day="openDay"
    />
    <CalendarAgenda
      v-else
      :today="today"
      :items="items"
      :active-member-ids="activeMemberIds"
      :loading-more="loadingMore"
      @open-event="openEvent"
      @open-plan="openPlan"
      @more="loadMore"
    />

    <CalendarDayDialog
      :open="dayDate !== null"
      :date="dayDate ?? today"
      :items="dayItems"
      :active-member-ids="activeMemberIds"
      :can-create="canCreate"
      @close="dayDate = null"
      @open-event="openEvent"
      @open-plan="openPlan"
      @create="openCreate"
    />
    <CalendarEventDialog
      :open="eventOpen"
      :event="selectedEvent"
      :active-member-ids="activeMemberIds"
      :deleting="deleting"
      @close="closeEvent"
      @edit="openEdit"
      @delete="deleteSelected"
    />
    <CalendarPlanDialog :open="planOpen" :item="selectedPlan" @close="planOpen = false" />
    <CalendarEventForm
      :open="formOpen"
      :mode="formMode"
      :initial="formInitial"
      :members="members"
      :pending="pending"
      :server-errors="serverErrors"
      :former-participants="formerParticipants"
      @close="closeForm"
      @submit="submit"
    />
  </div>
</template>

<style scoped>
.calendar-page {
  display: grid;
  gap: var(--hf-space-5);
  max-width: 70rem;
  min-width: 0;
  margin: 0 auto;
  padding: var(--hf-space-8);
}

.calendar-page > * {
  min-width: 0;
}

.calendar-page__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 47.9375rem) {
  .calendar-page {
    gap: var(--hf-space-4);
    padding: var(--hf-space-4);
  }
}
</style>
