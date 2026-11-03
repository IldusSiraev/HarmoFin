import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';

import { PersonRefResponse } from '../common/people/person-ref.dto.js';

const RECURRENCES = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const REMINDERS = [0, 5, 15, 30, 60, 120, 1440, 2880, 10080];
const TIME_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$';

export class CalendarEventBody {
  @ApiProperty({ type: String, maxLength: 200, example: 'Кружок рисования' })
  title!: string;

  @ApiPropertyOptional({ type: String, maxLength: 2000, nullable: true })
  description?: string | null;

  @ApiProperty({ type: Boolean })
  allDay!: boolean;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-11-03',
    description: 'Дата начала, локальная для бюджета.',
  })
  date!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    description: 'Последний день события на весь день; по умолчанию — date.',
  })
  endDate?: string | null;

  @ApiPropertyOptional({
    type: String,
    pattern: TIME_PATTERN,
    nullable: true,
    example: '17:00',
    description: 'Локальное время бюджета; обязательно без allDay.',
  })
  startTime?: string | null;

  @ApiPropertyOptional({ type: String, pattern: TIME_PATTERN, nullable: true, example: '18:30' })
  endTime?: string | null;

  @ApiProperty({ type: String, enum: RECURRENCES })
  recurrence!: string;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 99, default: 1 })
  interval?: number;

  @ApiPropertyOptional({ type: [Number], description: 'ISO-дни недели 1–7, только у WEEKLY.' })
  weekdays?: number[];

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  repeatUntil?: string | null;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Активные члены семьи; прав не дают.',
  })
  participantUserIds!: string[];

  @ApiPropertyOptional({
    type: Number,
    isArray: true,
    enum: REMINDERS,
    maxItems: 3,
    description:
      'До трёх напоминаний, минуты до начала, без повторов; у события на весь день — от 09:00. ' +
      'Если не передано ни это поле, ни reminderMinutes: при создании — без напоминаний, при правке — без изменений.',
  })
  reminders?: number[];

  @ApiPropertyOptional({
    type: Number,
    enum: REMINDERS,
    nullable: true,
    deprecated: true,
    description:
      'Устарело: одно напоминание, используйте reminders. Если переданы оба поля, должно быть равно наименьшему из reminders.',
  })
  reminderMinutes?: number | null;
}

export class CalendarEventResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String })
  title!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: Boolean })
  allDay!: boolean;

  @ApiProperty({ type: String, format: 'date' })
  date!: string;

  @ApiProperty({ type: String, format: 'date' })
  endDate!: string;

  @ApiProperty({ type: String, nullable: true, example: '17:00' })
  startTime!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '18:30' })
  endTime!: string | null;

  @ApiProperty({ type: String, enum: RECURRENCES })
  recurrence!: string;

  @ApiProperty({ type: Number })
  interval!: number;

  @ApiProperty({ type: [Number] })
  weekdays!: number[];

  @ApiProperty({ type: String, format: 'date', nullable: true })
  repeatUntil!: string | null;

  @ApiProperty({
    type: Number,
    isArray: true,
    enum: REMINDERS,
    description: 'Напоминания по возрастанию, минуты до начала.',
  })
  reminders!: number[];

  @ApiProperty({
    type: Number,
    enum: REMINDERS,
    nullable: true,
    deprecated: true,
    description: 'Устарело: наименьшее из reminders или null.',
  })
  reminderMinutes!: number | null;

  @ApiProperty({ type: [PersonRefResponse] })
  participants!: PersonRefResponse[];

  @ApiProperty({ type: PersonRefResponse })
  createdBy!: PersonRefResponse;

  @ApiProperty({
    type: Boolean,
    description: 'Может ли текущий участник изменять и удалять событие (только автор).',
  })
  canEdit!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class CalendarFeedEventItemResponse {
  @ApiProperty({ type: String, enum: ['EVENT'], example: 'EVENT' })
  kind!: 'EVENT';

  @ApiProperty({ type: String, format: 'uuid' })
  eventId!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    description: 'Локальная дата начала вхождения — его идентификатор в серии.',
  })
  occurrenceDate!: string;

  @ApiProperty({ type: String })
  title!: string;

  @ApiProperty({ type: Boolean })
  allDay!: boolean;

  @ApiProperty({ type: String, format: 'date' })
  startDate!: string;

  @ApiProperty({ type: String, format: 'date' })
  endDate!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '17:00',
    description: 'Локальное время бюджета.',
  })
  startTime!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '18:30' })
  endTime!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', description: 'UTC.' })
  startsAt!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', description: 'UTC.' })
  endsAt!: string | null;

  @ApiProperty({ type: String, enum: RECURRENCES })
  recurrence!: string;

  @ApiProperty({ type: [PersonRefResponse] })
  participants!: PersonRefResponse[];

  @ApiProperty({ type: PersonRefResponse })
  createdBy!: PersonRefResponse;

  @ApiProperty({ type: Boolean, description: 'Может ли текущий участник изменять событие.' })
  canEdit!: boolean;
}

export class CalendarFeedPlanItemResponse {
  @ApiProperty({ type: String, enum: ['PLAN'], example: 'PLAN' })
  kind!: 'PLAN';

  @ApiProperty({ type: String, format: 'uuid' })
  occurrenceId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  planId!: string;

  @ApiProperty({ type: String, enum: ['OBLIGATION', 'INCOME_PLAN'] })
  planKind!: 'OBLIGATION' | 'INCOME_PLAN';

  @ApiProperty({ type: String })
  title!: string;

  @ApiProperty({
    type: String,
    example: '4500000',
    description: 'Ожидаемая сумма вхождения, minor units (как expectedMinor календаря планов).',
  })
  amountMinor!: string;

  @ApiProperty({ type: String, description: 'Статус вхождения плана.' })
  status!: string;

  @ApiProperty({ type: Boolean })
  isOverdue!: boolean;

  @ApiProperty({ type: String, format: 'date' })
  scheduledOn!: string;

  @ApiProperty({ type: PersonRefResponse })
  owner!: PersonRefResponse;
}

@ApiExtraModels(CalendarFeedEventItemResponse, CalendarFeedPlanItemResponse)
export class CalendarFeedResponse {
  @ApiProperty({ type: String, format: 'date' })
  from!: string;

  @ApiProperty({ type: String, format: 'date' })
  to!: string;

  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(CalendarFeedEventItemResponse) },
        { $ref: getSchemaPath(CalendarFeedPlanItemResponse) },
      ],
      discriminator: {
        propertyName: 'kind',
        mapping: {
          EVENT: getSchemaPath(CalendarFeedEventItemResponse),
          PLAN: getSchemaPath(CalendarFeedPlanItemResponse),
        },
      },
    },
  })
  items!: Array<CalendarFeedEventItemResponse | CalendarFeedPlanItemResponse>;
}
