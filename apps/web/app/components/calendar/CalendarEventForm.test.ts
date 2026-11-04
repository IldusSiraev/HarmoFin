import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import type { Member } from '../../composables/useFamily.js';
import { emptyForm, toInput, type EventFormState } from './event-form-state.js';
import CalendarEventForm from './CalendarEventForm.vue';

function member(userId: string, displayName: string | null, email: string): Member {
  return {
    membershipId: `m-${userId}`,
    userId,
    email,
    displayName,
    role: 'EDITOR',
    isCreator: false,
    joinedAt: '2026-01-01T00:00:00Z',
  };
}

const members = [member('a', 'Алия', 'alia@example.test'), member('z', null, 'zoya@example.test')];

const wrappers: Array<{ unmount: () => void }> = [];
function mountForm(props: Record<string, unknown> = {}) {
  const wrapper = mount(CalendarEventForm, {
    props: {
      open: true,
      mode: 'create',
      initial: emptyForm('2026-11-03'),
      members,
      pending: false,
      serverErrors: {},
      ...props,
    },
    attachTo: document.body,
    global: { stubs: { teleport: true } },
  });
  wrappers.push(wrapper);
  return wrapper;
}
type Wrapper = ReturnType<typeof mountForm>;

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount();
  document.body.innerHTML = '';
});

const submit = (wrapper: Wrapper) => wrapper.get('[data-testid="calendar-event-submit"]');

function selectByName(wrapper: Wrapper, name: string) {
  const select = wrapper
    .findAllComponents({ name: 'UiSelect' })
    .find((component) => component.props('name') === name);
  if (!select) throw new Error(`no select ${name}`);
  return select;
}

async function choose(wrapper: Wrapper, name: string, value: string) {
  selectByName(wrapper, name).vm.$emit('update:modelValue', value);
  await flushPromises();
}

function errorUnder(wrapper: Wrapper, inputId: string): string {
  return wrapper.get(`#${inputId}-error`).text();
}

