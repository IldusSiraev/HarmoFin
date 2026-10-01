import { ApiProperty } from '@nestjs/swagger';

export class CreateTransactionV2Body {
  @ApiProperty({ enum: ['INCOME', 'EXPENSE'], example: 'EXPENSE' })
  transactionType!: 'INCOME' | 'EXPENSE';

  @ApiProperty({ enum: ['DRAFT', 'CONFIRMED'], example: 'CONFIRMED' })
  status!: 'DRAFT' | 'CONFIRMED';

  @ApiProperty({ example: '4820.00', description: 'Десятичная строка, рубли, до 2 знаков.' })
  amount!: string;

  @ApiProperty({ example: '2026-09-30' })
  occurredOn!: string;

  @ApiProperty({ example: '0195f3c3-aaaa-bbbb-cccc-000000000003' })
  accountId!: string;

  @ApiProperty({ example: '0195f3c3-aaaa-bbbb-cccc-000000000004' })
  categoryId!: string;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    description: 'Только для расхода; обязательный конверт платежей через эту операцию недоступен.',
  })
  envelopeId?: string | null;

  @ApiProperty({ required: false, example: 'Продукты' })
  comment?: string;
}

export class TransactionV2Warning {
  @ApiProperty({ example: 'ENVELOPE_BALANCE_INSUFFICIENT' })
  code!: string;

  @ApiProperty({ example: 'Назначение конверта ушло в минус.' })
  detail!: string;
}

export class TransactionV2Response {
  @ApiProperty({ example: '0195f3c3-aaaa-bbbb-cccc-000000000001' })
  id!: string;

  @ApiProperty({ example: '0195f3c3-aaaa-bbbb-cccc-000000000002' })
  budgetId!: string;

  @ApiProperty({ enum: ['INCOME', 'EXPENSE'] })
  transactionType!: 'INCOME' | 'EXPENSE';

  @ApiProperty({ enum: ['DRAFT', 'CONFIRMED'] })
  status!: 'DRAFT' | 'CONFIRMED';

  @ApiProperty({ example: '482000', description: 'Сумма в минорных единицах (строка).' })
  amountMinor!: string;

  @ApiProperty({ example: 'RUB' })
  currency!: string;

  @ApiProperty({ example: '2026-09-30' })
  occurredOn!: string;

  @ApiProperty()
  accountId!: string;

  @ApiProperty()
  categoryId!: string;

  @ApiProperty({ nullable: true, type: String })
  envelopeId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  comment!: string | null;

  @ApiProperty({ example: '1518000', description: 'Остаток счёта после операции (minor, строка).' })
  accountBalanceMinor!: string;

  @ApiProperty({ type: [TransactionV2Warning] })
  warnings!: TransactionV2Warning[];
}
