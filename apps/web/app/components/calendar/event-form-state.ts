import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

import { ApiRequestError } from '../../composables/useApiClient.js';
import type { PersonRef } from '../../composables/useEnvelopePlanV2.js';
import type {
  CalendarEventDto,
  CalendarEventInput,
  CalendarRecurrence,
} from '../../composables/useFamilyCalendar.js';
import { authorLabel } from '../operations/author-label.js';
import { isoWeekday } from './calendar-dates.js';

// Form state for an event: plain strings for the fields, converted to the API input on submit.
// The rules in validateForm mirror apps/api/src/calendar/calendar.schemas.ts; the server stays
// the authority and its fieldErrors are shown under the same fields. The client date message
// names the date picker's input format (ДД.ММ.ГГГГ), not the API one.

export interface EventFormState {
  title: string;
  description: string;
  allDay: boolean;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  recurrence: CalendarRecurrence;
  weekdays: number[];
  repeatUntil: string;
  participantUserIds: string[];
  reminders: number[];
}

// Same list as apps/api/src/calendar/calendar.schemas.ts (REMINDER_OFFSETS): minutes before the
// start; an all-day event counts from 09:00 of its day.
export const REMINDER_OFFSETS = [0, 5, 15, 30, 60, 120, 1440, 2880, 10080] as const;
export const MAX_REMINDERS = 3;

export const REMINDER_LABELS: Record<number, string> = {
  0: 'В момент начала',
  5: 'За 5 мин',
  15: 'За 15 мин',
  30: 'За 30 мин',
  60: 'За 1 час',
  120: 'За 2 часа',
  1440: 'За 1 день',
  2880: 'За 2 дня',
  10080: 'За 1 неделю',
};

export const RECURRENCE_LABELS: Record<CalendarRecurrence, string> = {
  NONE: 'Не повторять',
  DAILY: 'Каждый день',
  WEEKLY: 'Каждую неделю',
  MONTHLY: 'Каждый месяц',
  YEARLY: 'Каждый год',
};

export const WEEKDAY_CHIPS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

const WEEKDAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const WEEKDAY_EVERY = [
  'Каждый понедельник',
  'Каждый вторник',
  'Каждую среду',
  'Каждый четверг',
  'Каждую пятницу',
  'Каждую субботу',
  'Каждое воскресенье',
];

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;
const MAX_ALL_DAY_SPAN_DAYS = 30;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const isReminderOffset = (minutes: number): boolean => minutes in REMINDER_LABELS;

// Server field paths that the form shows under a differently named field.
const FIELD_ALIASES: Record<string, string> = { reminderMinutes: 'reminders' };

const asLocalNoon = (date: string): Date => new Date(`${date}T12:00:00Z`);
const dayMonth = (date: string): string => format(asLocalNoon(date), 'd MMMM', { locale: ru });

function isDate(value: string): boolean {
  return DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// «2 недели», «5 недель», «21 неделю» — only the few/many forms are needed after «Каждые».
function plural(count: number, few: string, many: string): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 12 && tens <= 14) return many;
  return ones >= 2 && ones <= 4 ? few : many;
}

function every(count: number, one: string, few: string, many: string): string {
  if (count % 10 === 1 && count % 100 !== 11) return `Каждый ${count} ${one}`;
  return `Каждые ${count} ${plural(count, few, many)}`;
}

export function emptyForm(date: string): EventFormState {
  return {
    title: '',
    description: '',
    allDay: false,
    date,
    endDate: '',
    startTime: '09:00',
    endTime: '10:00',
    recurrence: 'NONE',
    weekdays: [isoWeekday(date)],
    repeatUntil: '',
    participantUserIds: [],
    reminders: [],
  };
}

