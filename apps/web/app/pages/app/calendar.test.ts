import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import type {
  CalendarEventDto,
  CalendarFeedEventItem,
  CalendarFeedItem,
  CalendarFeedPlanItem,
} from '../../composables/useFamilyCalendar.js';

const { route, navigateTo, auth } = vi.hoisted(() => ({
  route: { path: '/app/calendar', query: {} as Record<string, string> },
  navigateTo: vi.fn(),
  auth: {
    currentData: {
      value: {
        activeWorkspaceId: 'workspace-id',
        workspaces: [
          {
            id: 'workspace-id',
            role: 'OWNER',
            isCreator: true,
            budgets: [{ id: 'budget-id', name: 'Бюджет', primaryCurrency: 'RUB' }],
          },
        ],
      },
    },
    currentUser: { value: { id: 'user-id' } },
  },
}));

const calendar = {
  feed: vi.fn(),
  getEvent: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
};
const member = (userId: string, displayName: string) => ({
  membershipId: `m-${userId}`,
  userId,
  email: `${userId}@example.test`,
  displayName,
  role: 'EDITOR',
  isCreator: false,
  joinedAt: '2026-10-01T00:00:00Z',
});
const family = {
  members: ref([member('user-id', 'Ильдар'), member('alia-id', 'Алия')]),
  load: vi.fn(),
};

vi.mock('#imports', () => ({
  definePageMeta: vi.fn(),
  navigateTo,
  useRoute: () => route,
}));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));
vi.mock('../../composables/useFamily.js', () => ({ useFamily: () => family }));
vi.mock('../../composables/useFamilyCalendar.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useFamilyCalendar: () => calendar,
}));

import { ApiRequestError } from '../../composables/useApiClient.js';
import { useToast } from '../../composables/useToast.js';
import CalendarPage from './calendar.vue';

const ildar = { userId: 'user-id', displayName: 'Ильдар', isActiveMember: true };
const alia = { userId: 'alia-id', displayName: 'Алия', isActiveMember: true };

const breakfast: CalendarFeedEventItem = {
  kind: 'EVENT',
  eventId: 'event-1',
  occurrenceDate: '2026-10-30',
  title: 'Семейный завтрак',
  allDay: false,
  startDate: '2026-10-30',
  endDate: '2026-10-30',
  startTime: '09:30',
  endTime: '10:30',
  startsAt: null,
  endsAt: null,
  recurrence: 'NONE',
  participants: [ildar, alia],
  createdBy: ildar,
  canEdit: true,
};
const rent: CalendarFeedPlanItem = {
  kind: 'PLAN',
  occurrenceId: 'occurrence-1',
  planId: 'plan-1',
  planKind: 'OBLIGATION',
  title: 'Аренда',
  amountMinor: '4500000',
  status: 'DUE',
  isOverdue: false,
  scheduledOn: '2026-10-30',
  owner: ildar,
};
const later: CalendarFeedEventItem = {
  ...breakfast,
  eventId: 'event-2',
  title: 'Поездка за город',
  occurrenceDate: '2026-11-15',
  startDate: '2026-11-15',
  endDate: '2026-11-15',
};
const breakfastDto: CalendarEventDto = {
  id: 'event-1',
  title: 'Семейный завтрак',
  description: null,
  allDay: false,
  date: '2026-10-30',
  endDate: '2026-10-30',
  startTime: '09:30',
  endTime: '10:30',
  recurrence: 'NONE',
  interval: 1,
  weekdays: [],
  repeatUntil: null,
  reminderMinutes: null,
  participants: [ildar, alia],
  createdBy: ildar,
  canEdit: true,
  createdAt: '2026-10-29T09:00:00Z',
  updatedAt: '2026-10-29T09:00:00Z',
};
const input = {
  title: 'Кружок',
  description: null,
  allDay: false,
  date: '2026-10-30',
  endDate: null,
  startTime: '17:00',
  endTime: '18:00',
  recurrence: 'NONE' as const,
  interval: 1,
  weekdays: [],
  repeatUntil: null,
  participantUserIds: ['user-id'],
  reminderMinutes: null,
};

const feedOf = (items: CalendarFeedItem[]) => ({ from: '', to: '', items });

