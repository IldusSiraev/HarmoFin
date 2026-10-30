import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import type { CalendarEventDto } from '../../composables/useFamilyCalendar.js';
import CalendarEventDialog from './CalendarEventDialog.vue';

const alia = { userId: 'a', displayName: 'Алия', isActiveMember: true };
const ildar = { userId: 'i', displayName: 'Ильдар', isActiveMember: true };
const timur = { userId: 't', displayName: 'Тимур', isActiveMember: false };

const circle: CalendarEventDto = {
  id: 'e1',
  title: 'Кружок рисования',
  description: 'Взять альбом',
  allDay: false,
  date: '2026-11-03',
  endDate: '2026-11-03',
  startTime: '17:00',
  endTime: '18:30',
  recurrence: 'WEEKLY',
  interval: 1,
  weekdays: [2],
  repeatUntil: '2026-12-29',
  reminderMinutes: 60,
  participants: [alia, ildar],
  createdBy: ildar,
  canEdit: true,
  createdAt: '2026-10-30T09:00:00Z',
  updatedAt: '2026-10-30T09:00:00Z',
};

const confirmStub = {
  UiConfirmDialog: {
    props: ['open', 'title', 'description', 'confirmLabel', 'cancelLabel', 'variant', 'loading'],
    emits: ['confirm', 'cancel'],
    template:
      '<div v-if="open" data-testid="confirm"><p>{{ title }}</p><p>{{ description }}</p><button data-testid="confirm-yes" @click="$emit(\'confirm\')">{{ confirmLabel }}</button><button data-testid="confirm-no" @click="$emit(\'cancel\')">{{ cancelLabel }}</button></div>',
  },
};

const wrappers: Array<{ unmount: () => void }> = [];
function mountDialog(event: CalendarEventDto = circle, props: Record<string, unknown> = {}) {
  const wrapper = mount(CalendarEventDialog, {
    props: {
      open: true,
      event,
      // A third member keeps the participants from being labelled «Вся семья».
      activeMemberIds: new Set(['a', 'i', 'z']),
      deleting: false,
      ...props,
    },
    attachTo: document.body,
    global: { stubs: { teleport: true, ...confirmStub } },
  });
  wrappers.push(wrapper);
  return wrapper;
}

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount();
  document.body.innerHTML = '';
});

describe('CalendarEventDialog', () => {
  it('lets the author edit and delete after confirmation', async () => {
    const wrapper = mountDialog();
    expect(wrapper.get('.modal__title').text()).toBe('Кружок рисования');

    const edit = wrapper.get('[data-testid="calendar-event-edit"]');
    expect(edit.attributes('aria-label')).toBe('Изменить событие');
    expect(edit.text()).toBe('');
    await edit.trigger('click');
    expect(wrapper.emitted('edit')).toHaveLength(1);

    const menu = wrapper.get('[data-testid="calendar-event-menu"]');
    expect(menu.attributes('aria-label')).toBe('Действия с событием');
    await menu.trigger('click');
    const remove = wrapper.get('[data-testid="calendar-event-delete"]');
    expect(remove.text()).toBe('Удалить');
    await remove.trigger('click');

    const confirm = wrapper.get('[data-testid="confirm"]');
    expect(confirm.text()).toContain('Удалить событие и все его повторы?');
    expect(confirm.text()).toContain('Уже созданные напоминания останутся в центре уведомлений.');
    expect(wrapper.emitted('delete')).toBeUndefined();
    await wrapper.get('[data-testid="confirm-yes"]').trigger('click');
    expect(wrapper.emitted('delete')).toHaveLength(1);
  });

  it('cancels the deletion without emitting and returns focus to the menu', async () => {
    const wrapper = mountDialog();
    await wrapper.get('[data-testid="calendar-event-menu"]').trigger('click');
    await wrapper.get('[data-testid="calendar-event-delete"]').trigger('click');
    (wrapper.get('[data-testid="confirm-no"]').element as HTMLElement).focus();
    await wrapper.get('[data-testid="confirm-no"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="confirm"]').exists()).toBe(false);
    expect(wrapper.emitted('delete')).toBeUndefined();
    expect(document.activeElement).toBe(wrapper.get('[data-testid="calendar-event-menu"]').element);
  });

  it('shows no actions on someone else’s event and names the author', () => {
    const wrapper = mountDialog({ ...circle, canEdit: false, createdBy: alia });
    expect(wrapper.find('[data-testid="calendar-event-edit"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="calendar-event-menu"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="calendar-event-readonly"]').text()).toBe(
      'Автор: Алия. Изменять событие может только автор',
    );
    expect(wrapper.find('[data-testid="modal-close"]').exists()).toBe(true);
  });

  it('describes the repeat, participants, reminder, author and description', () => {
    const wrapper = mountDialog();
    const when = wrapper.get('[data-testid="calendar-event-when"]').text();
    expect(when).toContain('Каждый вторник, 17:00–18:30');
    expect(when).toContain('Повторяется до 29 декабря');
    const people = wrapper.get('[data-testid="calendar-event-participants"]').text();
    expect(people).toContain('Алия, Ильдар');
    expect(people).toContain('Участники');
    const reminder = wrapper.get('[data-testid="calendar-event-reminder"]').text();
    expect(reminder).toContain('За 1 час');
    expect(reminder).toContain('Напоминание');
    expect(wrapper.get('[data-testid="calendar-event-author"]').text()).toBe('Автор: Ильдар');
    expect(wrapper.text()).toContain('Описание');
    expect(wrapper.get('[data-testid="calendar-event-description"]').text()).toBe('Взять альбом');
  });

  it('shows the date and time of a one-off event without a reminder', () => {
    const wrapper = mountDialog({
      ...circle,
      recurrence: 'NONE',
      weekdays: [],
      repeatUntil: null,
      reminderMinutes: null,
      participants: [],
      description: null,
    });
    expect(wrapper.get('[data-testid="calendar-event-when"]').text()).toBe('3 ноября, 17:00–18:30');
    expect(wrapper.find('[data-testid="calendar-event-participants"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="calendar-event-reminder"]').text()).toContain(
      'Без напоминания',
    );
    expect(wrapper.text()).not.toContain('Описание');
  });

  it('marks an author who left the family', () => {
    const wrapper = mountDialog({ ...circle, createdBy: timur, canEdit: false });
    expect(wrapper.text()).toContain('Автор: Тимур (не в семье)');
  });

  it('closes from the header', async () => {
    const wrapper = mountDialog();
    await wrapper.get('[data-testid="modal-close"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