export function fromEvent(event: CalendarEventDto): EventFormState {
  return {
    title: event.title,
    description: event.description ?? '',
    allDay: event.allDay,
    date: event.date,
    endDate: event.allDay && event.endDate !== event.date ? event.endDate : '',
    startTime: event.startTime ?? '09:00',
    endTime: event.endTime ?? '10:00',
    recurrence: event.recurrence,
    weekdays:
      event.recurrence === 'WEEKLY' ? [...new Set(event.weekdays)] : [isoWeekday(event.date)],
    repeatUntil: event.repeatUntil ?? '',
    // Former members cannot stay participants: the server rejects them on save.
    participantUserIds: event.participants
      .filter((person) => person.isActiveMember)
      .map((person) => person.userId),
    reminders: [...new Set(event.reminders)].filter(isReminderOffset).sort((a, b) => a - b),
  };
}

export function formerParticipantsHint(participants: readonly PersonRef[]): string {
  const former = participants.filter((person) => !person.isActiveMember).map(authorLabel);
  if (former.length === 0) return '';
  const verb = former.length === 1 ? 'будет убран' : 'будут убраны';
  return `${former.join(', ')} ${verb} из участников при сохранении`;
}

export function toInput(state: EventFormState): CalendarEventInput {
  const repeating = state.recurrence !== 'NONE';
  return {
    title: state.title.trim(),
    description: state.description.trim() || null,
    allDay: state.allDay,
    date: state.date,
    endDate: state.allDay && state.endDate ? state.endDate : null,
    startTime: state.allDay ? null : state.startTime,
    endTime: state.allDay ? null : state.endTime,
    recurrence: state.recurrence,
    interval: 1,
    weekdays: state.recurrence === 'WEEKLY' ? [...state.weekdays].sort((a, b) => a - b) : [],
    repeatUntil: repeating && state.repeatUntil ? state.repeatUntil : null,
    participantUserIds: [...state.participantUserIds],
    reminders: [...state.reminders].sort((a, b) => a - b),
  };
}

export function validateForm(state: EventFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  const title = state.title.trim();
  if (!title) errors.title = 'Введите название.';
  else if (title.length > MAX_TITLE) errors.title = 'Не длиннее 200 символов.';
  if (state.description.trim().length > MAX_DESCRIPTION) {
    errors.description = 'Не длиннее 2000 символов.';
  }
  const dateValid = isDate(state.date);
  if (!dateValid) errors.date = 'Укажите дату в формате ДД.ММ.ГГГГ.';

  if (state.allDay) {
    if (state.endDate && !isDate(state.endDate)) {
      errors.endDate = 'Укажите дату в формате ДД.ММ.ГГГГ.';
    } else if (state.endDate && dateValid) {
      if (state.endDate < state.date) {
        errors.endDate = 'Дата окончания не может быть раньше даты начала.';
      } else if (daysBetween(state.date, state.endDate) > MAX_ALL_DAY_SPAN_DAYS) {
        errors.endDate = 'Событие может длиться не больше 31 дня.';
      }
    }
  } else {
    if (!state.startTime) errors.startTime = 'Укажите время начала.';
    else if (!TIME_PATTERN.test(state.startTime)) {
      errors.startTime = 'Укажите время в формате ЧЧ:ММ.';
    }
    if (!state.endTime) errors.endTime = 'Укажите время конца.';
    else if (!TIME_PATTERN.test(state.endTime)) errors.endTime = 'Укажите время в формате ЧЧ:ММ.';
    else if (!errors.startTime && state.startTime && state.endTime < state.startTime) {
      errors.endTime = 'Конец не может быть раньше начала.';
    }
  }

  if (state.recurrence === 'WEEKLY') {
    if (state.weekdays.length === 0) errors.weekdays = 'Выберите хотя бы один день недели.';
    else if (new Set(state.weekdays).size !== state.weekdays.length) {
      errors.weekdays = 'Дни недели не должны повторяться.';
    }
  }
  if (state.recurrence !== 'NONE' && state.repeatUntil) {
    if (!isDate(state.repeatUntil)) errors.repeatUntil = 'Укажите дату в формате ДД.ММ.ГГГГ.';
    else if (dateValid && state.repeatUntil < state.date) {
      errors.repeatUntil = 'Повтор не может закончиться раньше начала.';
    }
  }
  if (state.reminders.length > MAX_REMINDERS) {
    errors.reminders = 'Можно выбрать до трёх напоминаний.';
  }
  return errors;
}

