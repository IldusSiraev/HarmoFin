import { ApiProperty } from '@nestjs/swagger';

import { PersonRefResponse } from '../common/people/person-ref.dto.js';

export class CreateTransactionV2Body {
  @ApiProperty({ type: String, enum: ['INCOME', 'EXPENSE'], example: 'EXPENSE' })
  transactionType!: 'INCOME' | 'EXPENSE';

  @ApiProperty({ type: String, enum: ['DRAFT', 'CONFIRMED'], example: 'CONFIRMED' })
  status!: 'DRAFT' | 'CONFIRMED';

  @ApiProperty({
    type: String,
    example: '4820.00',
    description: 'Десятичная строка, рубли, до 2 знаков.',
  })
  amount!: string;

  @ApiProperty({ type: String, example: '2026-09-30' })
  occurredOn!: string;

  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000003' })
  accountId!: string;

  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000004' })
  categoryId!: string;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    description: 'Только для расхода; обязательный конверт платежей через эту операцию недоступен.',
  })
  envelopeId?: string | null;

  @ApiProperty({ type: String, required: false, example: 'Продукты' })
  comment?: string;
}

export class UpdateTransactionV2Body {
  @ApiProperty({ type: String, required: false, example: '4820.00' })
  amount?: string;

  @ApiProperty({ type: String, required: false, example: '2026-09-30' })
  occurredOn?: string;

  @ApiProperty({ type: String, required: false })
  accountId?: string;

  @ApiProperty({ type: String, required: false })
  categoryId?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    description:
      'Обязательный конверт нельзя ни выбрать, ни покинуть этим запросом (409 MANDATORY_PAYMENT_REQUIRED).',
  })
  envelopeId?: string | null;

  @ApiProperty({ required: false, nullable: true, type: String })
  comment?: string | null;
}

export class TransactionV2Warning {
  @ApiProperty({ type: String, example: 'ENVELOPE_BALANCE_INSUFFICIENT' })
  code!: string;

  @ApiProperty({ type: String, example: 'Остаток конверта ушёл в минус.' })
  detail!: string;
}

export class TransactionV2Response {
  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000001' })
  id!: string;

  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000002' })
  budgetId!: string;

  @ApiProperty({ type: String, enum: ['INCOME', 'EXPENSE'] })
  transactionType!: 'INCOME' | 'EXPENSE';

  @ApiProperty({ type: String, enum: ['DRAFT', 'CONFIRMED'] })
  status!: 'DRAFT' | 'CONFIRMED';

  @ApiProperty({
    type: String,
    example: '482000',
    description: 'Сумма в минорных единицах (строка).',
  })
  amountMinor!: string;

  @ApiProperty({ type: String, example: 'RUB' })
  currency!: string;

  @ApiProperty({ type: String, example: '2026-09-30' })
  occurredOn!: string;

  @ApiProperty({ type: String })
  accountId!: string;

  @ApiProperty({ type: String })
  categoryId!: string;

  @ApiProperty({ nullable: true, type: String })
  envelopeId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  comment!: string | null;

  @ApiProperty({
    type: String,
    example: '1518000',
    description: 'Остаток счёта после операции (minor, строка).',
  })
  accountBalanceMinor!: string;

  @ApiProperty({ type: [TransactionV2Warning] })
  warnings!: TransactionV2Warning[];
}

export class TransactionV2OccurrenceView {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String, enum: ['PENDING', 'DUE', 'SKIPPED', 'COMPLETED', 'CANCELLED'] })
  status!: string;

  @ApiProperty({ type: String, example: '4000000' })
  expectedMinor!: string;

  @ApiProperty({
    type: String,
    example: '3500000',
    description: 'Сумма действующих CONFIRMED оплат.',
  })
  paidMinor!: string;

  @ApiProperty({ type: String, example: '500000' })
  unpaidMinor!: string;
}

export class TransactionV2LifecycleResponse {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  budgetId!: string;

  @ApiProperty({ type: String, enum: ['INCOME', 'EXPENSE'] })
  transactionType!: 'INCOME' | 'EXPENSE';

  @ApiProperty({ type: String, enum: ['DRAFT', 'CONFIRMED', 'CANCELLED', 'DELETED'] })
  status!: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED';

  @ApiProperty({
    type: String,
    example: '482000',
    description: 'Сумма в минорных единицах (строка).',
  })
  amountMinor!: string;

  @ApiProperty({ type: String, example: 'RUB' })
  currency!: string;

  @ApiProperty({ type: String, example: '2026-09-30' })
  occurredOn!: string;

  @ApiProperty({ type: String })
  accountId!: string;

  @ApiProperty({ type: String })
  categoryId!: string;

  @ApiProperty({ nullable: true, type: String })
  envelopeId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  comment!: string | null;

  @ApiProperty({
    type: String,
    example: '1518000',
    description: 'Остаток счёта после операции (minor, строка).',
  })
  accountBalanceMinor!: string;

  @ApiProperty({ type: [TransactionV2Warning] })
  warnings!: TransactionV2Warning[];

  @ApiProperty({
    type: [TransactionV2OccurrenceView],
    description: 'Связанные обязательства с пересчитанным статусом (пусто для обычного расхода).',
  })
  occurrences!: TransactionV2OccurrenceView[];
}

export class TransactionJournalV2Item {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  budgetId!: string;

  @ApiProperty({
    type: Number,
    enum: [1, 2],
    description: 'Учётная модель факта: 1 — старая, 2 — v2.',
  })
  accountingModelVersion!: 1 | 2;

  @ApiProperty({ type: String, enum: ['INCOME', 'EXPENSE'] })
  transactionType!: 'INCOME' | 'EXPENSE';

  @ApiProperty({ type: String, enum: ['DRAFT', 'CONFIRMED', 'CANCELLED', 'DELETED'] })
  status!: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED';

  @ApiProperty({
    type: String,
    example: '482000',
    description: 'Сумма в минорных единицах (строка).',
  })
  amountMinor!: string;

  @ApiProperty({ type: String, example: 'RUB' })
  currency!: string;

  @ApiProperty({ type: String, example: '2026-09-30' })
  occurredOn!: string;

  @ApiProperty({ type: String })
  accountId!: string;

  @ApiProperty({ type: String })
  categoryId!: string;

  @ApiProperty({ nullable: true, type: String })
  envelopeId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  sourceDescription!: string | null;

  @ApiProperty({ nullable: true, type: String })
  merchantName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  comment!: string | null;

  @ApiProperty({
    type: [String],
    description:
      'Occurrence плана: оплаты PlanPayment (v2) и старая связь occurrence.transactionId.',
  })
  planOccurrenceIds!: string[];

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  confirmedAt!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  cancelledAt!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  deletedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: PersonRefResponse, required: false })
  createdBy?: PersonRefResponse;
}

export class TransactionJournalV2Response {
  @ApiProperty({ type: [TransactionJournalV2Item] })
  items!: TransactionJournalV2Item[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}
