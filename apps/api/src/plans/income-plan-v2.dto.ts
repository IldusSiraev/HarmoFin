import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PersonRefResponse } from '../common/people/person-ref.dto.js';

const recurrenceValues = ['ONE_TIME', 'MONTHLY', 'EVERY_N_MONTHS', 'YEARLY'];
const statusValues = ['PENDING', 'DUE', 'COMPLETED', 'SKIPPED', 'CANCELLED'];

export class IncomePlanCreateBody {
  @ApiProperty({ type: String, minLength: 1, maxLength: 120, example: 'Зарплата' })
  name!: string;

  @ApiProperty({
    type: String,
    example: '100000.00',
    description: 'Ожидаемая сумма прогноза: десятичная строка, до 2 знаков.',
  })
  amount!: string;

  @ApiProperty({ type: String, format: 'date', maxLength: 10, example: '2026-10-05' })
  scheduledOn!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    maxLength: 36,
    description: 'Активная категория дохода этого бюджета.',
  })
  categoryId!: string;

  @ApiProperty({ type: String, enum: recurrenceValues, example: 'MONTHLY' })
  recurrence!: string;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 2, maximum: 120, example: 3 })
  intervalMonths?: number | null;

  @ApiPropertyOptional({ format: 'date', maxLength: 10, nullable: true, type: String })
  endOn?: string | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true, type: String })
  comment?: string | null;
}

export class IncomePlanUpdateBody {
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 120 })
  name?: string;

  @ApiPropertyOptional({ type: String, example: '90000.00', description: 'Новая ожидаемая сумма.' })
  amount?: string;

  @ApiPropertyOptional({ type: String, enum: ['ACTIVE', 'ARCHIVED'] })
  status?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'true: подтверждает смену суммы уже наступивших открытых occurrences.',
  })
  applyToCurrentOpen?: boolean;
}

export class IncomeRecordBody {
  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  accountId!: string;

  @ApiProperty({
    type: String,
    example: '87000.00',
    description: 'Фактическая сумма: десятичная строка.',
  })
  amount!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    maxLength: 10,
    example: '2026-10-01',
    description: 'Дата поступления; будущая дата отклоняется.',
  })
  occurredOn!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    maxLength: 36,
    description: 'Категория дохода; по умолчанию категория плана.',
  })
  categoryId?: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true, type: String })
  comment?: string | null;
}

export class IncomePlanResponse {
  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  id!: string;

  @ApiProperty({ type: String, enum: ['INCOME'] })
  planType!: string;

  @ApiProperty({ type: String, example: 'Зарплата' })
  name!: string;

  @ApiProperty({
    type: String,
    example: '10000000',
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

  @ApiProperty({ maxLength: 500, nullable: true, type: String })
  comment!: string | null;

  @ApiProperty({ type: String, enum: ['ACTIVE', 'ARCHIVED'] })
  status!: string;

  @ApiProperty({ type: PersonRefResponse })
  owner!: PersonRefResponse;

  @ApiProperty({
    type: Boolean,
    description: 'True у владельца плана: именно он может изменить этот план и записать по нему доход. Создание новых планов доступно любому участнику с правом записи.',
  })
  canEdit!: boolean;
}

export class IncomePlanCreateResponse extends IncomePlanResponse {
  @ApiProperty({ format: 'uuid', maxLength: 36, nullable: true, type: String })
  occurrenceId!: string | null;

  @ApiProperty({ type: Number, example: 2 })
  occurrencesCreated!: number;
}

export class IncomePlanUpdateResponse extends IncomePlanResponse {
  @ApiProperty({ type: Number, example: 1 })
  updatedOccurrences!: number;

  @ApiProperty({ type: Number, example: 0 })
  cancelledOccurrences!: number;
}

export class IncomePlanListResponse {
  @ApiProperty({ type: [IncomePlanResponse] })
  items!: IncomePlanResponse[];
}

export class IncomeOccurrenceItemResponse {
  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  planId!: string;

  @ApiProperty({ type: String, example: 'Зарплата' })
  name!: string;

  @ApiProperty({ type: String, format: 'date', maxLength: 10 })
  scheduledOn!: string;

  @ApiProperty({ type: String, enum: statusValues })
  status!: string;

  @ApiProperty({
    type: String,
    example: '10000000',
    description: 'Прогнозная сумма (minor, строка). Не входит в деньги и обязательные платежи.',
  })
  expectedMinor!: string;

  @ApiProperty({ format: 'uuid', maxLength: 36, nullable: true, type: String })
  categoryId!: string | null;

  @ApiProperty({
    format: 'uuid',
    maxLength: 36,
    nullable: true,
    type: String,
    description: 'Фактический доход, записанный по этому прогнозу.',
  })
  transactionId!: string | null;
}

export class IncomeOccurrenceListResponse {
  @ApiProperty({ type: [IncomeOccurrenceItemResponse] })
  items!: IncomeOccurrenceItemResponse[];
}

export class IncomeRecordOccurrence {
  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  id!: string;

  @ApiProperty({ type: String, enum: ['COMPLETED'] })
  status!: string;

  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  transactionId!: string;
}

export class IncomeRecordTransaction {
  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  id!: string;

  @ApiProperty({ type: String, enum: ['INCOME'] })
  transactionType!: string;

  @ApiProperty({ type: String, enum: ['CONFIRMED'] })
  status!: string;

  @ApiProperty({
    type: String,
    example: '8700000',
    description: 'Фактическая сумма (minor, строка).',
  })
  amountMinor!: string;

  @ApiProperty({ type: String, example: 'RUB', maxLength: 3 })
  currency!: string;

  @ApiProperty({ type: String, format: 'date', maxLength: 10 })
  occurredOn!: string;

  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  accountId!: string;

  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  categoryId!: string;

  @ApiProperty({ maxLength: 500, nullable: true, type: String })
  comment!: string | null;

  @ApiProperty({
    type: String,
    example: '108700000',
    description: 'Баланс счёта после дохода (minor, строка).',
  })
  accountBalanceMinor!: string;
}

export class IncomeRecordResponse {
  @ApiProperty({ type: IncomeRecordOccurrence })
  occurrence!: IncomeRecordOccurrence;

  @ApiProperty({ type: IncomeRecordTransaction })
  transaction!: IncomeRecordTransaction;
}
