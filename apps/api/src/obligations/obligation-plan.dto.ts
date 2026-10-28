import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PersonRefResponse } from '../common/people/person-ref.dto.js';

const recurrenceValues = ['ONE_TIME', 'MONTHLY', 'EVERY_N_MONTHS', 'YEARLY'];

export class ObligationPlanCreateBody {
  @ApiProperty({ type: String, minLength: 1, maxLength: 120, example: 'Аренда' })
  name!: string;

  @ApiProperty({
    type: String,
    example: '40000.00',
    description: 'Ожидаемая сумма: десятичная строка, до 2 знаков.',
  })
  amount!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    maxLength: 10,
    example: '2026-10-05',
    description: 'Дата первого платежа (для разового — единственного).',
  })
  scheduledOn!: string;

  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  categoryId!: string;

  @ApiProperty({ type: String, enum: recurrenceValues, example: 'ONE_TIME' })
  recurrence!: string;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 2, maximum: 120, example: 3 })
  intervalMonths?: number | null;

  @ApiPropertyOptional({ format: 'date', maxLength: 10, nullable: true, type: String })
  endOn?: string | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true, type: String })
  comment?: string | null;
}

export class ObligationOneTimePayBody {
  @ApiProperty({ type: String, minLength: 1, maxLength: 120, example: 'Взнос в садик' })
  name!: string;

  @ApiProperty({
    type: String,
    example: '40000.00',
    description: 'Плановая сумма: десятичная строка, до 2 знаков.',
  })
  plannedAmount!: string;

  @ApiProperty({
    type: String,
    example: '38500.50',
    description: 'Фактическая сумма расхода; может отличаться от плановой.',
  })
  actualAmount!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    maxLength: 10,
    example: '2026-10-01',
    description: 'Дата оплаты; будущая дата отклоняется.',
  })
  occurredOn!: string;

  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  accountId!: string;

  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  categoryId!: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true, type: String })
  comment?: string | null;
}

export class ObligationOneTimePayTransaction {
  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  id!: string;

  @ApiProperty({
    type: String,
    example: '3850050',
    description: 'Фактическая сумма (minor, строка).',
  })
  amountMinor!: string;

  @ApiProperty({ type: String, format: 'date', maxLength: 10 })
  occurredOn!: string;

  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  accountId!: string;

  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  categoryId!: string;

  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  envelopeId!: string;

  @ApiProperty({
    type: String,
    example: '9614950',
    description: 'Баланс счёта после расхода (minor, строка).',
  })
  accountBalanceMinor!: string;
}

export class ObligationOneTimePayWarning {
  @ApiProperty({ type: String, example: 'ENVELOPE_BALANCE_INSUFFICIENT' })
  code!: string;

  @ApiProperty({
    type: String,
    example: 'В конверте отложено меньше, чем расход; оплата проведена.',
  })
  detail!: string;
}

export class ObligationOneTimePayResponse {
  @ApiProperty({ type: String, example: '4000000', description: 'Плановая сумма (minor, строка).' })
  plannedMinor!: string;

  @ApiProperty({
    type: String,
    example: '3850050',
    description: 'Фактическая сумма (minor, строка).',
  })
  actualMinor!: string;

  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  occurrenceId!: string;

  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  planId!: string;

  @ApiProperty({ type: ObligationOneTimePayTransaction })
  transaction!: ObligationOneTimePayTransaction;

  @ApiProperty({ type: [ObligationOneTimePayWarning] })
  warnings!: ObligationOneTimePayWarning[];
}

export class ObligationPlanUpdateBody {
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 120 })
  name?: string;

  @ApiPropertyOptional({
    type: String,
    example: '3500.00',
    description:
      'Новая ожидаемая сумма. Применяется к будущим неоплаченным occurrences; оплаченные не меняются.',
  })
  amount?: string;

  @ApiPropertyOptional({
    type: String,
    enum: ['ACTIVE', 'ARCHIVED'],
    description:
      'ARCHIVED отключает только будущие неоплаченные occurrences; история и просроченные остаются.',
  })
  status?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'true: владелец подтверждает изменение суммы уже наступивших открытых occurrences (PENDING/DUE на сегодня или раньше). Требует amount.',
  })
  applyToCurrentOpen?: boolean;
}