// The form and the event card have their own tests; here they only expose what the page passes
// down and emit what the page reacts to.
const FormStub = {
  name: 'CalendarEventForm',
  props: {
    open: Boolean,
    mode: String,
    initial: Object,
    members: Array,
    pending: Boolean,
    serverErrors: Object,
    formerParticipants: Array,
  },
  emits: ['close', 'submit'],
  setup: () => ({ input }),
  template: `<div v-if="open" data-testid="form-stub" :data-mode="mode">
    <span data-testid="form-errors">{{ JSON.stringify(serverErrors) }}</span>
    <span data-testid="form-date">{{ initial?.date }}</span>
    <button data-testid="form-submit" @click="$emit('submit', input)" />
    <button data-testid="form-close" @click="$emit('close')" />
  </div>`,
};
const EventDialogStub = {
  name: 'CalendarEventDialog',
  props: { open: Boolean, event: Object, activeMemberIds: Set, deleting: Boolean },
  emits: ['close', 'edit', 'delete'],
  template: `<div v-if="open && event" data-testid="event-stub">
    <span>{{ event.title }}</span>
    <button data-testid="event-edit" @click="$emit('edit')" />
    <button data-testid="event-delete" @click="$emit('delete')" />
  </div>`,
};

const wrappers: VueWrapper[] = [];
async function mountPage() {
  const wrapper = mount(CalendarPage, {
    attachTo: document.body,
    global: {
      stubs: {
        teleport: true,
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        CalendarEventForm: FormStub,
        CalendarEventDialog: EventDialogStub,
      },
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

const network = () => new TypeError('Failed to fetch');
const lastToast = () => useToast().toasts.value.at(-1);

describe('calendar page', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T09:00:00Z'));
    vi.clearAllMocks();
    useToast().clear();
    route.query = {};
    window.innerWidth = 1280;
    auth.currentData.value.workspaces[0]!.role = 'OWNER';
    family.members.value = [member('user-id', 'Ильдар'), member('alia-id', 'Алия')];
    calendar.feed.mockResolvedValue(feedOf([breakfast, rent]));
    calendar.getEvent.mockResolvedValue(breakfastDto);
    calendar.createEvent.mockResolvedValue(breakfastDto);
    calendar.updateEvent.mockResolvedValue(breakfastDto);
    calendar.deleteEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    while (wrappers.length > 0) wrappers.pop()?.unmount();
    vi.useRealTimers();
  });

  it('opens the month on a wide screen and marks itself hydrated', async () => {
    const wrapper = await mountPage();
    expect(wrapper.get('.calendar-page').attributes('data-hydrated')).toBe('true');
    expect(calendar.feed).toHaveBeenCalledTimes(1);
    expect(calendar.feed).toHaveBeenCalledWith('budget-id', {
      from: '2026-09-28',
      to: '2026-11-01',
      participantUserId: undefined,
      includePlans: true,
    });
    expect(wrapper.get('[data-testid="calendar-period"]').text()).toBe('Октябрь 2026');
    expect(family.load).toHaveBeenCalled();
  });

  it('opens the agenda on a phone and loads the next 14 days on request', async () => {
    window.innerWidth = 390;
    const wrapper = await mountPage();
    expect(calendar.feed).toHaveBeenLastCalledWith(
      'budget-id',
      expect.objectContaining({ from: '2026-10-30', to: '2026-11-12' }),
    );
    expect(wrapper.get('[data-testid="calendar-period"]').text()).toBe('30 окт – 12 ноя');

    calendar.feed.mockResolvedValueOnce(feedOf([later]));
    await wrapper.get('[data-testid="agenda-more"]').trigger('click');
    await flushPromises();
    expect(calendar.feed).toHaveBeenLastCalledWith(
      'budget-id',
      expect.objectContaining({ from: '2026-11-13', to: '2026-11-26' }),
    );
    expect(wrapper.find('[data-testid="agenda-item-event-1"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="agenda-item-event-2"]').exists()).toBe(true);
  });

  it('respects the view and date from the query', async () => {
    route.query = { view: 'agenda', date: '2026-11-03' };
    const wrapper = await mountPage();
    expect(calendar.feed).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({ from: '2026-11-03', to: '2026-11-16' }),
    );
    expect(wrapper.find('[data-testid="agenda-more"]').exists()).toBe(true);
  });

  it('ignores an invalid date in the query', async () => {
    route.query = { view: 'month', date: '2026-13-45' };
    await mountPage();
    expect(calendar.feed).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({ from: '2026-09-28', to: '2026-11-01' }),
    );
  });

  it('moves between months, back to today, and keeps the query in sync', async () => {
    const wrapper = await mountPage();
    await wrapper.get('[aria-label="Следующий период"]').trigger('click');
    await flushPromises();
    expect(calendar.feed).toHaveBeenLastCalledWith(
      'budget-id',
      expect.objectContaining({ from: '2026-10-26', to: '2026-12-06' }),
    );
    expect(wrapper.get('[data-testid="calendar-period"]').text()).toBe('Ноябрь 2026');
    expect(navigateTo).toHaveBeenLastCalledWith(
      { query: { view: 'month', date: '2026-11-01' } },
      { replace: true },
    );

    await wrapper.get('[data-testid="calendar-today"]').trigger('click');
    await flushPromises();
    expect(calendar.feed).toHaveBeenLastCalledWith(
      'budget-id',
      expect.objectContaining({ from: '2026-09-28', to: '2026-11-01' }),
    );
    expect(wrapper.get('[data-testid="calendar-period"]').text()).toBe('Октябрь 2026');
  });

  it('moves the agenda by 14 days', async () => {
    window.innerWidth = 390;
    const wrapper = await mountPage();
    await wrapper.get('[aria-label="Предыдущий период"]').trigger('click');
    await flushPromises();
    expect(calendar.feed).toHaveBeenLastCalledWith(
      'budget-id',
      expect.objectContaining({ from: '2026-10-16', to: '2026-10-29' }),
    );
  });

  it('filters by «Мои» and hides payments', async () => {
    const wrapper = await mountPage();
    await wrapper.get('[data-testid="calendar-owner-mine"]').trigger('click');
    await flushPromises();
    expect(calendar.feed).toHaveBeenLastCalledWith(
      'budget-id',
      expect.objectContaining({ participantUserId: 'user-id', includePlans: true }),
    );

    await wrapper.get('[data-testid="calendar-plans-toggle"]').trigger('click');
    await flushPromises();
    expect(calendar.feed).toHaveBeenLastCalledWith(
      'budget-id',
      expect.objectContaining({ participantUserId: 'user-id', includePlans: false }),
    );
  });

  it('hides the owner filter for a one-person family', async () => {
    family.members.value = [member('user-id', 'Ильдар')];
    const wrapper = await mountPage();
    expect(wrapper.find('[data-testid="calendar-owner-mine"]').exists()).toBe(false);
  });

  it('has no «Новое событие» for a viewer', async () => {
    auth.currentData.value.workspaces[0]!.role = 'VIEWER';
    const wrapper = await mountPage();
    expect(wrapper.find('[data-testid="calendar-create"]').exists()).toBe(false);
  });

  it('creates an event with one idempotency key per attempt', async () => {
    const wrapper = await mountPage();
    await wrapper.get('[data-testid="calendar-create"]').trigger('click');
    expect(wrapper.get('[data-testid="form-stub"]').attributes('data-mode')).toBe('create');
    expect(wrapper.get('[data-testid="form-date"]').text()).toBe('2026-10-30');

    calendar.createEvent.mockRejectedValueOnce(network());
    await wrapper.get('[data-testid="form-submit"]').trigger('click');
    await flushPromises();
    expect(lastToast()?.title).toBe('Не удалось сохранить событие. Повторите попытку.');
    expect(wrapper.find('[data-testid="form-stub"]').exists()).toBe(true);
    const firstKey = calendar.createEvent.mock.calls[0]?.[2] as string;
    expect(firstKey).toMatch(/[0-9a-f-]{36}/);

    calendar.feed.mockClear();
    await wrapper.get('[data-testid="form-submit"]').trigger('click');
    await flushPromises();
    expect(calendar.createEvent).toHaveBeenLastCalledWith('budget-id', input, firstKey);
    expect(lastToast()).toMatchObject({ tone: 'success', title: 'Событие сохранено' });
    expect(wrapper.find('[data-testid="form-stub"]').exists()).toBe(false);
    expect(calendar.feed).toHaveBeenCalledTimes(1);

    await wrapper.get('[data-testid="calendar-create"]').trigger('click');
    await wrapper.get('[data-testid="form-submit"]').trigger('click');
    await flushPromises();
    expect(calendar.createEvent.mock.calls[2]?.[2]).not.toBe(firstKey);
  });

  it('shows server field errors in the form and keeps it open', async () => {
    const wrapper = await mountPage();
    await wrapper.get('[data-testid="calendar-create"]').trigger('click');
    calendar.createEvent.mockRejectedValueOnce(
      new ApiRequestError(400, {
        code: 'VALIDATION_FAILED',
        detail: 'Проверьте поля.',
        fieldErrors: [{ field: 'title', message: 'Введите название.', code: 'too_small' }],
      }),
    );
    await wrapper.get('[data-testid="form-submit"]').trigger('click');
    await flushPromises();
    expect(JSON.parse(wrapper.get('[data-testid="form-errors"]').text())).toEqual({
      title: 'Введите название.',
    });

    calendar.createEvent.mockRejectedValueOnce(
      new ApiRequestError(422, {
        code: 'PARTICIPANT_NOT_MEMBER',
        detail: 'Участник больше не в семье.',
      }),
    );
    await wrapper.get('[data-testid="form-submit"]').trigger('click');
    await flushPromises();
    expect(JSON.parse(wrapper.get('[data-testid="form-errors"]').text())).toEqual({
      participantUserIds: 'Участник больше не в семье.',
    });
    expect(wrapper.find('[data-testid="form-stub"]').exists()).toBe(true);
  });

  it('opens an event from the agenda, edits and deletes it', async () => {
    window.innerWidth = 390;
    const wrapper = await mountPage();
    await wrapper.get('[data-testid="agenda-item-event-1"] button').trigger('click');
    await flushPromises();
    expect(calendar.getEvent).toHaveBeenCalledWith('budget-id', 'event-1');
    expect(wrapper.get('[data-testid="event-stub"]').text()).toContain('Семейный завтрак');

    await wrapper.get('[data-testid="event-edit"]').trigger('click');
    const form = wrapper.getComponent(FormStub);
    expect(form.props('mode')).toBe('edit');
    expect(form.props('initial')).toMatchObject({ title: 'Семейный завтрак', startTime: '09:30' });
    expect(form.props('formerParticipants')).toEqual([ildar, alia]);
    await wrapper.get('[data-testid="form-submit"]').trigger('click');
    await flushPromises();
    expect(calendar.updateEvent).toHaveBeenCalledWith(
      'budget-id',
      'event-1',
      input,
      expect.any(String),
    );
    expect(lastToast()?.title).toBe('Событие сохранено');

    await wrapper.get('[data-testid="agenda-item-event-1"] button').trigger('click');
    await flushPromises();
    calendar.feed.mockClear();
    await wrapper.get('[data-testid="event-delete"]').trigger('click');
    await flushPromises();
    expect(calendar.deleteEvent).toHaveBeenCalledWith('budget-id', 'event-1', expect.any(String));
    expect(lastToast()?.title).toBe('Событие удалено');
    expect(wrapper.find('[data-testid="event-stub"]').exists()).toBe(false);
    expect(calendar.feed).toHaveBeenCalledTimes(1);
  });

  it('reuses the delete key after a network error', async () => {
    window.innerWidth = 390;
    const wrapper = await mountPage();
    await wrapper.get('[data-testid="agenda-item-event-1"] button').trigger('click');
    await flushPromises();
    calendar.deleteEvent.mockRejectedValueOnce(network());
    await wrapper.get('[data-testid="event-delete"]').trigger('click');
    await flushPromises();
    expect(lastToast()?.title).toBe('Не удалось удалить событие. Повторите попытку.');
    expect(wrapper.find('[data-testid="event-stub"]').exists()).toBe(true);

    await wrapper.get('[data-testid="event-delete"]').trigger('click');
    await flushPromises();
    const [first, second] = calendar.deleteEvent.mock.calls.map((call) => call[2]);
    expect(second).toBe(first);
  });

  it('tells about a vanished event when it cannot be opened', async () => {
    window.innerWidth = 390;
    const wrapper = await mountPage();
    calendar.feed.mockClear();
    calendar.getEvent.mockRejectedValueOnce(
      new ApiRequestError(404, { code: 'RESOURCE_NOT_FOUND', detail: 'Не найдено.' }),
    );
    await wrapper.get('[data-testid="agenda-item-event-1"] button').trigger('click');
    await flushPromises();
    expect(lastToast()?.title).toBe('Событие удалено или недоступно');
    expect(wrapper.find('[data-testid="event-stub"]').exists()).toBe(false);
    expect(calendar.feed).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, 'NOT_EVENT_AUTHOR', 'Изменять событие может только автор.'],
    [404, 'RESOURCE_NOT_FOUND', 'Событие не найдено.'],
  ])('closes the form on %i %s and reloads the feed', async (status, code, detail) => {
    window.innerWidth = 390;
    const wrapper = await mountPage();
    await wrapper.get('[data-testid="agenda-item-event-1"] button').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="event-edit"]').trigger('click');
    calendar.feed.mockClear();
    calendar.updateEvent.mockRejectedValueOnce(new ApiRequestError(status, { code, detail }));
    await wrapper.get('[data-testid="form-submit"]').trigger('click');
    await flushPromises();
    expect(lastToast()).toMatchObject({ tone: 'error', title: detail });
    expect(wrapper.find('[data-testid="form-stub"]').exists()).toBe(false);
    expect(calendar.feed).toHaveBeenCalledTimes(1);
  });

  it('opens a day from the month and creates an event on that day', async () => {
    const wrapper = await mountPage();
    await wrapper.get('[data-date="2026-10-30"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Пятница, 30 октября');
    expect(wrapper.find('[data-testid="day-item-event-1"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="day-item-occurrence-1"]').exists()).toBe(true);
    await wrapper.get('[data-testid="day-create"]').trigger('click');
    expect(wrapper.get('[data-testid="form-date"]').text()).toBe('2026-10-30');
  });

  it('opens an event from the day panel instead of stacking dialogs', async () => {
    const wrapper = await mountPage();
    await wrapper.get('[data-date="2026-10-30"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="day-item-event-1"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="day-item-event-1"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="event-stub"]').text()).toContain('Семейный завтрак');
  });

  it('shows a payment card from the agenda', async () => {
    window.innerWidth = 390;
    const wrapper = await mountPage();
    await wrapper.get('[data-testid="agenda-item-occurrence-1"] button').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="calendar-plan-link"]').attributes('href')).toBe(
      '/app/plans?occurrence=occurrence-1',
    );
  });

  it('shows an empty state with a retry when the feed fails', async () => {
    calendar.feed.mockRejectedValueOnce(network());
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('Календарь недоступен');
    expect(wrapper.text()).toContain(
      'Не удалось загрузить события. Проверьте соединение и повторите.',
    );

    await wrapper.get('[data-testid="calendar-retry"]').trigger('click');
    await flushPromises();
    expect(calendar.feed).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).not.toContain('Календарь недоступен');
  });

  it('shows a busy skeleton instead of old items while a period loads', async () => {
    const wrapper = await mountPage();
    const pending = deferred<ReturnType<typeof feedOf>>();
    calendar.feed.mockReturnValueOnce(pending.promise);
    await wrapper.get('[aria-label="Следующий период"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="calendar-loading"]').attributes('aria-busy')).toBe('true');
    expect(wrapper.find('[data-date="2026-10-30"]').exists()).toBe(false);

    pending.resolve(feedOf([later]));
    await flushPromises();
    expect(wrapper.find('[data-testid="calendar-loading"]').exists()).toBe(false);
    expect(wrapper.find('[data-date="2026-11-15"]').exists()).toBe(true);
  });

  it('offers no «Показать ещё» while the agenda reloads after a view switch', async () => {
    const wrapper = await mountPage();
    const pending = deferred<ReturnType<typeof feedOf>>();
    calendar.feed.mockReturnValueOnce(pending.promise);
    await wrapper.get('[data-testid="calendar-view-agenda"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="agenda-more"]').exists()).toBe(false);
    expect(calendar.feed).toHaveBeenCalledTimes(2);

    pending.resolve(feedOf([breakfast]));
    await flushPromises();
    expect(calendar.feed).toHaveBeenLastCalledWith(
      'budget-id',
      expect.objectContaining({ from: '2026-10-30', to: '2026-11-12' }),
    );
    expect(wrapper.findAll('[data-testid="agenda-item-event-1"]')).toHaveLength(1);
  });

  it('drops a «Показать ещё» result when the period changed meanwhile', async () => {
    window.innerWidth = 390;
    const wrapper = await mountPage();
    const more = deferred<ReturnType<typeof feedOf>>();
    calendar.feed.mockReturnValueOnce(more.promise);
    await wrapper.get('[data-testid="agenda-more"]').trigger('click');
    calendar.feed.mockResolvedValueOnce(feedOf([breakfast]));
    await wrapper.get('[data-testid="calendar-today"]').trigger('click');
    await wrapper.get('[aria-label="Следующий период"]').trigger('click');
    await flushPromises();

    more.resolve(feedOf([later]));
    await flushPromises();
    expect(wrapper.find('[data-testid="agenda-item-event-2"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="agenda-item-event-1"]')).toHaveLength(1);
  });

  it('moves focus to the period title when a reload removed the focused row', async () => {
    window.innerWidth = 390;
    const wrapper = await mountPage();
    await wrapper.get('[data-testid="agenda-item-event-1"] button').trigger('click');
    await flushPromises();
    calendar.feed.mockResolvedValueOnce(feedOf([rent]));
    (wrapper.get('[data-testid="event-delete"]').element as HTMLElement).focus();
    await wrapper.get('[data-testid="event-delete"]').trigger('click');
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.get('[data-testid="calendar-period"]').element);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