describe('CalendarEventForm', () => {
  it('creates an event from the filled title', async () => {
    const wrapper = mountForm();
    expect(wrapper.get('.modal__title').text()).toBe('Новое событие');
    expect(submit(wrapper).text()).toBe('Сохранить событие');

    await wrapper.get('#calendarEventTitle-input').setValue('Кружок');
    await submit(wrapper).trigger('click');

    expect(wrapper.emitted('submit')?.[0]).toEqual([
      toInput({ ...emptyForm('2026-11-03'), title: 'Кружок' }),
    ]);
  });

  it('swaps the times for an end date when the event lasts all day', async () => {
    const wrapper = mountForm();
    const toggle = wrapper.get('[data-testid="calendar-event-all-day"]');
    expect(toggle.attributes('role')).toBe('switch');
    expect(toggle.attributes('aria-checked')).toBe('false');
    expect(wrapper.text()).toContain('Событие без времени начала и конца');
    expect(wrapper.get('#calendarEventStart-input').attributes('type')).toBe('time');
    expect(wrapper.get('#calendarEventStart-input').attributes('step')).toBe('300');
    expect(wrapper.find('#calendarEventEndDate-input').exists()).toBe(false);

    await toggle.trigger('click');

    expect(toggle.attributes('aria-checked')).toBe('true');
    expect(wrapper.find('#calendarEventStart-input').exists()).toBe(false);
    expect(wrapper.find('#calendarEventEnd-input').exists()).toBe(false);
    expect(wrapper.text()).toContain('Дата окончания');
  });

  it('shows weekday chips with the start day pressed for a weekly repeat', async () => {
    const wrapper = mountForm();
    expect(wrapper.find('[data-testid="calendar-event-repeat"]').exists()).toBe(false);
    expect(selectByName(wrapper, 'calendarEventRecurrence').props('options')).toEqual([
      { value: 'NONE', label: 'Не повторять' },
      { value: 'DAILY', label: 'Каждый день' },
      { value: 'WEEKLY', label: 'Каждую неделю' },
      { value: 'MONTHLY', label: 'Каждый месяц' },
      { value: 'YEARLY', label: 'Каждый год' },
    ]);

    await choose(wrapper, 'calendarEventRecurrence', 'WEEKLY');

    const block = wrapper.get('[data-testid="calendar-event-repeat"]');
    expect(block.get('legend').text()).toBe('Дни недели');
    const chips = block.findAll('[data-testid^="calendar-event-weekday-"]');
    expect(chips.map((chip) => chip.text())).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
    expect(chips.map((chip) => chip.attributes('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
      'false',
      'false',
      'false',
      'false',
    ]);
    // The pressed day is marked by an icon too, not only by colour.
    expect(chips.map((chip) => chip.find('[data-testid="weekday-check"]').exists())).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(block.text()).toContain('Повторять до');
    expect(block.text()).toContain('необязательно');

    await chips[3]!.trigger('click');
    await chips[1]!.trigger('click');
    await wrapper.get('#calendarEventTitle-input').setValue('Бассейн');
    await submit(wrapper).trigger('click');
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      recurrence: 'WEEKLY',
      weekdays: [4],
    });
  });

  it('keeps the event and shows field errors when the form is invalid', async () => {
    const wrapper = mountForm();
    await wrapper.get('#calendarEventStart-input').setValue('17:00');
    await wrapper.get('#calendarEventEnd-input').setValue('16:30');
    await submit(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(errorUnder(wrapper, 'calendarEventTitle-input')).toBe('Введите название.');
    expect(errorUnder(wrapper, 'calendarEventEnd-input')).toBe(
      'Конец не может быть раньше начала.',
    );
    expect(document.activeElement?.id).toBe('calendarEventTitle-input');
  });

  it('shows the server error under its field', () => {
    const wrapper = mountForm({ serverErrors: { endTime: 'Конец не может быть раньше начала.' } });
    expect(errorUnder(wrapper, 'calendarEventEnd-input')).toBe(
      'Конец не может быть раньше начала.',
    );
  });

  it('offers family members as participant chips with a check on the chosen ones', async () => {
    const wrapper = mountForm();
    const group = wrapper.get('#calendar-event-participants');
    expect(group.get('legend').text()).toBe('Участники');
    const alia = wrapper.get('[data-testid="calendar-event-participant-a"]');
    const zoya = wrapper.get('[data-testid="calendar-event-participant-z"]');
    expect(alia.text()).toBe('Алия');
    expect(zoya.text()).toBe('zoya@example.test');
    expect(alia.attributes('aria-pressed')).toBe('false');

    await alia.trigger('click');

    expect(alia.attributes('aria-pressed')).toBe('true');
    expect(alia.find('[data-testid="calendar-event-participant-check"]').exists()).toBe(true);
    expect(zoya.find('[data-testid="calendar-event-participant-check"]').exists()).toBe(false);
  });

  it('warns that former members will be removed from the participants', () => {
    const wrapper = mountForm({
      mode: 'edit',
      formerParticipants: [
        { userId: 'a', displayName: 'Алия', isActiveMember: true },
        { userId: 't', displayName: 'Тимур', isActiveMember: false },
      ],
    });
    expect(wrapper.get('#calendar-event-participants-hint').text()).toBe(
      'Тимур (не в семье) будет убран из участников при сохранении',
    );
  });

  const reminderChip = (wrapper: Wrapper, minutes: number) =>
    wrapper.get(`[data-testid="calendar-event-reminder-${minutes}"]`);

  it('offers reminder chips and keeps the description optional', async () => {
    const wrapper = mountForm();
    expect(wrapper.get('#calendar-event-reminders legend').text()).toBe('Напоминания');
    expect(
      wrapper.findAll('[data-testid^="calendar-event-reminder-"]').map((chip) => chip.text()),
    ).toEqual([
      'В момент начала',
      'За 5 мин',
      'За 15 мин',
      'За 30 мин',
      'За 1 час',
      'За 2 часа',
      'За 1 день',
      'За 2 дня',
      'За 1 неделю',
    ]);
    expect(wrapper.get('#calendar-event-reminders-hint').text()).toBe('Можно выбрать до трёх');
    expect(wrapper.get('label[for="calendarEventDescription-input"]').text()).toBe('Описание');
    expect(wrapper.get('#calendarEventDescription-hint').text()).toBe('необязательно');

    await reminderChip(wrapper, 1440).trigger('click');
    await reminderChip(wrapper, 60).trigger('click');
    expect(reminderChip(wrapper, 60).attributes('aria-pressed')).toBe('true');
    expect(
      reminderChip(wrapper, 60).find('[data-testid="calendar-event-reminder-check"]').exists(),
    ).toBe(true);
    expect(reminderChip(wrapper, 15).attributes('aria-pressed')).toBe('false');

    await wrapper.get('#calendarEventTitle-input').setValue('Врач');
    await wrapper.get('#calendarEventDescription-input').setValue(' Взять полис ');
    await submit(wrapper).trigger('click');
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      reminders: [60, 1440],
      description: 'Взять полис',
    });
  });

  it('allows three reminders, then disables the rest until one is unpressed', async () => {
    const wrapper = mountForm();
    for (const minutes of [0, 15, 60]) await reminderChip(wrapper, minutes).trigger('click');
    expect(wrapper.get('#calendar-event-reminders-hint').text()).toBe(
      'Выбрано три — снимите одно, чтобы выбрать другое',
    );
    expect(reminderChip(wrapper, 5).attributes('disabled')).toBeDefined();
    expect(reminderChip(wrapper, 60).attributes('disabled')).toBeUndefined();

    await reminderChip(wrapper, 15).trigger('click');
    expect(reminderChip(wrapper, 5).attributes('disabled')).toBeUndefined();
    expect(wrapper.get('#calendar-event-reminders-hint').text()).toBe('Можно выбрать до трёх');
  });

  it('explains the 09:00 start of reminders for an all-day event', async () => {
    const wrapper = mountForm({ initial: { ...emptyForm('2026-11-03'), allDay: true } });
    expect(wrapper.get('#calendar-event-reminders-hint').text()).toBe(
      'Можно выбрать до трёх. Отсчёт от 09:00 дня события',
    );
  });

  it('shows a server reminder error under the chips and keeps the edited reminders', () => {
    const wrapper = mountForm({
      mode: 'edit',
      initial: { ...emptyForm('2026-11-03'), title: 'Кружок', reminders: [5, 120] },
      serverErrors: { reminders: 'Выберите напоминание из списка.' },
    });
    expect(wrapper.get('#calendar-event-reminders-error').text()).toBe(
      'Выберите напоминание из списка.',
    );
    expect(wrapper.get('#calendar-event-reminders').attributes('aria-describedby')).toBe(
      'calendar-event-reminders-hint calendar-event-reminders-error',
    );
    expect(reminderChip(wrapper, 5).attributes('aria-pressed')).toBe('true');
    expect(reminderChip(wrapper, 120).attributes('aria-pressed')).toBe('true');
  });

  it('titles the edit mode and resets to the initial values on reopen', async () => {
    const initial: EventFormState = { ...emptyForm('2026-11-03'), title: 'Кружок' };
    const wrapper = mountForm({ mode: 'edit', initial });
    expect(wrapper.get('.modal__title').text()).toBe('Изменить событие');
    expect((wrapper.get('#calendarEventTitle-input').element as HTMLInputElement).value).toBe(
      'Кружок',
    );

    await wrapper.get('#calendarEventTitle-input').setValue('Другое');
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    expect((wrapper.get('#calendarEventTitle-input').element as HTMLInputElement).value).toBe(
      'Кружок',
    );
  });

  it('shows saving in progress and cancels with close', async () => {
    const wrapper = mountForm({ pending: true });
    await wrapper.get('#calendarEventTitle-input').setValue('Кружок');
    await submit(wrapper).trigger('click');
    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.findAllComponents({ name: 'UiButton' })[1]!.props('loading')).toBe(true);

    await wrapper.get('[data-testid="calendar-event-cancel"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
