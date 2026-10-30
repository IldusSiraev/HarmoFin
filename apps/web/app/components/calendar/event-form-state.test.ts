import { describe, expect, it } from 'vitest';

import { ApiRequestError } from '../../composables/useApiClient.js';
import type { CalendarEventDto } from '../../composables/useFamilyCalendar.js';
import {
  describeRecurrence,
  describeWhen,
  emptyForm,
  fieldErrorsFromProblem,
  formerParticipantsHint,
  fromEvent,
  toInput,
  validateForm,
} from './event-form-state.js';

describe('calendar event form', () => {
  it('starts on the given date with a one-hour slot and that weekday', () => {
    expect(emptyForm('2026-11-03')).toMatchObject({
      date: '2026-11-03',
      startTime: '09:00',
      endTime: '10:00',
      recurrence: 'NONE',
      weekdays: [2],
      allDay: false,
      reminder: '',
    });
  });

  it('builds the API input, dropping fields the rule does not use', () => {
    const state = {
      ...emptyForm('2026-11-03'),
      title: ' Кружок ',
      recurrence: 'WEEKLY' as const,
      startTime: '17:00',
      endTime: '18:30',
      reminder: '60' as const,
    };
    expect(toInput(state)).toEqual({
      title: 'Кружок',
      description: null,
      allDay: false,
      date: '2026-11-03',
      endDate: null,
      startTime: '17:00',
      endTime: '18:30',
      recurrence: 'WEEKLY',
      interval: 1,
      weekdays: [2],
      repeatUntil: null,
      participantUserIds: [],
      reminderMinutes: 60,
    });
    expect(toInput({ ...state, recurrence: 'NONE', repeatUntil: '2026-12-01' })).toMatchObject({
      weekdays: [],
      repeatUntil: null,
    });
    expect(toInput({ ...state, allDay: true })).toMatchObject({ startTime: null, endTime: null });
  });

  it('keeps the end date only for all-day events and sorts the weekdays', () => {
    const state = { ...emptyForm('2026-11-03'), title: 'Поездка', endDate: '2026-11-05' };
    expect(toInput(state).endDate).toBeNull();
    expect(toInput({ ...state, allDay: true }).endDate).toBe('2026-11-05');
    expect(toInput({ ...state, recurrence: 'WEEKLY', weekdays: [5, 1, 3] }).weekdays).toEqual([
      1, 3, 5,
    ]);
  });

  it('validates with the server texts', () => {
    const state = {
      ...emptyForm('2026-11-03'),
      title: '',
      startTime: '17:00',
      endTime: '16:30',
      recurrence: 'WEEKLY' as const,
      weekdays: [],
    };
    expect(validateForm(state)).toEqual({
      title: 'Введите название.',
      endTime: 'Конец не может быть раньше начала.',
      weekdays: 'Выберите хотя бы один день недели.',
    });
  });

  it('mirrors the remaining server rules', () => {
    const base = { ...emptyForm('2026-11-03'), title: 'Событие' };
    expect(validateForm(base)).toEqual({});
    expect(validateForm({ ...base, title: 'я'.repeat(201) })).toEqual({
      title: 'Не длиннее 200 символов.',
    });
    expect(validateForm({ ...base, description: 'я'.repeat(2001) })).toEqual({
      description: 'Не длиннее 2000 символов.',
    });
    expect(validateForm({ ...base, date: '' })).toEqual({
      date: 'Укажите дату в формате ДД.ММ.ГГГГ.',
    });
    expect(validateForm({ ...base, startTime: '', endTime: '' })).toEqual({
      startTime: 'Укажите время начала.',
      endTime: 'Укажите время конца.',
    });
    expect(validateForm({ ...base, startTime: '9:5' })).toEqual({
      startTime: 'Укажите время в формате ЧЧ:ММ.',
    });
    // An all-day event ignores the times and checks its end date instead.
    const allDay = { ...base, allDay: true, startTime: '', endTime: '' };
    expect(validateForm({ ...allDay, endDate: '2026-11-02' })).toEqual({
      endDate: 'Дата окончания не может быть раньше даты начала.',
    });
    expect(validateForm({ ...allDay, endDate: '2026-12-03' })).toEqual({});
    expect(validateForm({ ...allDay, endDate: '2026-12-04' })).toEqual({
      endDate: 'Событие может длиться не больше 31 дня.',
    });
    expect(validateForm({ ...base, recurrence: 'WEEKLY', weekdays: [2, 2] })).toEqual({
      weekdays: 'Дни недели не должны повторяться.',
    });
    expect(validateForm({ ...base, recurrence: 'DAILY', repeatUntil: '2026-11-02' })).toEqual({
      repeatUntil: 'Повтор не может закончиться раньше начала.',
    });
    // Without a repeat the «until» date is not sent, so it is not checked.
    expect(validateForm({ ...base, repeatUntil: '2026-11-02' })).toEqual({});
  });

  it('reads server field errors', () => {
    expect(
      fieldErrorsFromProblem({
        fieldErrors: [{ field: 'endTime', message: 'Конец не может быть раньше начала.' }],
      }),
    ).toEqual({
      endTime: 'Конец не может быть раньше начала.',
    });
    expect(fieldErrorsFromProblem(new Error('x'))).toEqual({});
    expect(fieldErrorsFromProblem(null)).toEqual({});
  });

  it('maps server paths onto form fields and unwraps API errors', () => {
    const error = new ApiRequestError(422, {
      code: 'VALIDATION_FAILED',
      detail: 'Проверьте поля.',
      fieldErrors: [
        { field: 'reminderMinutes', message: 'Выберите напоминание из списка.', code: 'custom' },
        { field: 'participantUserIds.0', message: 'Неверный участник.', code: 'invalid' },
        { field: 'participantUserIds.1', message: 'Второй.', code: 'invalid' },
      ],
    });
    expect(fieldErrorsFromProblem(error)).toEqual({
      reminder: 'Выберите напоминание из списка.',
      participantUserIds: 'Неверный участник.',
    });
  });

  it('describes the repeat rule', () => {
    const event = {
      allDay: false,
      date: '2026-11-03',
      startTime: '17:00',
      endTime: '18:30',
      recurrence: 'WEEKLY',
      interval: 1,
      weekdays: [2],
    } as CalendarEventDto;
    expect(describeRecurrence(event)).toBe('Каждый вторник, 17:00–18:30');
    expect(describeRecurrence({ ...event, interval: 2, weekdays: [1, 3] })).toBe(
      'Каждые 2 недели: пн, ср, 17:00–18:30',
    );
    expect(
      describeRecurrence({ ...event, allDay: true, recurrence: 'YEARLY', date: '2026-10-18' }),
    ).toBe('Каждый год, 18 октября');
    expect(describeRecurrence({ ...event, recurrence: 'MONTHLY', date: '2026-01-31' })).toBe(
      'Каждый месяц, 31-го, 17:00–18:30',
    );
    expect(describeRecurrence({ ...event, recurrence: 'NONE' })).toBe(
      'Не повторяется, 17:00–18:30',
    );
    expect(describeRecurrence({ ...event, allDay: true, recurrence: 'DAILY' })).toBe('Каждый день');
    expect(describeRecurrence({ ...event, allDay: true, recurrence: 'DAILY', interval: 5 })).toBe(
      'Каждые 5 дней',
    );
    expect(describeRecurrence({ ...event, weekdays: [1, 3] })).toBe(
      'Каждую неделю: пн, ср, 17:00–18:30',
    );
  });

  it('describes when a one-off event happens', () => {
    const event = {
      allDay: false,
      date: '2026-11-03',
      endDate: '2026-11-03',
      startTime: '17:00',
      endTime: '18:30',
    } as CalendarEventDto;
    expect(describeWhen(event)).toBe('3 ноября, 17:00–18:30');
    expect(describeWhen({ ...event, allDay: true })).toBe('3 ноября, весь день');
    expect(describeWhen({ ...event, allDay: true, endDate: '2026-11-05' })).toBe(
      '3 ноября – 5 ноября',
    );
  });

  it('round-trips an event into the form', () => {
    const event = {
      title: 'Кружок',
      description: null,
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
      participants: [{ userId: 'a', displayName: 'Алия', isActiveMember: true }],
    } as CalendarEventDto;
    expect(toInput(fromEvent(event))).toMatchObject({
      repeatUntil: '2026-12-29',
      reminderMinutes: 60,
      participantUserIds: ['a'],
    });
  });

  it('drops former members from participants and explains it', () => {
    const timur = { userId: 't', displayName: 'Тимур', isActiveMember: false };
    const event = {
      title: 'Кружок',
      description: null,
      allDay: true,
      date: '2026-11-03',
      endDate: '2026-11-04',
      startTime: null,
      endTime: null,
      recurrence: 'NONE',
      interval: 1,
      weekdays: [],
      repeatUntil: null,
      reminderMinutes: null,
      participants: [{ userId: 'a', displayName: 'Алия', isActiveMember: true }, timur],
    } as unknown as CalendarEventDto;
    expect(fromEvent(event)).toMatchObject({
      participantUserIds: ['a'],
      endDate: '2026-11-04',
      weekdays: [2],
      reminder: '',
    });
    expect(formerParticipantsHint(event.participants)).toBe(
      'Тимур (не в семье) будет убран из участников при сохранении',
    );
    expect(
      formerParticipantsHint([timur, { userId: 'z', displayName: 'Зоя', isActiveMember: false }]),
    ).toBe('Тимур (не в семье), Зоя (не в семье) будут убраны из участников при сохранении');
    expect(formerParticipantsHint(event.participants.slice(0, 1))).toBe('');
  });
});
