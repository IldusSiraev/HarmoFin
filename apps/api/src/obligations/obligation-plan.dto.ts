import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const recurrenceValues = ['ONE_TIME', 'MONTHLY', 'EVERY_N_MONTHS', 'YEARLY'];

export class ObligationPlanCreateBody {
  @ApiProperty({ minLength: 1, maxLength: 120, example: 'Аренда' })
  name!: string;

  @ApiProperty({
    example: '40000.00',
    description: 'Ожидаемая сумма: десятичная строка, до 2 знаков.',
  })
  amount!: string;

  @ApiProperty({
    format: 'date',
    maxLength: 10,
    example: '2026-10-05',
    description: 'Дата первого платежа (для разового — единственного).',
  })
  scheduledOn!: string;

  @ApiProperty({ format: 'uuid', maxLength: 36 })
  categoryId!: string;

  @ApiProperty({ enum: recurrenceValues, example: 'ONE_TIME' })
  recurrence!: string;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 2, maximum: 120, example: 3 })
  intervalMonths?: number | null;

  @ApiPropertyOptional({ format: 'date', maxLength: 10, nullable: true, type: String })
  endOn?: string | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true, type: String })
  comment?: string | null;
}

export class ObligationOneTimePayBody {
  @ApiProperty({ minLength: 1, maxLength: 120, example: 'Взнос в садик' })
  name!: string;

  @ApiProperty({
    example: '40000.00',
    description: 'Плановая сумма: десятичная строка, до 2 знаков.',
  })
  plannedAmount!: string;

  @ApiProperty({
    example: '38500.50',
    description: 'Фактическая сумма расхода; может отличаться от плановой.',
  })
  actualAmount!: string;

  @ApiProperty({
    format: 'date',
    maxLength: 10,
    example: '2026-10-01',
    description: 'Дата оплаты; будущая дата отклоняется.',
  })
  occurredOn!: string;

  @ApiProperty({ format: 'uuid', maxLength: 36 })
  accountId!: string;

  @ApiProperty({ format: 'uuid', maxLength: 36 })
  categoryId!: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true, type: String })
  comment?: string | null;
}

export class ObligationOneTimePayTransaction {
  @ApiProperty({ format: 'uuid', maxLength: 36 })
  id!: string;

  @ApiProperty({ example: '3850050', description: 'Фактическая сумма (minor, строка).' })
  amountMinor!: string;

  @ApiProperty({ format: 'date', maxLength: 10 })
  occurredOn!: string;

  @ApiProperty({ format: 'uuid', maxLength: 36 })
  accountId!: string;

  @ApiProperty({ format: 'uuid', maxLength: 36 })
  categoryId!: string;

  @ApiProperty({ format: 'uuid', maxLength: 36 })
  envelopeId!: string;

  @ApiProperty({ example: '9614950', description: 'Баланс счёта после расхода (minor, строка).' })
  accountBalanceMinor!: string;
}

export class ObligationOneTimePayWarning {
  @ApiProperty({ example: 'ENVELOPE_BALANCE_INSUFFICIENT' })
  code!: string;

  @ApiProperty({ example: 'Назначение конверта меньше расхода; оплата проведена.' })
  detail!: string;
}

export class ObligationOneTimePayResponse {
  @ApiProperty({ example: '4000000', description: 'Плановая сумма (minor, строка).' })
  plannedMinor!: string;

  @ApiProperty({ example: '3850050', description: 'Фактическая сумма (minor, строка).' })
  actualMinor!: string;

  @ApiProperty({ format: 'uuid', maxLength: 36 })
  occurrenceId!: string;

  @ApiProperty({ format: 'uuid', maxLength: 36 })
  planId!: string;

  @ApiProperty({ type: ObligationOneTimePayTransaction })
  transaction!: ObligationOneTimePayTransaction;

  @ApiProperty({ type: [ObligationOneTimePayWarning] })
  warnings!: ObligationOneTimePayWarning[];
}

export class ObligationPlanUpdateBody {
  @ApiPropertyOptional({ minLength: 1, maxLength: 120 })
  name?: string;

  @ApiPropertyOptional({
    example: '3500.00',
    description:
      'Новая ожидаемая сумма. Применяется к будущим неоплаченным occurrences; оплаченные не меняются.',
  })
  amount?: string;

  @ApiPropertyOptional({
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
  @ApiProperty({ format: 'uuid', maxLength: 36 })
  id!: string;

  @ApiProperty({ enum: ['EXPENSE'] })
  planType!: string;

  @ApiProperty({ example: 'Аренда' })
  name!: string;

  @ApiProperty({ example: '4000000', description: 'Ожидаемая сумма (minor, строка).' })
  amountMinor!: string;

  @ApiProperty({ enum: recurrenceValues })
  recurrence!: string;

  @ApiProperty({ type: Number, nullable: true })
  intervalMonths!: number | null;

  @ApiProperty({ format: 'date', maxLength: 10 })
  scheduledOn!: string;

  @ApiProperty({ format: 'date', maxLength: 10, nullable: true, type: String })
  endOn!: string | null;

  @ApiProperty({ format: 'uuid', maxLength: 36, nullable: true, type: String })
  categoryId!: string | null;

  @ApiProperty({ format: 'uuid', maxLength: 36, nullable: true, type: String })
  envelopeId!: string | null;

  @ApiProperty({ maxLength: 500, nullable: true, type: String })
  comment!: string | null;

  @ApiProperty({ enum: ['ACTIVE', 'ARCHIVED'] })
  status!: string;
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

  @ApiProperty({ example: 2, description: 'Сколько occurrences материализовано сейчас.' })
  occurrencesCreated!: number;
}

export class ObligationPlanUpdateResponse extends ObligationPlanResponse {
  @ApiProperty({ example: 1, description: 'Occurrences с изменённой ожидаемой суммой.' })
  updatedOccurrences!: number;

  @ApiProperty({ example: 0, description: 'Отключённые (CANCELLED) будущие неоплаченные.' })
  cancelledOccurrences!: number;
}

export class ObligationPlanListResponse {
  @ApiProperty({ type: [ObligationPlanResponse] })
  items!: ObligationPlanResponse[];
}

export class ObligationOccurrenceItemResponse {
  @ApiProperty({ format: 'uuid', maxLength: 36 })
  id!: string;

  @ApiProperty({ format: 'uuid', maxLength: 36 })
  planId!: string;

  @ApiProperty({ example: 'Аренда' })
  name!: string;

  @ApiProperty({ format: 'date', maxLength: 10 })
  scheduledOn!: string;

  @ApiProperty({ enum: ['PENDING', 'DUE', 'COMPLETED', 'SKIPPED', 'CANCELLED'] })
  status!: string;

  @ApiProperty({ example: '300000', description: 'Ожидаемая сумма (minor, строка).' })
  expectedMinor!: string;

  @ApiProperty({ example: '0', description: 'Подтверждённые оплаты (minor, строка).' })
  paidMinor!: string;

  @ApiProperty({ example: '300000', description: 'Остаток к оплате (minor, строка).' })
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