export class ObligationPlanResponse {
  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  id!: string;

  @ApiProperty({ type: String, enum: ['EXPENSE'] })
  planType!: string;

  @ApiProperty({ type: String, example: 'Аренда' })
  name!: string;

  @ApiProperty({
    type: String,
    example: '4000000',
    description: 'Ожидаемая сумма (minor, строка).',
  })
  amountMinor!: string;

  @ApiProperty({ type: String, enum: recurrenceValues })
  recurrence!: string;

  @ApiProperty({ type: Number, nullable: true })
  intervalMonths!: number | null;

  @ApiProperty({ type: String, format: 'date', maxLength: 10 })
  scheduledOn!: string;

  @ApiProperty({ format: 'date', maxLength: 10, nullable: true, type: String })
  endOn!: string | null;

  @ApiProperty({ format: 'uuid', maxLength: 36, nullable: true, type: String })
  categoryId!: string | null;

  @ApiProperty({ format: 'uuid', maxLength: 36, nullable: true, type: String })
  envelopeId!: string | null;

  @ApiProperty({ maxLength: 500, nullable: true, type: String })
  comment!: string | null;

  @ApiProperty({ type: String, enum: ['ACTIVE', 'ARCHIVED'] })
  status!: string;

  @ApiProperty({ type: PersonRefResponse })
  owner!: PersonRefResponse;

  @ApiProperty({
    type: Boolean,
    description:
      'True у владельца плана: именно он создаёт/изменяет этот план и оплачивает его вхождения. Создание новых планов доступно любому участнику с правом записи.',
  })
  canEdit!: boolean;
}

export class ObligationPlanCreateResponse extends ObligationPlanResponse {
  @ApiProperty({
    format: 'uuid',
    maxLength: 36,
    nullable: true,
    type: String,
    description: 'Occurrence на дату первого платежа; для ONE_TIME передаётся в pay.',
  })
  occurrenceId!: string | null;

  @ApiProperty({
    type: Number,
    example: 2,
    description: 'Сколько occurrences материализовано сейчас.',
  })
  occurrencesCreated!: number;
}

export class ObligationPlanUpdateResponse extends ObligationPlanResponse {
  @ApiProperty({
    type: Number,
    example: 1,
    description: 'Occurrences с изменённой ожидаемой суммой.',
  })
  updatedOccurrences!: number;

  @ApiProperty({
    type: Number,
    example: 0,
    description: 'Отключённые (CANCELLED) будущие неоплаченные.',
  })
  cancelledOccurrences!: number;
}

export class ObligationPlanListResponse {
  @ApiProperty({ type: [ObligationPlanResponse] })
  items!: ObligationPlanResponse[];
}

export class ObligationOccurrenceItemResponse {
  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  planId!: string;

  @ApiProperty({ type: String, example: 'Аренда' })
  name!: string;

  @ApiProperty({ type: String, format: 'date', maxLength: 10 })
  scheduledOn!: string;

  @ApiProperty({ type: String, enum: ['PENDING', 'DUE', 'COMPLETED', 'SKIPPED', 'CANCELLED'] })
  status!: string;

  @ApiProperty({ type: String, example: '300000', description: 'Ожидаемая сумма (minor, строка).' })
  expectedMinor!: string;

  @ApiProperty({
    type: String,
    example: '0',
    description: 'Подтверждённые оплаты (minor, строка).',
  })
  paidMinor!: string;

  @ApiProperty({
    type: String,
    example: '300000',
    description: 'Остаток к оплате (minor, строка).',
  })
  unpaidMinor!: string;

  @ApiProperty({ format: 'uuid', maxLength: 36, nullable: true, type: String })
  categoryId!: string | null;

  @ApiProperty({ format: 'uuid', maxLength: 36, nullable: true, type: String })
  envelopeId!: string | null;
}

export class ObligationOccurrenceListResponse {
  @ApiProperty({ type: [ObligationOccurrenceItemResponse] })
  items!: ObligationOccurrenceItemResponse[];
}