// Accepts the thrown ApiRequestError or its problem body; the first message per field wins.
export function fieldErrorsFromProblem(problem: unknown): Record<string, string> {
  const body = problem instanceof ApiRequestError ? problem.problem : problem;
  const list = (body as { fieldErrors?: unknown } | null | undefined)?.fieldErrors;
  if (!Array.isArray(list)) return {};
  const errors: Record<string, string> = {};
  for (const item of list as Array<{ field?: unknown; message?: unknown }>) {
    if (typeof item?.field !== 'string' || typeof item.message !== 'string') continue;
    const root = item.field.split('.')[0] ?? item.field;
    const field = FIELD_ALIASES[root] ?? root;
    if (!(field in errors)) errors[field] = item.message;
  }
  return errors;
}

type RecurrenceFields = Pick<
  CalendarEventDto,
  'allDay' | 'date' | 'startTime' | 'endTime' | 'recurrence' | 'interval' | 'weekdays'
>;

export function describeRecurrence(event: RecurrenceFields): string {
  const time = event.allDay ? '' : `${event.startTime}–${event.endTime}`;
  const interval = event.interval > 1 ? event.interval : 1;
  let rule: string;
  switch (event.recurrence) {
    case 'DAILY':
      rule = interval > 1 ? every(interval, 'день', 'дня', 'дней') : 'Каждый день';
      break;
    case 'WEEKLY': {
      const days = event.weekdays.map((day) => WEEKDAY_SHORT[day - 1]).join(', ');
      const single = WEEKDAY_EVERY[(event.weekdays[0] ?? 0) - 1];
      rule =
        interval === 1 && event.weekdays.length === 1 && single
          ? single
          : `${interval > 1 ? every(interval, 'неделю', 'недели', 'недель') : 'Каждую неделю'}: ${days}`;
      break;
    }
    case 'MONTHLY':
      rule = `${interval > 1 ? every(interval, 'месяц', 'месяца', 'месяцев') : 'Каждый месяц'}, ${Number(event.date.slice(8))}-го`;
      break;
    case 'YEARLY':
      rule = `${interval > 1 ? every(interval, 'год', 'года', 'лет') : 'Каждый год'}, ${dayMonth(event.date)}`;
      break;
    default:
      rule = 'Не повторяется';
  }
  return time ? `${rule}, ${time}` : rule;
}

// The date line of a one-off event: «3 ноября, 17:00–18:30», «3 ноября – 5 ноября».
export function describeWhen(
  event: Pick<CalendarEventDto, 'allDay' | 'date' | 'endDate' | 'startTime' | 'endTime'>,
): string {
  if (!event.allDay) return `${dayMonth(event.date)}, ${event.startTime}–${event.endTime}`;
  if (event.endDate && event.endDate !== event.date) {
    return `${dayMonth(event.date)} – ${dayMonth(event.endDate)}`;
  }
  return `${dayMonth(event.date)}, весь день`;
}

export function repeatUntilLabel(repeatUntil: string): string {
  return `Повторяется до ${dayMonth(repeatUntil)}`;
}

// The card line: «За 1 день, за 1 час, в момент начала» — the earliest reminder first.
export function remindersLabel(reminders: readonly number[]): string {
  const labels = [...new Set(reminders)]
    .filter(isReminderOffset)
    .sort((a, b) => b - a)
    .map((minutes, index) => {
      const label = REMINDER_LABELS[minutes]!;
      return index === 0 ? label : label.charAt(0).toLowerCase() + label.slice(1);
    });
  return labels.length > 0 ? labels.join(', ') : 'Без напоминания';
}
