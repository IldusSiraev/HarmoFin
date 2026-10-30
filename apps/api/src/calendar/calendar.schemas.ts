import { z } from 'zod';

export const REMINDER_MINUTES = [15, 60, 1440, 10080] as const;
export const MAX_FEED_DAYS = 62;
const MAX_ALL_DAY_SPAN_DAYS = 30;

const date = z.string().date('Укажите дату в формате ГГГГ-ММ-ДД.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Укажите время в формате ЧЧ:ММ.');
const uuid = z.string().uuid();

export const calendarUuidSchema = uuid;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export const calendarEventInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Введите название.').max(200, 'Не длиннее 200 символов.'),
    description: z.string().trim().max(2000, 'Не длиннее 2000 символов.').nullable().optional(),
    allDay: z.boolean(),
    date,
    endDate: date.nullable().optional(),
    startTime: time.nullable().optional(),
    endTime: time.nullable().optional(),
    recurrence: z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
    interval: z.number().int().min(1, 'От 1 до 99.').max(99, 'От 1 до 99.').default(1),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    repeatUntil: date.nullable().optional(),
    participantUserIds: z.array(uuid).max(50).default([]),
    reminderMinutes: z
      .number()
      .int()
      .refine((value) => (REMINDER_MINUTES as readonly number[]).includes(value), {
        message: 'Выберите напоминание из списка.',
      })
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (value.allDay) {
      if (value.startTime) issue('startTime', 'У события на весь день нет времени начала.');
      if (value.endTime) issue('endTime', 'У события на весь день нет времени конца.');
      if (value.endDate && value.endDate < value.date) {
        issue('endDate', 'Дата окончания не может быть раньше даты начала.');
      } else if (value.endDate && daysBetween(value.date, value.endDate) > MAX_ALL_DAY_SPAN_DAYS) {
        issue('endDate', 'Событие может длиться не больше 31 дня.');
      }
    } else {
      if (!value.startTime) issue('startTime', 'Укажите время начала.');
      if (!value.endTime) issue('endTime', 'Укажите время конца.');
      if (value.endDate) issue('endDate', 'Дата окончания — только у события на весь день.');
      if (value.startTime && value.endTime && value.endTime < value.startTime) {
        issue('endTime', 'Конец не может быть раньше начала.');
      }
    }
    if (value.recurrence === 'WEEKLY' && value.weekdays.length === 0) {
      issue('weekdays', 'Выберите хотя бы один день недели.');
    }
    if (value.recurrence !== 'WEEKLY' && value.weekdays.length > 0) {
      issue('weekdays', 'Дни недели — только у еженедельного повтора.');
    }
    if (new Set(value.weekdays).size !== value.weekdays.length) {
      issue('weekdays', 'Дни недели не должны повторяться.');
    }
    if (value.repeatUntil && value.recurrence === 'NONE') {
      issue('repeatUntil', 'Дата окончания повтора — только у повторяющегося события.');
    } else if (value.repeatUntil && value.repeatUntil < value.date) {
      issue('repeatUntil', 'Повтор не может закончиться раньше начала.');
    }
  })
  .transform((value) => ({
    ...value,
    description: value.description ? value.description : null,
    endDate: value.endDate ?? null,
    startTime: value.startTime ?? null,
    endTime: value.endTime ?? null,
    repeatUntil: value.repeatUntil ?? null,
    reminderMinutes: value.reminderMinutes ?? null,
    weekdays: [...value.weekdays].sort((a, b) => a - b),
    participantUserIds: [...new Set(value.participantUserIds)],
  }));

export type CalendarEventInput = z.output<typeof calendarEventInputSchema>;

export const calendarFeedQuerySchema = z
  .object({
    from: date,
    to: date,
    participantUserId: uuid.optional(),
    includePlans: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.to < value.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Конец диапазона раньше начала.' });
    } else if (daysBetween(value.from, value.to) + 1 > MAX_FEED_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Диапазон — не больше 62 дней.' });
    }
  });

export type CalendarFeedQuery = z.output<typeof calendarFeedQuerySchema>;
